import { PrismaClient } from '../src/generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import { buildMedicineIdentityKey, normalizeBatchNumber } from '../src/utils/medicineManagement.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed process...');

  // 1. Seed the 18 Sudanese States
  const statesData = [
    { id: 1, labelAr: 'الخرطوم', labelEn: 'Khartoum' },
    { id: 2, labelAr: 'الجزيرة', labelEn: 'Gezira' },
    { id: 3, labelAr: 'البحر الأحمر', labelEn: 'Red Sea' },
    { id: 4, labelAr: 'كسلا', labelEn: 'Kassala' },
    { id: 5, labelAr: 'القضارف', labelEn: 'Al Qadarif' },
    { id: 6, labelAr: 'سنار', labelEn: 'Sennar' },
    { id: 7, labelAr: 'النيل الأزرق', labelEn: 'Blue Nile' },
    { id: 8, labelAr: 'النيل الأبيض', labelEn: 'White Nile' },
    { id: 9, labelAr: 'نهر النيل', labelEn: 'River Nile' },
    { id: 10, labelAr: 'الشمالية', labelEn: 'Northern' },
    { id: 11, labelAr: 'غرب كردفان', labelEn: 'West Kordofan' },
    { id: 12, labelAr: 'شمال كردفان', labelEn: 'North Kordofan' },
    { id: 13, labelAr: 'جنوب كردفان', labelEn: 'South Kordofan' },
    { id: 14, labelAr: 'شمال دارفور', labelEn: 'North Darfur' },
    { id: 15, labelAr: 'غرب دارفور', labelEn: 'West Darfur' },
    { id: 16, labelAr: 'جنوب دارفور', labelEn: 'South Darfur' },
    { id: 17, labelAr: 'شرق دارفور', labelEn: 'East Darfur' },
    { id: 18, labelAr: 'وسط دارفور', labelEn: 'Central Darfur' }
  ];

  console.log('Seeding states...');
  for (const state of statesData) {
    await prisma.state.upsert({
      where: { id: state.id },
      update: {},
      create: state
    });
  }

  // 2. Hash default passwords
  const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
  const recepPasswordHash = await bcrypt.hash('Receptionist@123', 10);
  const docPasswordHash = await bcrypt.hash('Doctor@123', 10);
  const pharmaPasswordHash = await bcrypt.hash('Pharmacist@123', 10);
  const labPasswordHash = await bcrypt.hash('Labtech@123', 10);

  // 3. Seed Default Admin User
  console.log('Seeding default Admin...');
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin@cms.com' },
    update: {},
    create: {
      username: 'admin@cms.com',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      preferredLanguage: 'ar'
    }
  });

  // 4. Seed Receptionist User
  console.log('Seeding Receptionist...');
  await prisma.user.upsert({
    where: { username: 'recep@cms.com' },
    update: {},
    create: {
      username: 'recep@cms.com',
      passwordHash: recepPasswordHash,
      role: 'RECEPTIONIST',
      preferredLanguage: 'ar'
    }
  });

  // 4.5. Seed Pharmacist User
  console.log('Seeding Pharmacist...');
  await prisma.user.upsert({
    where: { username: 'pharma@cms.com' },
    update: {},
    create: {
      username: 'pharma@cms.com',
      passwordHash: pharmaPasswordHash,
      role: 'PHARMACIST',
      preferredLanguage: 'ar'
    }
  });

  // 4.6. Seed Lab Tech User
  console.log('Seeding Lab Tech...');
  await prisma.user.upsert({
    where: { username: 'lab@cms.com' },
    update: {},
    create: {
      username: 'lab@cms.com',
      passwordHash: labPasswordHash,
      role: 'LAB_TECH',
      preferredLanguage: 'ar'
    }
  });

  // 5. Seed Doctor User & Doctor details
  console.log('Seeding Doctor...');
  const doctorUser = await prisma.user.upsert({
    where: { username: 'doctor@cms.com' },
    update: {},
    create: {
      username: 'doctor@cms.com',
      passwordHash: docPasswordHash,
      role: 'DOCTOR',
      preferredLanguage: 'ar'
    }
  });

  const docSchedule = JSON.stringify([
    { day: 'Sunday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
    { day: 'Monday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
    { day: 'Tuesday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
    { day: 'Wednesday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
    { day: 'Thursday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 }
  ]);

  await prisma.doctor.upsert({
    where: { userId: doctorUser.id },
    update: {},
    create: {
      userId: doctorUser.id,
      fullNameAr: 'د. أحمد الطيب',
      fullNameEn: 'Dr. Ahmed El-Tayeb',
      specialtyAr: 'طب عام',
      specialtyEn: 'General Medicine',
      consultationFee: 20000.00,
      weeklySchedule: docSchedule,
      status: 'ACTIVE'
    }
  });

  // Doctor 2: Cardiology
  console.log('Seeding Doctor 2 (Cardiology)...');
  const doctorUser2 = await prisma.user.upsert({
    where: { username: 'doctor_cardio@cms.com' },
    update: {},
    create: {
      username: 'doctor_cardio@cms.com',
      passwordHash: docPasswordHash,
      role: 'DOCTOR',
      preferredLanguage: 'ar'
    }
  });

  await prisma.doctor.upsert({
    where: { userId: doctorUser2.id },
    update: {},
    create: {
      userId: doctorUser2.id,
      fullNameAr: 'د. خالد منصور',
      fullNameEn: 'Dr. Khalid Mansour',
      specialtyAr: 'أمراض القلب',
      specialtyEn: 'Cardiology',
      consultationFee: 35000.00,
      weeklySchedule: docSchedule,
      status: 'ACTIVE'
    }
  });

  // Doctor 3: Pediatrics
  console.log('Seeding Doctor 3 (Pediatrics)...');
  const doctorUser3 = await prisma.user.upsert({
    where: { username: 'doctor_peds@cms.com' },
    update: {},
    create: {
      username: 'doctor_peds@cms.com',
      passwordHash: docPasswordHash,
      role: 'DOCTOR',
      preferredLanguage: 'ar'
    }
  });

  await prisma.doctor.upsert({
    where: { userId: doctorUser3.id },
    update: {},
    create: {
      userId: doctorUser3.id,
      fullNameAr: 'د. فاطمة عمر',
      fullNameEn: 'Dr. Fatima Omar',
      specialtyAr: 'طب الأطفال',
      specialtyEn: 'Pediatrics',
      consultationFee: 25000.00,
      weeklySchedule: docSchedule,
      status: 'ACTIVE'
    }
  });

  // 6. Seed Clinical Services
  console.log('Seeding clinical services...');

  const services = [
    {
      labelAr: 'كشف طبي عام',
      labelEn: 'General Medicine Consultation',
      baseFeeSdg: 20000.00,
      baseFeeUsd: 13.33,
      category: 'CONSULTATION'
    },

    // Laboratory quick-selection catalogue
    {
      labelAr: 'فحص دم كامل (CBC)',
      labelEn: 'Complete Blood Count (CBC)',
      baseFeeSdg: 15000.00,
      baseFeeUsd: 10.00,
      category: 'LABORATORY'
    },
    {
      labelAr: 'فحص الملاريا',
      labelEn: 'Malaria Test',
      baseFeeSdg: 10000.00,
      baseFeeUsd: 6.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'فصيلة الدم وعامل ريسس',
      labelEn: 'Blood Group & Rh',
      baseFeeSdg: 10000.00,
      baseFeeUsd: 6.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'سكر الدم العشوائي',
      labelEn: 'Random Blood Sugar',
      baseFeeSdg: 8000.00,
      baseFeeUsd: 5.33,
      category: 'LABORATORY'
    },
    {
      labelAr: 'سكر الدم الصائم',
      labelEn: 'Fasting Blood Sugar',
      baseFeeSdg: 8000.00,
      baseFeeUsd: 5.33,
      category: 'LABORATORY'
    },
    {
      labelAr: 'السكر التراكمي (HbA1c)',
      labelEn: 'HbA1c',
      baseFeeSdg: 18000.00,
      baseFeeUsd: 12.00,
      category: 'LABORATORY'
    },
    {
      labelAr: 'تحليل البول',
      labelEn: 'Urinalysis',
      baseFeeSdg: 10000.00,
      baseFeeUsd: 6.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'تحليل البراز',
      labelEn: 'Stool Analysis',
      baseFeeSdg: 10000.00,
      baseFeeUsd: 6.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'اختبار الحمل',
      labelEn: 'Pregnancy Test',
      baseFeeSdg: 10000.00,
      baseFeeUsd: 6.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'البروتين المتفاعل C (CRP)',
      labelEn: 'C-Reactive Protein (CRP)',
      baseFeeSdg: 15000.00,
      baseFeeUsd: 10.00,
      category: 'LABORATORY'
    },
    {
      labelAr: 'سرعة ترسيب الدم (ESR)',
      labelEn: 'Erythrocyte Sedimentation Rate (ESR)',
      baseFeeSdg: 12000.00,
      baseFeeUsd: 8.00,
      category: 'LABORATORY'
    },
    {
      labelAr: 'وظائف الكبد',
      labelEn: 'Liver Function Test (LFT)',
      baseFeeSdg: 25000.00,
      baseFeeUsd: 16.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'وظائف الكلى',
      labelEn: 'Kidney Function Test (KFT)',
      baseFeeSdg: 25000.00,
      baseFeeUsd: 16.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'دهون الدم',
      labelEn: 'Lipid Profile',
      baseFeeSdg: 25000.00,
      baseFeeUsd: 16.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'هرمون الغدة الدرقية (TSH)',
      labelEn: 'Thyroid Stimulating Hormone (TSH)',
      baseFeeSdg: 25000.00,
      baseFeeUsd: 16.67,
      category: 'LABORATORY'
    },
    {
      labelAr: 'فحص فيروس نقص المناعة',
      labelEn: 'HIV Screening',
      baseFeeSdg: 15000.00,
      baseFeeUsd: 10.00,
      category: 'LABORATORY'
    },
    {
      labelAr: 'التهاب الكبد B (HBsAg)',
      labelEn: 'Hepatitis B Surface Antigen (HBsAg)',
      baseFeeSdg: 15000.00,
      baseFeeUsd: 10.00,
      category: 'LABORATORY'
    },
    {
      labelAr: 'فحص التهاب الكبد C',
      labelEn: 'Hepatitis C Screening',
      baseFeeSdg: 15000.00,
      baseFeeUsd: 10.00,
      category: 'LABORATORY'
    },
    {
      labelAr: 'فحص التيفوئيد',
      labelEn: 'Typhoid Test',
      baseFeeSdg: 12000.00,
      baseFeeUsd: 8.00,
      category: 'LABORATORY'
    },

    // Clinical procedures
    {
      labelAr: 'تضميد جرح سطحي',
      labelEn: 'Surgical Wound Dressing',
      baseFeeSdg: 10000.00,
      baseFeeUsd: 6.67,
      category: 'CLINICAL_PROCEDURE'
    },
    {
      labelAr: 'جلسة نيبولايزر (بخاخ)',
      labelEn: 'Nebulizer Therapy Session',
      baseFeeSdg: 8000.00,
      baseFeeUsd: 5.33,
      category: 'CLINICAL_PROCEDURE'
    },

    // Radiology
    {
      labelAr: 'صورة أشعة للصدر',
      labelEn: 'Chest X-Ray Digital',
      baseFeeSdg: 25000.00,
      baseFeeUsd: 16.67,
      category: 'RADIOLOGY'
    }
  ];

  for (const svc of services) {
    const existing = await prisma.clinicalService.findFirst({
      where: {
        labelEn: svc.labelEn,
        category: svc.category
      }
    });

    // Existing rows are clinic configuration. Seed reruns must never overwrite
    // prices or activation state chosen by the clinic.
    if (!existing) {
      await prisma.clinicalService.create({
        data: svc
      });
    }
  }

  // 7. Seed Drug Formulary
  const drugCount = await prisma.drugFormulary.count();
  if (drugCount === 0) {
    console.log('Seeding drug formulary...');
    const drugs = [
      { labelAr: 'أموكسيسيلين 500 ملغ', labelEn: 'Amoxicillin 500mg', genericName: 'Amoxicillin', strength: '500mg', dosageForm: 'Capsule' },
      { labelAr: 'باراسيتامول 500 ملغ', labelEn: 'Paracetamol 500mg', genericName: 'Paracetamol', strength: '500mg', dosageForm: 'Tablet' },
      { labelAr: 'فينتولين شراب', labelEn: 'Ventolin Syrup', genericName: 'Salbutamol', strength: '2mg/5ml', dosageForm: 'Syrup' },
      { labelAr: 'بروفين 400 ملغ', labelEn: 'Brufen 400mg', genericName: 'Ibuprofen', strength: '400mg', dosageForm: 'Tablet' }
    ];

    for (const drug of drugs) {
      const brandName = drug.labelEn;
      const batchNumber = `${drug.genericName.substring(0, 3).toUpperCase()}-B01`;
      await prisma.$transaction(async (tx) => {
        const createdDrug = await tx.drugFormulary.create({
          data: {
            ...drug,
            brandName,
            identityKey: buildMedicineIdentityKey({ ...drug, brandName })
          }
        });
        const createdBatch = await tx.inventoryBatch.create({
          data: {
            drugId: createdDrug.id,
            batchNumber,
            normalizedBatchNumber: normalizeBatchNumber(batchNumber),
            expiryDate: '2027-12-31',
            qtyOnHand: 100,
            minReorderLevel: 15
          }
        });
        await tx.stockMovement.create({
          data: {
            drugId: createdDrug.id,
            inventoryBatchId: createdBatch.id,
            movementType: 'OPENING_BALANCE',
            quantityDelta: createdBatch.qtyOnHand,
            resultingBalance: createdBatch.qtyOnHand,
            actorUserId: null,
            referenceType: 'SEED_OPENING_BALANCE',
            referenceId: createdBatch.id,
            reason: 'Local development and test seed opening balance.',
            idempotencyKey: `seed:opening-balance:${createdBatch.id}`
          }
        });
      });
    }
  }

  // 8. Seed Insurance Companies
  const insuranceCount = await prisma.insuranceCompany.count();
  if (insuranceCount === 0) {
    console.log('Seeding insurance companies...');
    const companies = [
      { labelAr: 'شركة شيكان للتأمين', labelEn: 'Shiekan Insurance', copayPercentage: 10.00, billingCycleDays: 30 },
      { labelAr: 'شركة البركة للتأمين', labelEn: 'Al-Barakah Insurance', copayPercentage: 20.00, billingCycleDays: 30 },
      { labelAr: 'الشركة الإسلامية للتأمين', labelEn: 'Islamic Insurance Company', copayPercentage: 15.00, billingCycleDays: 30 }
    ];

    for (const comp of companies) {
      await prisma.insuranceCompany.create({
        data: comp
      });
    }
  }

  console.log('Seed process completed successfully.');
}

main()
  .catch((e) => {
    console.error('Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
