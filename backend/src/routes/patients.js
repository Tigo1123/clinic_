import express from 'express';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { decrypt } from '../utils/encryption.js';
import { allowRoles, doctorHasPatientAccess, getDoctorMedicalRecordAccess, ROLES } from '../middleware/policies.js';
import { sendError } from '../utils/apiError.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { getClinicDateString } from '../utils/clinicTime.js';

const router = express.Router();

/**
 * GET /api/patients/search
 * Searches patients by name (Arabic or English), phone, or national ID.
 */
router.get('/search', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.json([]);
  }

  try {
    const patients = await prisma.patient.findMany({
      where: {
        OR: [
          { fullNameAr: { contains: q } },
          { fullNameEn: { contains: q } },
          { phone: { contains: q } },
          { nationalId: { contains: q } }
        ]
      },
      include: {
        addressState: true
      },
      take: 20
    });

    return res.json(patients);
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
router.post('/', authenticate, checkRoles('ADMIN', 'RECEPTIONIST'), validate(z.object({
  fullNameAr: z.string().trim().min(2).max(150), fullNameEn: z.string().trim().min(2).max(150),
  gender: z.enum(['MALE', 'FEMALE']), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nationalId: z.string().trim().max(30).optional(), phone: z.string().trim().min(7).max(20),
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
    // Check if national ID or phone is already registered (deduplication check)
    if (nationalId) {
      const existingById = await prisma.patient.findUnique({
        where: { nationalId }
      });
      if (existingById) {
        return res.status(409).json({ error: 'A patient with this National ID is already registered.' });
      }
    }

    const patient = await prisma.patient.create({
      data: {
        fullNameAr,
        fullNameEn,
        gender,
        dateOfBirth,
        nationalId: nationalId || null,
        phone,
        addressStateId: parseInt(addressStateId),
        addressDetails,
        emergencyContact: finalEmergencyContact,
        status: 'ACTIVE',
        nationalIdAttachmentPath: nationalIdAttachmentPath || null,
        insuranceAttachmentPath: insuranceAttachmentPath || null
      },
      include: {
        addressState: true
      }
    });

    return res.status(201).json(patient);
  } catch (error) {
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
  } catch (e) {
    // Ignore and fallback to raw text
  }
  return encryptedVal;
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
    const canViewPatientProfile = isDoctor && await doctorHasPatientAccess(req.user, patientId);
    if (isDoctor && !canViewPatientProfile) {
      return sendError(res, 403, 'PATIENT_ACCESS_FORBIDDEN', 'This patient is not assigned to the authenticated doctor.');
    }
    const recordAccess = isDoctor
      ? await getDoctorMedicalRecordAccess(req.user, patientId)
      : null;
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        addressState: true,
        insuranceClaims: {
          include: {
            insuranceCompany: true
          }
        },
        medicalRecords: {
          where: recordAccess?.where,
          orderBy: { visitDate: 'desc' },
          include: {
            doctor: true,
            prescriptions: {
              include: {
                prescribedDrugs: {
                  include: { drug: true }
                }
              }
            },
            labOrders: {
              include: {
                items: {
                  include: { service: true }
                }
              }
            }
          }
        }
      }
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    // Format past visits chronologically (newest first)
    const visits = (patient.medicalRecords || []).map((rec) => {
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
          id: rec.doctor?.id || '',
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

    const activeClaim = patient.insuranceClaims?.[0];

    const profileData = {
      id: patient.id,
      portalLinked: Boolean(patient.userId),
      fullNameAr: patient.fullNameAr,
      fullNameEn: patient.fullNameEn,
      gender: patient.gender,
      dateOfBirth: patient.dateOfBirth,
      phone: patient.phone,
      nationalId: patient.nationalId || '',
      bloodType: 'N/A',
      allergies: '',
      chronicConditions: '',
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
      visits
    };

    return res.json(profileData);
  } catch (error) {
    console.error('Fetch patient profile error:', error);
    return res.status(500).json({ error: 'Failed to retrieve patient profile.' });
  }
});

export default router;
