import pg from '../../backend/node_modules/pg/lib/index.js';

const sourceUrl=process.env.STAGING_MIGRATION_URL;
const restoreUrl=process.env.STAGING_RESTORE_URL;
if(!sourceUrl||!restoreUrl) throw new Error('Both staging URLs are required.');
const allowed=(value,name)=>{const u=new URL(value);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='55439'||u.pathname!==`/${name}`)throw new Error('Refusing restore verification outside the guarded loopback databases.');return u;};
allowed(sourceUrl,'shifa_stage');allowed(restoreUrl,'shifa_restore');
const tableNames=['User','Doctor','Patient','Appointment','MedicalRecord','Prescription','PrescribedDrug','DrugFormulary','ClinicalService','LabOrder','LabOrderItem','Invoice','InvoiceItem','Payment','Refund','InventoryBatch'];
const snapshot=async(connectionString)=>{
  const c=new pg.Client({connectionString});await c.connect();
  try{
    const info=(await c.query('SELECT current_database() db,current_schema() schema,version() version')).rows[0];
    const rows={};
    for(const table of tableNames){
      rows[table]=(await c.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY t.id),'')) AS checksum FROM "${table}" t WHERE t.id LIKE 'stg-%'`)).rows[0];
    }
    for(const [table,key] of [['State','id'],['PaymentMethod','code'],['Specialty','id']]){
      rows[table]=(await c.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY t."${key}"),'')) AS checksum FROM "${table}" t ${table==='Specialty'?"WHERE t.id LIKE 'stg-%'":""}`)).rows[0];
    }
    const financial=(await c.query(`SELECT (SELECT coalesce(sum("amountSdg"),0)::text FROM "Payment" WHERE id LIKE 'stg-%') payment_sdg,
      (SELECT coalesce(sum("amountUsd"),0)::text FROM "Payment" WHERE id LIKE 'stg-%') payment_usd,
      (SELECT coalesce(sum("amountSdg"),0)::text FROM "Refund" WHERE id LIKE 'stg-%') refund_sdg,
      (SELECT coalesce(sum("amountUsd"),0)::text FROM "Refund" WHERE id LIKE 'stg-%') refund_usd,
      (SELECT min("createdAt") FROM "Appointment" WHERE id LIKE 'stg-%') appointment_min,
      (SELECT max("createdAt") FROM "Appointment" WHERE id LIKE 'stg-%') appointment_max`)).rows[0];
    const migrations=(await c.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
    const constraints=(await c.query("SELECT count(*)::int AS total,count(*) FILTER (WHERE NOT convalidated)::int AS unvalidated FROM pg_constraint WHERE connamespace='public'::regnamespace")).rows[0];
    return {info,rows,financial,migrations,constraints};
  }finally{await c.end();}
};
const source=await snapshot(sourceUrl);const restored=await snapshot(restoreUrl);
const mismatches=[];
for(const table of Object.keys(source.rows)) if(JSON.stringify(source.rows[table])!==JSON.stringify(restored.rows[table]))mismatches.push(`rows:${table}`);
if(JSON.stringify(source.financial)!==JSON.stringify(restored.financial))mismatches.push('financial-values-or-timestamps');
if(JSON.stringify(source.migrations)!==JSON.stringify(restored.migrations))mismatches.push('migration-history');
if(source.constraints.total!==restored.constraints.total||restored.constraints.unvalidated!==0)mismatches.push('constraints');
console.log(JSON.stringify({source:{database:source.info.db,schema:source.info.schema,postgres:source.info.version.match(/PostgreSQL [^,]+/)?.[0]},restore:{database:restored.info.db,schema:restored.info.schema},tables:source.rows,financial:source.financial,migrations:{source:source.migrations.length,restored:restored.migrations.length,checksumsAndStatusesEqual:JSON.stringify(source.migrations)===JSON.stringify(restored.migrations)},constraints:restored.constraints,mismatches,allChecksPassed:mismatches.length===0}));
if(mismatches.length)process.exitCode=1;
