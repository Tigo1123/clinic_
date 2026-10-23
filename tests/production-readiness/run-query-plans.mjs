import pg from '../../backend/node_modules/pg/lib/index.js';

const connectionString = process.env.STAGING_MIGRATION_URL;
if (!connectionString) throw new Error('STAGING_MIGRATION_URL is required.');
const target = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '55439' || target.pathname !== '/shifa_stage') {
  throw new Error('Refusing EXPLAIN outside the guarded loopback shifa_stage database.');
}
const client = new pg.Client({ connectionString, statement_timeout: 10_000 });
await client.connect();
const queries = [
  ['billing payments aggregate', `SELECT "paymentMethod",sum("amountSdg") FROM "Payment" GROUP BY "paymentMethod"`],
  ['billing refunds aggregate', `SELECT "refundMethod",sum("amountSdg") FROM "Refund" GROUP BY "refundMethod"`],
  ['doctor queue', `SELECT a.id,p."fileNumber",p."fullNameAr",p."fullNameEn",a."appointmentDate",a."appointmentTime",a.status FROM "Appointment" a JOIN "Patient" p ON p.id=a."patientId" WHERE a."doctorId"='stg-doctor-003' AND a."appointmentDate" BETWEEN '2024-01-01' AND '2024-03-31' AND a.status IN ('SCHEDULED','CHECKED_IN','IN_CONSULTATION') ORDER BY a."appointmentDate",a."appointmentTime",a.id LIMIT 50`],
  ['reception queue', `SELECT a.id,p."fileNumber",p."fullNameAr",p."fullNameEn",d."fullNameEn",a."appointmentDate",a."appointmentTime",a.status FROM "Appointment" a JOIN "Patient" p ON p.id=a."patientId" JOIN "Doctor" d ON d.id=a."doctorId" WHERE a."appointmentDate" BETWEEN '2024-01-01' AND '2024-03-31' AND a.status IN ('SCHEDULED','CHECKED_IN') ORDER BY a."appointmentDate",a."appointmentTime",a.id LIMIT 50`],
  ['patient history', `SELECT id,"visitDate","doctorId" FROM "MedicalRecord" WHERE "patientId"='stg-patient-00001' ORDER BY "visitDate" DESC,id DESC LIMIT 50`],
  ['admin users list', `SELECT id,username,role,status,"createdAt" FROM "User" WHERE status='ACTIVE' ORDER BY "createdAt" DESC,id DESC LIMIT 50`],
  ['appointment list', `SELECT id,"patientId","doctorId","appointmentDate","appointmentTime",status FROM "Appointment" WHERE "appointmentDate" BETWEEN '2024-01-01' AND '2024-03-31' ORDER BY "appointmentDate" DESC,"appointmentTime" DESC,id DESC LIMIT 50`],
  ['slot availability', `SELECT id,"appointmentTime",status FROM "Appointment" WHERE "doctorId"='stg-doctor-001' AND "appointmentDate"='2024-01-01' AND status NOT IN ('CANCELLED','NO_SHOW') ORDER BY "appointmentTime",id`],
  ['lab queue', `SELECT l.id,l.status,l."orderDate",p."fileNumber",p."fullNameEn",i.id AS item_id FROM "LabOrder" l JOIN "Patient" p ON p.id=l."patientId" LEFT JOIN "LabOrderItem" i ON i."labOrderId"=l.id WHERE l.status IN ('PAID','SAMPLE_COLLECTED') ORDER BY l."orderDate",l.id LIMIT 50`],
  ['pharmacy formulary', `SELECT id,"brandName","genericName",strength,"dosageForm","unitPriceSdg" FROM "DrugFormulary" WHERE status='ACTIVE' ORDER BY "brandName",id LIMIT 50`],
  ['patient invoice list', `SELECT id,"invoiceDate","totalAmountSdg","paymentStatus" FROM "Invoice" WHERE "patientId"='stg-patient-00001' ORDER BY "invoiceDate" DESC,id DESC LIMIT 50`],
  ['patient prescription history', `SELECT id,"prescriptionDate",status FROM "Prescription" WHERE "patientId"='stg-patient-00001' ORDER BY "prescriptionDate" DESC,id DESC LIMIT 50`]
];
const walk = (node, result) => {
  result.nodes.push({ type: node['Node Type'], relation: node['Relation Name'] || undefined, index: node['Index Name'] || undefined,
    plannedRows: node['Plan Rows'], actualRows: node['Actual Rows'], loops: node['Actual Loops'], actualMs: node['Actual Total Time'],
    sortMethod: node['Sort Method'] || undefined, sortSpaceKb: node['Sort Space Used'] || undefined,
    sharedHit: node['Shared Hit Blocks'], sharedRead: node['Shared Read Blocks'] });
  for (const child of node.Plans || []) walk(child, result);
};
try {
  const identity=(await client.query('SELECT current_database() db,current_schema() schema,version() version')).rows[0];
  if(identity.db!=='shifa_stage'||identity.schema!=='public') throw new Error('Unexpected database identity.');
  const results=[];
  for(const [name,sql] of queries){
    const result=(await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'][0];
    const summary={name,planningMs:result['Planning Time'],executionMs:result['Execution Time'],nodes:[]};
    walk(result.Plan,summary);
    results.push(summary);
  }
  console.log(JSON.stringify({target:'loopback/shifa_stage/public',dataset:'deterministic synthetic only',postgres:identity.version.match(/PostgreSQL [^,]+/)?.[0],plans:results}));
} finally {await client.end();}
