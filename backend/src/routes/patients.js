import express from 'express';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { decrypt } from '../utils/encryption.js';
import { allowRoles, doctorHasPatientAccess, getDoctorMedicalRecordAccess, ROLES } from '../middleware/policies.js';
import { sendError } from '../utils/apiError.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { getClinicDateString } from '../utils/clinicTime.js';
import { findPossiblePatientDuplicates, normalizeFileNumber, normalizeNationalId, normalizePatientPhone, safeDuplicateCandidates } from '../utils/patientIdentity.js';

const router = express.Router();

/**
 * GET /api/patients/search
 * Searches patients by name (Arabic or English), phone, or national ID.
 */
router.get('/search', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const parsed = z.object({ q: z.string().trim().min(2).max(120), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict().safeParse(req.query);
  if (!parsed.success) return sendError(res, 422, 'PATIENT_SEARCH_INVALID', 'Patient search parameters are invalid.');
  const { q, limit } = parsed.data;
  const exactNationalId = normalizeNationalId(q);
  const exactFileNumber = normalizeFileNumber(q);
  if (/^shf-/i.test(q) && !exactFileNumber) return sendError(res, 422, 'PATIENT_SEARCH_INVALID', 'Patient search parameters are invalid.');

  try {
    const select = { id: true, fileNumber: true, fullNameAr: true, fullNameEn: true, phone: true, dateOfBirth: true, gender: true, status: true };
    const exact = exactFileNumber
      ? await prisma.patient.findFirst({ where: { fileNumber: exactFileNumber, status: 'ACTIVE' }, select })
      : null;
    const patients = await prisma.patient.findMany({
      where: { status: 'ACTIVE', ...(exact?.id ? { id: { not: exact.id } } : {}), OR: [
        { fullNameAr: { contains: q, mode: 'insensitive' } },
        { fullNameEn: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        ...(exactNationalId ? [{ nationalId: exactNationalId }] : [])
      ] },
      select,
      orderBy: [{ fullNameEn: 'asc' }, { fullNameAr: 'asc' }, { id: 'asc' }],
      take: Math.max(limit - (exact ? 1 : 0), 0)
    });

    return res.json(exact ? [exact, ...patients] : patients);
  } catch (error) {
    console.error('Patient search error:', error);
    return res.status(500).json({ error: 'Failed to search patients.' });
  }
});

/**
 * GET /api/patients
 * Returns a safe patient directory for Admin and Receptionist users.
 */
router.get(
  '/',
  authenticate,
  allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const parsedLimit = Number.parseInt(req.query.limit, 10);

      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 100)
        : 50;

      const patients = await prisma.patient.findMany({
        where: {
          status: 'ACTIVE'
        },
        select: {
          id: true,
          fileNumber: true,
          fullNameAr: true,
          fullNameEn: true,
          phone: true,
          dateOfBirth: true,
          gender: true,
          userId: true,
          createdAt: true
        },
        orderBy: [
          {
            fullNameEn: 'asc'
          },
          {
            fullNameAr: 'asc'
          }
        ],
        take: limit
      });

      return res.json(
        patients.map((patient) => ({
          id: patient.id,
          fileNumber: patient.fileNumber,
          fullNameAr: patient.fullNameAr,
          fullNameEn: patient.fullNameEn,
          phone: patient.phone,
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
          portalLinked: Boolean(patient.userId),
          createdAt: patient.createdAt
        }))
      );
    } catch (error) {
      console.error('Patient directory error:', error);

      return sendError(
        res,
        500,
        'PATIENT_DIRECTORY_FAILED',
        'Failed to load patient directory.'
      );
    }
  }
);

/**
 * POST /api/patients
 * Registers a new patient.
 */
