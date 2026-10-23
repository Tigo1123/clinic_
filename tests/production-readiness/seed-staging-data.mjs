import { assertDestructiveStaging } from './safety-guards.mjs';
import pg from '../../backend/node_modules/pg/lib/index.js';

// Deterministic, fake-only workload fixture. It is intentionally confined to
// the dedicated local shifa_stage database and never contacts external services.
const mode = process.argv[2] || 'seed';
if (!['seed', 'clean'].includes(mode)) throw new Error('Use seed or clean.');
const connectionString = process.env.STAGING_MIGRATION_URL;
assertDestructiveStaging(process.env, connectionString, 'shifa_stage');
if (!connectionString) throw new Error('STAGING_MIGRATION_URL is required.');
const target = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(target.hostname)
    || target.port !== '55439' || target.pathname !== '/shifa_stage') {
  throw new Error('Refusing staging fixture outside the guarded loopback shifa_stage database.');
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const identity = (await client.query('SELECT current_database() AS db, current_schema() AS schema')).rows[0];
  if (identity.db !== 'shifa_stage' || identity.schema !== 'public') throw new Error('Unexpected staging database identity.');
  await client.query('BEGIN');
  if (mode === 'clean') {
    for (const table of [
      'StockMovement', 'InventoryBatch', 'PrescribedDrug', 'LabOrderItem', 'LabOrder',
      'Payment', 'Refund', 'InvoiceItem', 'Invoice', 'Prescription', 'MedicalRecord',
      'Appointment', 'Patient', 'Doctor', 'User', 'ClinicalService', 'DrugFormulary'
    ]) await client.query(`DELETE FROM "${table}" WHERE id LIKE 'stg-%'`);
    await client.query('DELETE FROM "Specialty" WHERE id LIKE \'stg-%\'');
    await client.query('DELETE FROM "State" WHERE id < 0');
    await client.query('COMMIT');
    console.log(JSON.stringify({ mode, target: 'loopback/shifa_stage/public', syntheticPrefixRemoved: true }));
  } else {
    const existing = await client.query(`SELECT count(*)::int AS n FROM "Patient" WHERE id LIKE 'stg-patient-%'`);
    if (existing.rows[0].n) throw new Error('Synthetic staging dataset already exists; run clean first.');
    const states = [
      ['الخرطوم','Khartoum'],['الجزيرة','Gezira'],['البحر الأحمر','Red Sea'],['كسلا','Kassala'],
      ['القضارف','Al Qadarif'],['سنار','Sennar'],['النيل الأزرق','Blue Nile'],['النيل الأبيض','White Nile'],
      ['نهر النيل','River Nile'],['الشمالية','Northern'],['غرب كردفان','West Kordofan'],['شمال كردفان','North Kordofan'],
      ['جنوب كردفان','South Kordofan'],['شمال دارفور','North Darfur'],['غرب دارفور','West Darfur'],
      ['جنوب دارفور','South Darfur'],['شرق دارفور','East Darfur'],['وسط دارفور','Central Darfur']
    ];
    for (let i = 0; i < states.length; i++) {
      await client.query('INSERT INTO "State" (id,"labelAr","labelEn") VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [i + 1, ...states[i]]);
    }
    const specialties = [
      ['surgery','الجراحة','Surgery'],['dentistry','طب الأسنان','Dentistry'],['orthopedics','جراحة العظام','Orthopedics'],
      ['internal-medicine','الباطنية','Internal Medicine'],['neurology','طب الأعصاب','Neurology']
    ];
    for (const [code,nameAr,nameEn] of specialties) {
      await client.query('INSERT INTO "Specialty" (id,code,"nameAr","nameEn","updatedAt") VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (code) DO NOTHING', [`stg-specialty-${code}`,code,nameAr,nameEn]);
    }
    await client.query(`
      INSERT INTO "User" (id,username,"passwordHash",role,status)
      SELECT 'stg-user-'||lpad(n::text,5,'0'), 'synthetic.'||lpad(n::text,3,'0')||'@example.invalid',
        'NOT-A-LOGIN-CREDENTIAL', CASE WHEN n <= 5 THEN (ARRAY['ADMIN','RECEPTIONIST','PHARMACIST','LAB_TECH','DOCTOR'])[n]
        ELSE 'DOCTOR' END, 'ACTIVE'
      FROM generate_series(1,25) n;
      INSERT INTO "Doctor" (id,"userId","fullNameAr","fullNameEn","specialtyAr","specialtyEn","specialtyId","consultationFee","weeklySchedule",status)
      SELECT 'stg-doctor-'||lpad(n::text,3,'0'),'stg-user-'||lpad((n+4)::text,5,'0'),
        'طبيب اصطناعي '||n, 'Synthetic Doctor '||n, 'تخصص تجريبي','Synthetic specialty',
        'stg-specialty-'||(ARRAY['internal-medicine','dentistry','surgery','orthopedics','neurology'])[((n-1)%5)+1],
        10000.00,'[]','ACTIVE' FROM generate_series(1,20) n;
      INSERT INTO "Patient" (id,"fullNameAr","fullNameEn",gender,"dateOfBirth",phone,"addressStateId","emergencyContact","addressDetails")
      SELECT 'stg-patient-'||lpad(n::text,5,'0'), 'مريض اصطناعي '||n, 'Synthetic Patient '||n,
        CASE WHEN n%2=0 THEN 'FEMALE' ELSE 'MALE' END,
        to_char(date '1980-01-01'+(n%12000),'YYYY-MM-DD'),
        '+249000'||lpad(n::text,9,'0'), ((n-1)%18)+1, 'Synthetic test contact', 'Synthetic staging data'
      FROM generate_series(1,5000) n;
      INSERT INTO "Appointment" (id,"patientId","doctorId","appointmentDate","appointmentTime",status,"createdAt")
      SELECT 'stg-appointment-'||lpad(n::text,6,'0'),
        'stg-patient-'||lpad((((n*37-1)%5000)+1)::text,5,'0'),
        'stg-doctor-'||lpad((((n-1)%20)+1)::text,3,'0'),
        to_char(date '2024-01-01'+((n-1)/320),'YYYY-MM-DD'),
        to_char(time '08:00'+(((n-1)/20)%16)*interval '30 minutes','HH24:MI'),
        CASE WHEN n<=8000 THEN 'COMPLETED' WHEN n%20=0 THEN 'CANCELLED' WHEN n%20=1 THEN 'NO_SHOW'
          WHEN n%20=2 THEN 'CHECKED_IN' WHEN n%20=3 THEN 'IN_CONSULTATION' ELSE 'SCHEDULED' END,
        timestamp '2024-01-01 08:00:00'+n*interval '15 minutes'
      FROM generate_series(1,20000) n;
      INSERT INTO "MedicalRecord" (id,"patientId","doctorId","appointmentId","visitDate","symptomsEncrypted","diagnosisEncrypted","treatmentEncrypted","vitalSignsJson","clinicalNotesEncrypted")
      SELECT 'stg-record-'||lpad(n::text,6,'0'), a."patientId",a."doctorId",a.id,
        timestamp '2024-01-01 08:00:00'+n*interval '15 minutes',
        'SYNTHETIC-ONLY','SYNTHETIC-ONLY','SYNTHETIC-ONLY','{}','SYNTHETIC-ONLY'
      FROM generate_series(1,8000) n JOIN "Appointment" a ON a.id='stg-appointment-'||lpad(n::text,6,'0');
      INSERT INTO "Prescription" (id,"medicalRecordId","patientId","doctorId",status,"prescriptionDate")
      SELECT 'stg-prescription-'||lpad(n::text,6,'0'),r.id,r."patientId",r."doctorId",
        CASE WHEN n%10=0 THEN 'FILLED' ELSE 'ACTIVE' END,r."visitDate"
      FROM "MedicalRecord" r JOIN generate_series(1,8000) n ON r.id='stg-record-'||lpad(n::text,6,'0');
      INSERT INTO "DrugFormulary" (id,"brandName","labelAr","labelEn","genericName",strength,"dosageForm","identityKey","unitPriceSdg",status)
      SELECT 'stg-drug-'||lpad(n::text,3,'0'),'Synthetic product '||n,'دواء اصطناعي '||n,'Synthetic medicine '||n,
        'Synthetic compound '||n,'10 mg','tablet','stg-identity-'||n,100+n,'ACTIVE' FROM generate_series(1,100) n;
      INSERT INTO "PrescribedDrug" (id,"prescriptionId","drugId",dosage,duration,"instructionsAr","instructionsEn","qtyPrescribed")
      SELECT 'stg-prescribed-drug-'||lpad(n::text,6,'0'),'stg-prescription-'||lpad(n::text,6,'0'),
        'stg-drug-'||lpad((((n-1)%100)+1)::text,3,'0'),'1 tablet','5 days','تعليمات اصطناعية','Synthetic instructions',10
      FROM generate_series(1,8000) n;
      INSERT INTO "ClinicalService" (id,code,"labelAr","labelEn","baseFeeSdg","baseFeeUsd",category,status)
      VALUES ('stg-service-lab','STG-LAB','اختبار اصطناعي','Synthetic lab test',2500,1.67,'LABORATORY','ACTIVE');
      INSERT INTO "LabOrder" (id,"medicalRecordId","patientId","doctorId",status,"orderDate")
      SELECT 'stg-lab-order-'||lpad(n::text,5,'0'),r.id,r."patientId",r."doctorId",
        CASE WHEN n%4=0 THEN 'COMPLETED' WHEN n%4=1 THEN 'SAMPLE_COLLECTED' WHEN n%4=2 THEN 'PAID' ELSE 'PENDING_BILLING' END,r."visitDate"
      FROM generate_series(1,2000) n JOIN "MedicalRecord" r ON r.id='stg-record-'||lpad((n*4)::text,6,'0');
      INSERT INTO "LabOrderItem" (id,"labOrderId","serviceId","resultValue")
      SELECT 'stg-lab-item-'||lpad(n::text,5,'0'),'stg-lab-order-'||lpad(n::text,5,'0'),'stg-service-lab','SYNTHETIC RESULT'
      FROM generate_series(1,2000) n;
      INSERT INTO "Invoice" (id,"patientId","appointmentId","invoiceDate","totalAmountSdg","totalAmountUsd","invoiceExchangeRate","paymentStatus","invoiceType","createdBy")
      SELECT 'stg-invoice-'||lpad(n::text,6,'0'),a."patientId",a.id,a."createdAt",20000+(n%5000),
        round((20000+(n%5000))/1500.0,2),1500,CASE WHEN n%4=0 THEN 'PAID' ELSE 'UNPAID' END,
        CASE WHEN n%5=0 THEN 'CONSULTATION' ELSE 'GENERAL' END,'stg-user-00001'
      FROM generate_series(1,15000) n JOIN "Appointment" a ON a.id='stg-appointment-'||lpad(n::text,6,'0');
      INSERT INTO "InvoiceItem" (id,"invoiceId","descriptionAr","descriptionEn",qty,"unitPriceSdg","unitPriceUsd")
      SELECT 'stg-invoice-item-'||lpad(n::text,6,'0'),'stg-invoice-'||lpad(n::text,6,'0'),
        'بند اصطناعي','Synthetic line item',1,20000+(n%5000),round((20000+(n%5000))/1500.0,2)
      FROM generate_series(1,15000) n;
      INSERT INTO "Payment" (id,"invoiceId","amountSdg","amountUsd","paymentMethod","receivedBy","createdAt")
      SELECT 'stg-payment-'||lpad(n::text,6,'0'),'stg-invoice-'||lpad(n::text,6,'0'),
        20000+(n%5000),round((20000+(n%5000))/1500.0,2),
        (ARRAY['CASH','CARD','BANKAK','FAWRY'])[((n-1)%4)+1],'stg-user-00002',timestamp '2024-01-01'+n*interval '15 minutes'
      FROM generate_series(1,12000) n;
      INSERT INTO "Refund" (id,"invoiceId","amountSdg","amountUsd","refundMethod",reason,"processedBy","createdAt")
      SELECT 'stg-refund-'||lpad(n::text,5,'0'),'stg-invoice-'||lpad(n::text,6,'0'),
        500+((n%100)*10),round((500+((n%100)*10))/1500.0,2),'CASH','Synthetic staging refund','stg-user-00001',
        timestamp '2025-01-01'+n*interval '20 minutes'
      FROM generate_series(1,1500) n;
      INSERT INTO "InventoryBatch" (id,"drugId","batchNumber","normalizedBatchNumber","expiryDate","qtyOnHand","minReorderLevel")
      SELECT 'stg-batch-'||lpad(n::text,4,'0'),'stg-drug-'||lpad((((n-1)%100)+1)::text,3,'0'),
        'SYNTH-BATCH-'||n,'SYNTH-BATCH-'||n,to_char(date '2027-01-01'+n,'YYYY-MM-DD'),1000,25
      FROM generate_series(1,200) n;
    `);
    await client.query('COMMIT');
    const counts = {};
    for (const table of ['User','Doctor','Patient','Appointment','MedicalRecord','Prescription','PrescribedDrug','LabOrder','LabOrderItem','Invoice','InvoiceItem','Payment','Refund','DrugFormulary','InventoryBatch']) {
      counts[table] = Number((await client.query(`SELECT count(*)::int AS n FROM "${table}" WHERE id LIKE 'stg-%'`)).rows[0].n);
    }
    console.log(JSON.stringify({ mode, target: 'loopback/shifa_stage/public', syntheticOnly: true, notificationsDisabledByDesign: true, counts }));
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally { await client.end(); }
