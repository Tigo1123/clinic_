// Read-only post-release verification for the approved Neon migration/reference steps.
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { assessDatabase, assessmentConnection, quoteIdentifier as q } from './assess-database-migration.js';
import { PsqlReadOnlyClient } from './lib/psql-readonly-client.js';
import { repositoryInventory } from './audit-clinic-readiness.js';
import { REFERENCE_BOOTSTRAP_STATES } from '../src/services/referenceBootstrap.js';

const final=process.argv.includes('--final');
const release=JSON.parse(await fs.readFile('../docs/clinic-readiness/neon-production-release/release-manifest.json','utf8'));
const privateDir=(await fs.readFile('/tmp/shifa-migration-rehearsal-location','utf8')).trim();
if(!/^\/tmp\/shifa-migration-private-[A-Za-z0-9]+$/.test(privateDir))throw Error('Private reviewed snapshot required');
const snapshot=JSON.parse(await fs.readFile(privateDir+'/neon-baseline-digests.json','utf8'));
const u=new URL(dotenv.parse(await fs.readFile('.env')).DATABASE_URL);u.hostname=u.hostname.replace('-pooler.','.');
const connection=assessmentConnection(u.href);if(connection.fingerprint!==release.directFingerprint)throw Error('Direct target changed');
const live=await assessDatabase(connection.connectionString,{clientFactory:config=>new PsqlReadOnlyClient(config)});
const repository=await repositoryInventory();
const names=live.migrationHistory.filter(x=>x.finished_at&&!x.rolled_back_at);
const expectedNames=repository.migrations.map(m=>m.name).sort();
const migrationHistoryMatches=names.length===26&&JSON.stringify(names.map(x=>x.migration_name).sort())===JSON.stringify(expectedNames)&&!live.migrationDrift.failed.length&&!live.migrationDrift.unknown.length&&!live.migrationDrift.checksumMismatches.length&&!live.migrationDrift.pending.length;
const refClient=new PsqlReadOnlyClient({connectionString:connection.connectionString});await refClient.connect();
let refData;
try {
  await refClient.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const exists=(await refClient.query("SELECT to_regclass('public.\"PaymentMethod\"') IS NOT NULL AS present")).rows[0].present;
  const paymentMethods=exists?(await refClient.query('SELECT code,"labelAr","labelEn",active,"createdAt" IS NOT NULL AS created_at_present,"updatedAt" IS NOT NULL AS updated_at_present FROM public."PaymentMethod" ORDER BY code')).rows:[];
  const states=await refClient.query('SELECT id,"labelAr","labelEn" FROM public."State" ORDER BY id');
  const specialties=final?await refClient.query('SELECT code,"nameAr","nameEn",active FROM public."Specialty" ORDER BY code'):null;
  const specialtyCount=Number((await refClient.query('SELECT count(*)::text AS count FROM public."Specialty"')).rows[0].count);
  refData={exists,paymentMethods,states:states.rows,specialties:specialties?.rows||[],specialtyCount};
  await refClient.query('ROLLBACK');
} catch(error) { await refClient.end(); throw error; }
const wantedPayments=[['BANKAK','بنكك — دفع يدوي','Bankak — manual mobile money'],['CARD','بطاقة / جهاز نقاط البيع','Card / POS'],['CASH','نقداً','Cash'],['FAWRY','فوري — دفع يدوي','Fawry — manual mobile money']];
const paymentMethodsMatch=refData.exists&&refData.paymentMethods.length===4&&JSON.stringify(refData.paymentMethods.map(x=>[x.code,x.labelAr,x.labelEn]))===JSON.stringify(wantedPayments)&&refData.paymentMethods.every(x=>x.active&&x.created_at_present&&x.updated_at_present);
const statesMatch=JSON.stringify(refData.states)===JSON.stringify(REFERENCE_BOOTSTRAP_STATES);
const wantedSpecialties=[['dentistry','طب الأسنان','Dentistry'],['internal-medicine','الباطنية','Internal Medicine'],['neurology','طب الأعصاب','Neurology'],['orthopedics','جراحة العظام','Orthopedics'],['surgery','الجراحة','Surgery']];
const specialtiesMatch=final?refData.specialtyCount===5&&JSON.stringify(refData.specialties.map(x=>[x.code,x.nameAr,x.nameEn]))===JSON.stringify(wantedSpecialties)&&refData.specialties.every(x=>x.active):refData.specialtyCount===0;
const methodsForeignKeys=live.constraints.filter(c=>['Payment_paymentMethod_fkey','Refund_refundMethod_fkey'].includes(c.name));
const methodFKsValid=methodsForeignKeys.length===2&&methodsForeignKeys.every(x=>x.validated);
const releaseIndexes=['Appointment_patientId_appointmentDate_appointmentTime_idx','MedicalRecord_patientId_visitDate_idx','Prescription_patientId_prescriptionDate_idx','LabOrder_patientId_releasedToPatientAt_orderDate_idx','Invoice_patientId_invoiceDate_idx','Payment_invoiceId_createdAt_idx'];
const indexesValid=releaseIndexes.every(name=>live.indexes.some(x=>x.name===name&&x.valid));
const originalTables=Object.keys(snapshot.tables).sort();
const dbUrl=new URL('postgresql://127.0.0.1:55487/neon_clone');const localCred=JSON.parse(await fs.readFile(privateDir+'/local.json','utf8'));dbUrl.username=localCred.user;dbUrl.password=localCred.password;
const local=new Client({connectionString:dbUrl.href});await local.connect();
const digestRows=async(client,tables)=>{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL TIME ZONE 'UTC'");
  const result={};for(const table of tables)result[table]=(await client.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS digest FROM public.${q(table)} t`)).rows[0];
  await client.query('ROLLBACK');return result;
};
let preservation;let preservationDiffs=[];let approvedSpecialtyAddition=false;
try {
  const [remote,baseline]=await Promise.all([digestRows(refClient,originalTables),digestRows(local,originalTables)]);
  preservationDiffs=originalTables.filter(t=>remote[t].count!==baseline[t].count||remote[t].digest!==baseline[t].digest||remote[t].count!==snapshot.tables[t].count||remote[t].digest!==snapshot.tables[t].digest);
  approvedSpecialtyAddition=final&&preservationDiffs.length===1&&preservationDiffs[0]==='Specialty'&&snapshot.tables.Specialty.count==='0'&&remote.Specialty.count==='5'&&specialtiesMatch;
  preservation=preservationDiffs.length===0||approvedSpecialtyAddition;
} finally {await Promise.allSettled([refClient.end(),local.end()]);}
const report={capturedAt:new Date().toISOString(),targetFingerprint:connection.fingerprint,readOnly:true,mode:final?'after-reviewed-bootstrap':'after-migrations-before-specialties',migrationCount:names.length,migrationHistoryMatches,pending:live.migrationDrift.pending,checksumMismatches:live.migrationDrift.checksumMismatches,failedMigrations:live.migrationDrift.failed,allPreExistingRowsPreserved:preservation,approvedReferenceInsertAccountedFor:approvedSpecialtyAddition,unaccountedRowFingerprintDifferences:preservationDiffs.filter(t=>!(approvedSpecialtyAddition&&t==='Specialty')),originalTablesChecked:originalTables.length,paymentMethodsMatch,statesMatch,statesCount:refData.states.length,specialtiesMatch,specialtyCount:refData.specialtyCount,newForeignKeysValid:methodFKsValid,allApprovedIndexesValid:indexesValid,verifiedRows:{paymentMethods:refData.paymentMethods.length,specialties:refData.specialtyCount},passed:migrationHistoryMatches&&preservation&&paymentMethodsMatch&&statesMatch&&specialtiesMatch&&methodFKsValid&&indexesValid};
const destination='../docs/clinic-readiness/neon-production-release/'+(final?'final-verification.json':'post-migration-verification.json');
await fs.writeFile(destination,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.passed)process.exitCode=2;