router.post('/', authenticate, checkRoles('ADMIN', 'RECEPTIONIST'), (req, res, next) => {
  if (Object.hasOwn(req.body || {}, 'fileNumber') || Object.hasOwn(req.body || {}, 'mrn')) {
    return sendError(res, 422, 'PATIENT_IDENTITY_FIELD_FORBIDDEN', 'Patient file identity fields cannot be supplied by the client.');
  }
  return next();
}, validate(z.object({
  fullNameAr: z.string().trim().min(2).max(150), fullNameEn: z.string().trim().min(2).max(150),
  gender: z.enum(['MALE', 'FEMALE']), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nationalId: z.string().trim().max(30).optional(), phone: z.string().trim().min(7).max(30),
  addressStateId: z.coerce.number().int().min(1).max(18), addressDetails: z.string().trim().max(300).optional(),
  emergencyContact: z.string().trim().max(150).optional(), nationalIdAttachmentPath: z.string().max(300).optional(),
  insuranceAttachmentPath: z.string().max(300).optional()
})), async (req, res) => {
  const {
    fullNameAr,
    fullNameEn,
    gender,
    dateOfBirth,
    nationalId,
    phone,
    addressStateId,
    addressDetails,
    emergencyContact,
    nationalIdAttachmentPath,
    insuranceAttachmentPath
  } = req.body;

  if (!fullNameAr || !fullNameEn || !gender || !dateOfBirth || !phone || !addressStateId) {
    return res.status(400).json({ error: 'Missing mandatory registration fields.' });
  }

  const finalEmergencyContact = emergencyContact || 'Self';
  if (dateOfBirth >= getClinicDateString()) {
    return sendError(res, 422, 'INVALID_DATE_OF_BIRTH', 'Date of birth must be in the past.');
  }

  try {
    const normalizedPhone = normalizePatientPhone(phone);
    const normalizedNationalId = normalizeNationalId(nationalId);
    if (!normalizedPhone) return sendError(res, 422, 'PHONE_INVALID', 'Phone number is invalid.');
    if (nationalId && !normalizedNationalId) return sendError(res, 422, 'NATIONAL_ID_INVALID', 'National ID is invalid.');
    const candidates = await findPossiblePatientDuplicates(prisma, { phone: normalizedPhone, dateOfBirth, nationalId: normalizedNationalId });
    if (candidates.length) return sendError(res, 409, 'POSSIBLE_PATIENT_DUPLICATE', 'A possible existing patient was found. Search and select the existing patient or review the identity before creating a new record.', safeDuplicateCandidates(candidates));

    const patient = await prisma.$transaction(async (tx) => {
      const created = await tx.patient.create({
        data: {
          fullNameAr, fullNameEn, gender, dateOfBirth, nationalId: normalizedNationalId,
          phone: normalizedPhone, addressStateId: parseInt(addressStateId), addressDetails,
          emergencyContact: finalEmergencyContact, status: 'ACTIVE',
          nationalIdAttachmentPath: nationalIdAttachmentPath || null,
          insuranceAttachmentPath: insuranceAttachmentPath || null
        },
        include: { addressState: true }
      });
      await tx.tenantAuditLog.create({ data: {
        userId: req.user.id,
        action: 'PATIENT_FILE_CREATED',
        details: JSON.stringify({ patientId: created.id, fileNumber: created.fileNumber, context: 'RECEPTION_REGISTRATION' }),
        ipAddress: req.ip || 'unknown'
      } });
      return created;
    });

    return res.status(201).json(patient);
  } catch (error) {
    if (error?.code === 'P2002') return sendError(res, 409, 'POSSIBLE_PATIENT_DUPLICATE', 'A possible existing patient was found. Search and review the identity before creating a new record.');
    console.error('Patient registration error:', error);
    return res.status(500).json({ error: 'Failed to register patient.' });
  }
});

/**
 * GET /api/patients/:id
 * Fetches basic demographic info for a specific patient.
 */
router.get('/:id', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DOCTOR), async (req, res) => {
  try {
    if (req.user.role === ROLES.DOCTOR && !(await doctorHasPatientAccess(req.user, req.params.id))) {
      return sendError(res, 403, 'PATIENT_ACCESS_FORBIDDEN', 'This patient is not assigned to the authenticated doctor.');
    }
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: { addressState: true }
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    return res.json(patient);
  } catch (error) {
    console.error('Fetch patient error:', error);
    return res.status(500).json({ error: 'Failed to retrieve patient.' });
  }
});

