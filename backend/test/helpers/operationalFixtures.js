// Minimal fixtures for the readiness audit only; never a production bootstrap.
import bcrypt from 'bcryptjs';
import { isolatedDatabaseUrl } from './testRunner.js';
import { PrismaClient } from '../../src/generated/prisma/index.js';
import { REFERENCE_BOOTSTRAP_STATES } from '../../src/services/referenceBootstrap.js';
import { buildMedicineIdentityKey } from '../../src/utils/medicineManagement.js';
if(process.env.NODE_ENV!=='test')throw Error('Test-only fixture refused');
const schema=new URL(process.env.DATABASE_URL).searchParams.get('schema');
const isolated = isolatedDatabaseUrl(process.env.DATABASE_URL,schema,process.env.TEST_DATABASE_PORT || '5433');
if(process.env.DATABASE_URL !== isolated || process.env.DIRECT_URL !== isolated || process.env.TEST_DATABASE_URL !== isolated) throw Error('Fixture URLs must all point to the same isolated test schema');
const p=new PrismaClient();
try {
 if(await p.user.count()!==0)throw Error('Fixtures require a new empty schema');
 await p.state.createMany({data:REFERENCE_BOOTSTRAP_STATES});
 const specialties=[{code:'surgery',nameAr:'الجراحة',nameEn:'Surgery'},{code:'dentistry',nameAr:'طب الأسنان',nameEn:'Dentistry'},{code:'orthopedics',nameAr:'جراحة العظام',nameEn:'Orthopedics'},{code:'internal-medicine',nameAr:'الباطنية',nameEn:'Internal Medicine'},{code:'neurology',nameAr:'طب الأعصاب',nameEn:'Neurology'}];
 await p.specialty.createMany({data:specialties});
 const specialty=await p.specialty.findUnique({where:{code:'internal-medicine'}});
 const roles=[['admin@cms.com','Admin@123','ADMIN'],['recep@cms.com','Receptionist@123','RECEPTIONIST'],['pharma@cms.com','Pharmacist@123','PHARMACIST'],['lab@cms.com','Labtech@123','LAB_TECH'],['doctor@cms.com','Doctor@123','DOCTOR'],['doctor_cardio@cms.com','Doctor@123','DOCTOR'],['doctor_peds@cms.com','Doctor@123','DOCTOR']];
 for(const [username,password,role]of roles){
  const user=await p.user.create({data:{username,passwordHash:await bcrypt.hash(password,4),role}});
  if(role==='DOCTOR')await p.doctor.create({data:{userId:user.id,fullNameAr:'طبيب اختبار',fullNameEn:'Local Fixture Doctor',specialtyId:specialty.id,specialtyAr:specialty.nameAr,specialtyEn:specialty.nameEn,consultationFee:username==='doctor@cms.com'?20000:35000,weeklySchedule:JSON.stringify(['Sunday','Monday','Tuesday','Wednesday','Thursday'].map(day=>({day,startTime:'09:00',endTime:'15:00',slotDurationInMinutes:15})))}});
 }
 await p.clinicalService.createMany({data:[{labelAr:'فحص محلي',labelEn:'Local fixture lab',category:'LABORATORY',baseFeeSdg:5000,baseFeeUsd:5000/1500},{labelAr:'إجراء محلي',labelEn:'Local fixture procedure',category:'CLINICAL_PROCEDURE',baseFeeSdg:9000,baseFeeUsd:6}]});
 const medicine={brandName:'Local Fixture Medicine',labelAr:'دواء اختبار محلي',labelEn:'Local Fixture Medicine',genericName:'Fixture ingredient',strength:'500mg',dosageForm:'Tablet'};
 const drug=await p.drugFormulary.create({data:{...medicine,identityKey:buildMedicineIdentityKey(medicine),status:'ACTIVE',unitPriceSdg:1000}});
 const batch=await p.inventoryBatch.create({data:{drugId:drug.id,batchNumber:'LOCAL-FIXTURE',normalizedBatchNumber:'local-fixture',expiryDate:'2099-12-31',qtyOnHand:10000,minReorderLevel:10}});
 await p.stockMovement.create({data:{drugId:drug.id,inventoryBatchId:batch.id,movementType:'OPENING_BALANCE',quantityDelta:10000,resultingBalance:10000,referenceType:'ISOLATED_TEST_FIXTURE'}});
 await p.insuranceCompany.create({data:{labelAr:'تأمين اختبار محلي',labelEn:'Local fixture insurer',copayPercentage:10}});
 console.log('Created minimal local test fixtures; no general seed executed.');
}finally{await p.$disconnect()}
