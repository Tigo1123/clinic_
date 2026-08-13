import express from 'express';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { decrypt } from '../utils/encryption.js';

const router = express.Router();

/**
 * GET /api/patients/search
 * Searches patients by name (Arabic or English), phone, or national ID.
 */
router.get('/search', authenticate, async (req, res) => {
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
 * POST /api/patients
 * Registers a new patient.
 */
router.post('/', authenticate, checkRoles('ADMIN', 'RECEPTIONIST'), async (req, res) => {
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
router.get('/:id', authenticate, async (req, res) => {
  try {
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
 * - Decrypts clinical details (symptoms, diagnosis, notes) if the doctor owns the record,
 *   or if a valid Consent / active Break-the-Glass exists.
 * - Otherwise, masks clinical details with a LOCKED status.
 */
router.get('/:id/history', authenticate, async (req, res) => {
  const patientId = req.params.id;
  const user = req.user; // { id, role }

  try {
    // 1. Fetch patient
    const patient = await prisma.patient.findUnique({
      where: { id: patientId }
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    // 2. Fetch all medical records (visits)
    const records = await prisma.medicalRecord.findMany({
      where: { patientId },
      include: {
        doctor: true,
        appointment: true
      },
      orderBy: { visitDate: 'desc' }
    });

    // 3. Check for active consent or active Break-the-Glass logs
    let hasFullAccess = false;

    // Check EMR Consent table
    const activeConsent = await prisma.consent.findFirst({
      where: {
        patientId,
        consentType: 'EMR_ACCESS',
        timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // valid for 24h
      }
    });

    if (activeConsent) {
      hasFullAccess = true;
    }

    // Check if Doctor requested Break-the-Glass override in the last 2 hours
    if (user.role === 'DOCTOR') {
      const activeBypass = await prisma.tenantAuditLog.findFirst({
        where: {
          userId: user.id,
          action: `EMR_BREAK_THE_GLASS_BYPASS:${patientId}`,
          timestamp: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } // valid for 2h
        }
      });
      if (activeBypass) {
        hasFullAccess = true;
      }
    }

    // 4. Map records according to access level
    const parsedHistory = records.map((rec) => {
      const isRecordOwner = user.role === 'DOCTOR' && rec.doctor.userId === user.id;
      const canViewClinical = hasFullAccess || isRecordOwner;

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
        isLocked: !canViewClinical,
        // Decrypt values if authorized, otherwise return masked placeholder
        symptoms: canViewClinical ? decrypt(rec.symptomsEncrypted) : '[LOCKED - Requires Consent]',
        diagnosis: canViewClinical ? decrypt(rec.diagnosisEncrypted) : '[LOCKED - Requires Consent]',
        treatment: canViewClinical ? decrypt(rec.treatmentEncrypted) : '[LOCKED - Requires Consent]',
        clinicalNotes: canViewClinical ? decrypt(rec.clinicalNotesEncrypted) : '[LOCKED - Requires Consent]',
        attachmentPath: canViewClinical ? rec.attachmentPath : null
      };
    });

    return res.json({
      patientId: patient.id,
      fullNameAr: patient.fullNameAr,
      fullNameEn: patient.fullNameEn,
      hasFullAccess,
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
router.get('/:id/profile', authenticate, async (req, res) => {
  const patientId = req.params.id;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required.' });
  }

  try {
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
        symptoms: safeDecryptField(rec.symptomsEncrypted),
        diagnosis: safeDecryptField(rec.diagnosisEncrypted),
        treatment: safeDecryptField(rec.treatmentEncrypted),
        clinicalNotes: safeDecryptField(rec.clinicalNotesEncrypted),
        prescriptionsCount: (rec.prescriptions || []).reduce((acc, p) => acc + (p.prescribedDrugs?.length || 0), 0),
        labOrdersCount: (rec.labOrders || []).reduce((acc, lo) => acc + (lo.items?.length || 0), 0)
      };
    });

    const activeClaim = patient.insuranceClaims?.[0];

    const profileData = {
      id: patient.id,
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