/**
 * GET /api/patients/:id/history
 * Retrieves EMR timeline history. Evaluates role-permission boundaries:
 * - Returns records owned by the doctor, or all patient records if verified
 *   Consent / active Break-the-Glass access exists.
 * - Filters unauthorized records in the database query before decryption.
 */
router.get('/:id/history', authenticate, allowRoles(ROLES.DOCTOR), async (req, res) => {
  const patientId = req.params.id;
  const user = req.user; // { id, role }

  try {
    if (!(await doctorHasPatientAccess(user, patientId))) {
      return sendError(res, 403, 'PATIENT_ACCESS_FORBIDDEN', 'This patient is not assigned to the authenticated doctor.');
    }
    // 1. Fetch patient
    const patient = await prisma.patient.findUnique({
      where: { id: patientId }
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    const recordAccess = await getDoctorMedicalRecordAccess(user, patientId);

    // 2. Fetch only medical records authorized for this doctor.
    const records = await prisma.medicalRecord.findMany({
      where: recordAccess.where,
      include: {
        doctor: true,
        appointment: true
      },
      orderBy: { visitDate: 'desc' }
    });

    // 3. Every selected record is authorized before decryption.
    const parsedHistory = records.map((rec) => {
      return {
        id: rec.id,
        recordId: rec.id,
        appointmentId: rec.appointmentId,
        visitDate: rec.visitDate,
        doctorNameAr: rec.doctor.fullNameAr,
        doctorNameEn: rec.doctor.fullNameEn,
        specialtyAr: rec.doctor.specialtyAr,
        specialtyEn: rec.doctor.specialtyEn,
        vitalSigns: JSON.parse(rec.vitalSignsJson),
        isLocked: false,
        symptoms: decrypt(rec.symptomsEncrypted),
        diagnosis: decrypt(rec.diagnosisEncrypted),
        treatment: decrypt(rec.treatmentEncrypted),
        clinicalNotes: decrypt(rec.clinicalNotesEncrypted),
        attachmentPath: rec.attachmentPath
      };
    });

    return res.json({
      patientId: patient.id,
      fileNumber: patient.fileNumber,
      fullNameAr: patient.fullNameAr,
      fullNameEn: patient.fullNameEn,
      hasFullAccess: recordAccess.hasCrossDoctorAccess,
      history: parsedHistory
    });

  } catch (error) {
    console.error('EMR history error:', error);
    return res.status(500).json({ error: 'Failed to retrieve medical history.' });
  }
});

/**
 * Helper to safely decrypt strings or return plain text fallback.
 */
function safeDecryptField(encryptedVal) {
  if (!encryptedVal) return '';
  try {
    const result = decrypt(encryptedVal);
    if (result && !result.startsWith('[Decryption Error')) {
      return result;
    }
  } catch {
    // Never return ciphertext when a permitted field cannot be decrypted.
  }
  return '';
}

/**
 * GET /api/patients/:id/profile
 * Retrieves full master patient profile with demographics, insurance,
 * and chronological visit history ordered from newest to oldest.
 */
router.get('/:id/profile', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DOCTOR), async (req, res) => {
  const patientId = req.params.id;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required.' });
  }

  try {
    const isDoctor = req.user.role === ROLES.DOCTOR;
    const canViewBilling = req.user.role === ROLES.ADMIN || req.user.role === ROLES.RECEPTIONIST;
    const canViewPatientProfile = isDoctor && await doctorHasPatientAccess(req.user, patientId);
    if (isDoctor && !canViewPatientProfile) {
      return sendError(res, 403, 'PATIENT_ACCESS_FORBIDDEN', 'This patient is not assigned to the authenticated doctor.');
    }
    const recordAccess = isDoctor
      ? await getDoctorMedicalRecordAccess(req.user, patientId)
      : null;
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        fileNumber: true,
        fullNameAr: true,
        fullNameEn: true,
        gender: true,
        ...(isDoctor ? { bloodType: true } : {}),
        dateOfBirth: true,
        phone: true,
        emergencyContact: true,
        status: true,
        userId: true,
        addressState: { select: { labelAr: true, labelEn: true } },
        appointments: {
          where: isDoctor ? { doctorId: req.user.doctorId } : undefined,
          orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'desc' }],
          take: 50,
          select: {
            id: true,
            appointmentDate: true,
            appointmentTime: true,
            status: true,
            doctor: { select: { fullNameAr: true, fullNameEn: true, specialtyAr: true, specialtyEn: true } }
          }
        },
        ...(canViewBilling ? { invoices: {
          orderBy: { invoiceDate: 'desc' },
          take: 50,
          select: {
            id: true, invoiceDate: true, totalAmountSdg: true, totalAmountUsd: true,
            paymentStatus: true, invoiceType: true
          }
        } } : {}),
        ...(canViewBilling ? { insuranceClaims: {
          take: 1,
          orderBy: [{ submissionDate: 'desc' }, { paymentDate: 'desc' }],
          select: {
            claimStatus: true,
            insuranceCompany: { select: { labelAr: true, labelEn: true, copayPercentage: true } }
          }
        } } : {}),
        ...(isDoctor ? { medicalRecords: {
          where: recordAccess?.where,
          orderBy: { visitDate: 'desc' },
          take: 50,
          include: {
            doctor: { select: { fullNameAr: true, fullNameEn: true, specialtyAr: true, specialtyEn: true } },
            prescriptions: {
              orderBy: { prescriptionDate: 'desc' },
              include: {
                prescribedDrugs: {
                  select: {
                    customDrugName: true, dosage: true, duration: true,
                    instructionsAr: true, instructionsEn: true,
                    qtyPrescribed: true, qtyDispensed: true,
                    drug: { select: { labelAr: true, labelEn: true, genericName: true, strength: true, dosageForm: true } }
                  }
                }
              }
            },
            labOrders: {
              orderBy: { orderDate: 'desc' },
              include: {
                items: {
                  select: {
                    customTestName: true, resultValue: true, referenceRangeMin: true,
                    referenceRangeMax: true, isOutOfRange: true,
                    service: { select: { labelAr: true, labelEn: true } }
                  }
                }
              }
            }
          }
        } } : {})
      }
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    // Format past visits chronologically (newest first)
    const permittedRecords = patient.medicalRecords || [];
    const visits = permittedRecords.map((rec) => {
      let vitals = {};
      if (rec.vitalSignsJson) {
        try {
          vitals = typeof rec.vitalSignsJson === 'string' ? JSON.parse(rec.vitalSignsJson) : rec.vitalSignsJson;
        } catch (e) {
          vitals = {};
        }
      }

      return {
        id: rec.id,
        recordId: rec.id,
        appointmentId: rec.appointmentId,
        visitDate: rec.visitDate,
        doctor: {
          fullNameAr: rec.doctor?.fullNameAr || '',
          fullNameEn: rec.doctor?.fullNameEn || '',
          specialtyAr: rec.doctor?.specialtyAr || '',
          specialtyEn: rec.doctor?.specialtyEn || ''
        },
        vitals,
        symptoms: isDoctor ? safeDecryptField(rec.symptomsEncrypted) : undefined,
        diagnosis: isDoctor ? safeDecryptField(rec.diagnosisEncrypted) : undefined,
        treatment: isDoctor ? safeDecryptField(rec.treatmentEncrypted) : undefined,
        clinicalNotes: isDoctor ? safeDecryptField(rec.clinicalNotesEncrypted) : undefined,
        prescriptionsCount: (rec.prescriptions || []).reduce((acc, p) => acc + (p.prescribedDrugs?.length || 0), 0),
        labOrdersCount: (rec.labOrders || []).reduce((acc, lo) => acc + (lo.items?.length || 0), 0)
      };
    });

    const prescriptions = permittedRecords.flatMap((record) =>
      (record.prescriptions || []).map((prescription) => ({
        id: prescription.id,
        prescriptionDate: prescription.prescriptionDate,
        status: prescription.status,
        doctor: record.doctor,
        medicines: prescription.prescribedDrugs.map((item) => ({
          nameAr: item.drug?.labelAr || item.customDrugName || '',
          nameEn: item.drug?.labelEn || item.customDrugName || '',
          genericName: item.drug?.genericName || item.customDrugName || '',
          strength: item.drug?.strength || '',
          dosageForm: item.drug?.dosageForm || '',
          dosage: item.dosage,
          duration: item.duration,
          instructionsAr: item.instructionsAr,
          instructionsEn: item.instructionsEn,
          qtyPrescribed: item.qtyPrescribed,
          qtyDispensed: item.qtyDispensed
        }))
      }))
    ).sort((a, b) => new Date(b.prescriptionDate) - new Date(a.prescriptionDate)).slice(0, 50);

    const laboratory = permittedRecords.flatMap((record) =>
      (record.labOrders || []).map((order) => ({
        id: order.id,
        orderDate: order.orderDate,
        status: order.status,
        doctor: record.doctor,
        tests: order.items.map((item) => ({
          nameAr: item.service?.labelAr || item.customTestName || '',
          nameEn: item.service?.labelEn || item.customTestName || '',
          resultValue: item.resultValue,
          referenceRangeMin: item.referenceRangeMin == null ? null : Number(item.referenceRangeMin),
          referenceRangeMax: item.referenceRangeMax == null ? null : Number(item.referenceRangeMax),
          isOutOfRange: item.isOutOfRange
        }))
      }))
    ).sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate)).slice(0, 50);

    const activeClaim = patient.insuranceClaims?.[0];

    const profileData = {
      id: patient.id,
      fileNumber: patient.fileNumber,
      portalLinked: Boolean(patient.userId),
      fullNameAr: patient.fullNameAr,
      fullNameEn: patient.fullNameEn,
      gender: patient.gender,
      ...(isDoctor ? { bloodType: patient.bloodType || null } : {}),
      dateOfBirth: patient.dateOfBirth,
      phone: patient.phone,
      status: patient.status,
      emergencyContact: patient.emergencyContact || '',
      addressState: patient.addressState ? {
        id: patient.addressState.id,
        labelAr: patient.addressState.labelAr,
        labelEn: patient.addressState.labelEn
      } : null,
      insurance: activeClaim ? {
        providerName: activeClaim.insuranceCompany?.labelAr || activeClaim.insuranceCompany?.labelEn || 'Insurance',
        claimStatus: activeClaim.claimStatus,
        coverageRate: activeClaim.insuranceCompany?.copayPercentage ? Number(activeClaim.insuranceCompany.copayPercentage) : 0
      } : null,
      visitsCount: visits.length,
      visits,
      prescriptions,
      laboratory,
      summaryCounts: {
        appointments: patient.appointments.length,
        visits: visits.length,
        prescriptions: prescriptions.length,
        labOrders: laboratory.length,
        invoices: canViewBilling ? (patient.invoices || []).length : undefined
      },
      availableSections: isDoctor
        ? ['overview', 'appointments', 'visits', 'prescriptions', 'laboratory']
        : ['overview', 'appointments', 'billing'],
      appointments: (patient.appointments || []).map((appointment) => ({
        id: appointment.id,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        status: appointment.status,
        doctor: appointment.doctor ? {
          fullNameAr: appointment.doctor.fullNameAr,
          fullNameEn: appointment.doctor.fullNameEn,
          specialtyAr: appointment.doctor.specialtyAr,
          specialtyEn: appointment.doctor.specialtyEn
        } : null
      })),
      invoices: canViewBilling ? (patient.invoices || []).map((invoice) => ({
        id: invoice.id,
        invoiceDate: invoice.invoiceDate,
        totalAmountSdg: Number(invoice.totalAmountSdg),
        totalAmountUsd: Number(invoice.totalAmountUsd),
        paymentStatus: invoice.paymentStatus,
        invoiceType: invoice.invoiceType
      })) : []
    };

    return res.json(profileData);
  } catch (error) {
    console.error('Fetch patient profile error:', error);
    return res.status(500).json({ error: 'Failed to retrieve patient profile.' });
  }
});

export default router;
