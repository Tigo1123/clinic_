import express from 'express';
import { Prisma } from '../generated/prisma/index.js';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { sendEmail } from '../utils/notifications.js';
import { allowRoles, ROLES, doctorHasPatientAccess } from '../middleware/policies.js';
import { sendError } from '../utils/apiError.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { emitQueueUpdate } from '../utils/socketEvents.js';
import { getClinicDateString } from '../utils/clinicTime.js';
import {
  buildMedicineIdentityKey,
  inventoryBatchSchema,
  isMedicineIdentityUniqueViolation,
  normalizeBatchNumber,
  pharmacistMedicineSchema,
  stockMovementSchema
} from '../utils/medicineManagement.js';
import { ensurePharmacyInvoiceInTransaction } from '../services/pharmacyInvoice.js';

const router = express.Router();

const ACTIVE_PRESCRIPTION_STATUSES = ['ACTIVE', 'PARTIALLY_FILLED'];
const TERMINAL_PRESCRIPTION_STATUSES = ['FILLED', 'RESOLVED', 'CANCELLED'];

async function refreshPrescriptionResolution(tx, prescriptionId) {
  const items = await tx.prescribedDrug.findMany({
    where: { prescriptionId },
    select: {
      qtyPrescribed: true,
      qtyDispensed: true,
      pharmacyReviewStatus: true
    }
  });
  const hasUnavailable = items.some((item) => item.pharmacyReviewStatus === 'EXTERNAL');
  const allResolved = items.length > 0 && items.every((item) =>
    item.pharmacyReviewStatus === 'EXTERNAL'
    || Number(item.qtyDispensed) >= Number(item.qtyPrescribed)
  );
  const anyDispensed = items.some((item) => Number(item.qtyDispensed) > 0);
  const status = allResolved
    ? (hasUnavailable ? 'RESOLVED' : 'FILLED')
    : (anyDispensed ? 'PARTIALLY_FILLED' : 'ACTIVE');
  await tx.prescription.update({ where: { id: prescriptionId }, data: { status } });
  return status;
}

function authorityError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

async function lockAndValidateClinicalSelections(tx, { prescribedDrugs = [], orderedServices = [] }) {
  const drugIds = [...new Set(
    prescribedDrugs.map((item) => item.drugId).filter(Boolean)
  )].sort();
  const serviceIds = [...new Set(orderedServices)].sort();

  if (drugIds.length > 0) {
    const medicines = await tx.$queryRaw`
      SELECT "id", "status"
      FROM "DrugFormulary"
      WHERE "id" IN (${Prisma.join(drugIds)})
      ORDER BY "id"
      FOR UPDATE
    `;
    const medicinesById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
    const missingId = drugIds.find((id) => !medicinesById.has(id));
    if (missingId) {
      throw authorityError(404, 'FORMULARY_MEDICINE_NOT_FOUND', 'A selected formulary medicine was not found.');
    }
    if (drugIds.some((id) => medicinesById.get(id).status !== 'ACTIVE')) {
      throw authorityError(409, 'FORMULARY_MEDICINE_INACTIVE', 'A selected formulary medicine is inactive.');
    }
  }

  if (serviceIds.length > 0) {
    const services = await tx.$queryRaw`
      SELECT "id", "status", "category"
      FROM "ClinicalService"
      WHERE "id" IN (${Prisma.join(serviceIds)})
      ORDER BY "id"
      FOR UPDATE
    `;
    const servicesById = new Map(services.map((service) => [service.id, service]));
    const missingId = serviceIds.find((id) => !servicesById.has(id));
    if (missingId) {
      throw authorityError(404, 'CLINICAL_SERVICE_NOT_FOUND', 'A selected clinical service was not found.');
    }
    if (serviceIds.some((id) => servicesById.get(id).status !== 'ACTIVE')) {
      throw authorityError(409, 'CLINICAL_SERVICE_INACTIVE', 'A selected clinical service is inactive.');
    }
    if (serviceIds.some((id) => servicesById.get(id).category !== 'LABORATORY')) {
      throw authorityError(422, 'CLINICAL_SERVICE_NOT_LABORATORY', 'A selected clinical service is not eligible for a laboratory order.');
    }
  }
}

/**
 * POST /api/records
 * Saves the consultation results. Encrypts clinical fields, serializes vitals,
 * and creates prescriptions and lab orders in a single atomic transaction.
 */
router.post('/', authenticate, checkRoles('DOCTOR'), validate(z.object({
  patientId: z.string().uuid(), appointmentId: z.string().uuid(), symptoms: z.string().max(5000).optional(),
  diagnosis: z.string().trim().max(5000).optional(), treatment: z.string().max(5000).optional(), clinicalNotes: z.string().max(10000).optional(),
  vitalSigns: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  prescribedDrugs: z.array(
    z.object({
      drugId: z.string().uuid().optional(),
      customDrugName: z.string().trim().min(1).max(200).optional(),
      dosage: z.string().min(1).max(200),
      duration: z.string().min(1).max(200),
      instructionsAr: z.string().max(1000).optional(),
      instructionsEn: z.string().max(1000).optional(),
      qtyPrescribed: z.coerce.number().int().positive()
    }).refine(
      (drug) => Boolean(drug.drugId) !== Boolean(drug.customDrugName),
      { message: 'Provide either drugId or customDrugName, but not both.' }
    )
  ).max(50).optional(),
  orderedServices: z.array(z.string().uuid()).max(50).optional(),
  customTests: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  attachmentPath: z.string().max(300).optional()
})), async (req, res) => {
  const {
    patientId,
    appointmentId,
    symptoms,
    diagnosis,
    treatment,
    clinicalNotes,
    vitalSigns, // { blood_pressure, heart_rate, temperature, weight }
    prescribedDrugs, // Array of { drugId, dosage, duration, instructionsAr, instructionsEn, qtyPrescribed }
    orderedServices, // Array of ClinicalService IDs
    customTests, // Array of free-text laboratory test names
    attachmentPath
  } = req.body;

  if (!patientId || !appointmentId) {
    return res.status(400).json({
      error: 'Patient ID and Appointment ID are required.'
    });
  }

  const hasLabOrders =
    (Array.isArray(orderedServices) && orderedServices.length > 0) ||
    (Array.isArray(customTests) && customTests.length > 0);

  if (!hasLabOrders && !diagnosis?.trim()) {
    return sendError(
      res,
      422,
      'DIAGNOSIS_REQUIRED',
      'Diagnosis is required when completing a visit without laboratory orders.'
    );
  }

  let doctorId = req.user.doctorId;
  if (!doctorId && req.user.role === 'DOCTOR') {
    const doc = await prisma.doctor.findUnique({
      where: { userId: req.user.id }
    });
    doctorId = doc ? doc.id : null;
  }

  if (!doctorId) {
    return res.status(403).json({ error: 'Only registered doctors with assigned profiles can complete consultations.' });
  }

  try {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment || appointment.doctorId !== doctorId || appointment.patientId !== patientId) {
      return sendError(res, 403, 'CONSULTATION_RELATIONSHIP_INVALID', 'The appointment is not assigned to this doctor and patient.');
    }
    if (appointment.status !== 'IN_CONSULTATION') {
      if (appointment.status === 'COMPLETED') {
        return sendError(res, 409, 'VISIT_ALREADY_COMPLETED', 'This completed visit is read-only.');
      }
      return sendError(res, 409, 'CONSULTATION_STATUS_INVALID', 'The appointment must be in consultation before clinical notes can be saved.');
    }
    // Check if EMR already exists for this appointment
    const existingRecord = await prisma.medicalRecord.findFirst({
      where: { appointmentId },
      include: {
        prescriptions: true,
        labOrders: true
      }
    });

    if (existingRecord) {
      return res.status(200).json({
        success: true,
        message: 'EMR consultation already saved.',
        recordId: existingRecord.id,
        record: existingRecord,
        prescriptions: existingRecord.prescriptions,
        labOrders: existingRecord.labOrders,
        data: { record: existingRecord, prescription: existingRecord.prescriptions[0] || null, labOrder: existingRecord.labOrders[0] || null }
      });
    }
    // 1. Encrypt clinical text fields
    const encryptedSymptoms = encrypt(symptoms || '');
    const encryptedDiagnosis = encrypt(diagnosis?.trim() || '');
    const encryptedTreatment = encrypt(treatment || '');
    const encryptedNotes = encrypt(clinicalNotes || '');
    const vitalSignsStr = JSON.stringify(vitalSigns || {});

    // Execute atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      await lockAndValidateClinicalSelections(tx, { prescribedDrugs, orderedServices });

      // a. Create EMR Medical Record
      const record = await tx.medicalRecord.create({
        data: {
          patientId,
          doctorId,
          appointmentId,
          symptomsEncrypted: encryptedSymptoms,
          diagnosisEncrypted: encryptedDiagnosis,
          treatmentEncrypted: encryptedTreatment,
          vitalSignsJson: vitalSignsStr,
          clinicalNotesEncrypted: encryptedNotes,
          attachmentPath: attachmentPath || null
        }
      });

      // b. If drugs are prescribed, create Prescription & PrescribedDrug items
      let prescription = null;
      if (prescribedDrugs && prescribedDrugs.length > 0) {
        prescription = await tx.prescription.create({
          data: {
            medicalRecordId: record.id,
            patientId,
            doctorId,
            status: 'ACTIVE'
          }
        });

        for (const drug of prescribedDrugs) {
          await tx.prescribedDrug.create({
            data: {
              prescriptionId: prescription.id,
              drugId: drug.drugId || null,
              customDrugName: drug.customDrugName || null,
              dosage: drug.dosage,
              duration: drug.duration,
              instructionsAr: drug.instructionsAr || '',
              instructionsEn: drug.instructionsEn || '',
              qtyPrescribed: parseInt(drug.qtyPrescribed),
              pharmacyReviewStatus: drug.drugId
                ? 'NOT_REQUIRED'
                : 'PENDING_REVIEW'
            }
          });
        }

        await ensurePharmacyInvoiceInTransaction(tx, {
          prescriptionId: prescription.id,
          actorUserId: req.user.id,
          ipAddress: req.ip || 'unknown',
          trigger: 'PRESCRIPTION_CREATED'
        });
      }

      // c. If lab/radiology tests are ordered, create LabOrder & LabOrderItems
      let labOrder = null;
      if (hasLabOrders) {
        labOrder = await tx.labOrder.create({
          data: {
            medicalRecordId: record.id,
            patientId,
            doctorId,
            status: 'PENDING_BILLING'
          }
        });

        for (const serviceId of orderedServices || []) {
          await tx.labOrderItem.create({
            data: {
              labOrderId: labOrder.id,
              serviceId,
              customTestName: null,
              labReviewStatus: 'NOT_REQUIRED',
              isOutOfRange: false
            }
          });
        }

        for (const customTestName of customTests || []) {
          await tx.labOrderItem.create({
            data: {
              labOrderId: labOrder.id,
              serviceId: null,
              customTestName: customTestName.trim(),
              labReviewStatus: 'PENDING_REVIEW',
              isOutOfRange: false
            }
          });
        }
      }

      // d. If laboratory/radiology work was ordered, keep the visit open
      // until all results are available. Otherwise complete the visit now.
      const nextAppointmentStatus =
        hasLabOrders
          ? 'WAITING_LAB'
          : 'COMPLETED';

      const transitionedAppointment = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'IN_CONSULTATION' },
        data: { status: nextAppointmentStatus }
      });
      if (transitionedAppointment.count !== 1) {
        throw authorityError(409, 'APPOINTMENT_STATE_CONFLICT', 'Appointment state changed before the consultation could be saved.');
      }

      return { record, prescription, labOrder };
    });

    // Emit WebSocket update
    const io = req.app.get('io');
    emitQueueUpdate(io, { type: 'CONSULTATION_COMPLETE', appointmentId, doctorId }, [doctorId]);

    return res.status(201).json({
      success: true,
      message: 'Consultation saved and EMR record created successfully.',
      recordId: result.record.id,
      record: result.record,
      data: result
    });

  } catch (error) {
    if (error.status && error.code) {
      return sendError(res, error.status, error.code, error.message);
    }
    console.error('Save clinical record error:', error);
    return res.status(500).json({ error: 'Failed to save EMR consultation record.' });
  }
});


/**
 * PUT /api/records/:id/finalize
 * Finalizes an existing consultation after laboratory results are ready.
 * Updates the SAME MedicalRecord and optionally creates the final prescription.
 */
router.put('/:id/finalize', authenticate, checkRoles('DOCTOR'), validate(z.object({
  diagnosis: z.string().trim().min(1).max(5000),
  treatment: z.string().max(5000).optional(),
  clinicalNotes: z.string().max(10000).optional(),
  vitalSigns: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  prescribedDrugs: z.array(
    z.object({
      drugId: z.string().uuid().optional(),
      customDrugName: z.string().trim().min(1).max(200).optional(),
      dosage: z.string().min(1).max(200),
      duration: z.string().min(1).max(200),
      instructionsAr: z.string().max(1000).optional(),
      instructionsEn: z.string().max(1000).optional(),
      qtyPrescribed: z.coerce.number().int().positive()
    }).refine(
      (drug) => Boolean(drug.drugId) !== Boolean(drug.customDrugName),
      { message: 'Provide either drugId or customDrugName, but not both.' }
    )
  ).max(50).optional()
})), async (req, res) => {
  const recordId = req.params.id;
  const {
    diagnosis,
    treatment,
    clinicalNotes,
    vitalSigns,
    prescribedDrugs
  } = req.body;

  let doctorId = req.user.doctorId;

  if (!doctorId && req.user.role === 'DOCTOR') {
    const doctor = await prisma.doctor.findUnique({
      where: { userId: req.user.id }
    });

    doctorId = doctor?.id || null;
  }

  if (!doctorId) {
    return sendError(
      res,
      403,
      'DOCTOR_PROFILE_REQUIRED',
      'A registered doctor profile is required.'
    );
  }

  try {
    const record = await prisma.medicalRecord.findUnique({
      where: { id: recordId },
      include: {
        appointment: true,
        labOrders: true
      }
    });

    if (!record) {
      return sendError(
        res,
        404,
        'MEDICAL_RECORD_NOT_FOUND',
        'Medical record not found.'
      );
    }

    if (record.doctorId !== doctorId) {
      return sendError(
        res,
        403,
        'RECORD_ACCESS_FORBIDDEN',
        'This medical record does not belong to the authenticated doctor.'
      );
    }

    if (record.appointment.status !== 'IN_CONSULTATION') {
      if (record.appointment.status === 'COMPLETED') {
        return sendError(res, 409, 'VISIT_ALREADY_COMPLETED', 'This completed visit is read-only.');
      }
      return sendError(
        res,
        409,
        'CONSULTATION_STATUS_INVALID',
        'The appointment must be in consultation before the visit can be finalized.'
      );
    }

    if (record.labOrders.length > 0) {
      const incompleteLabOrder = record.labOrders.some(
        (order) => order.status !== 'COMPLETED'
      );

      if (incompleteLabOrder) {
        return sendError(
          res,
          409,
          'LAB_RESULTS_NOT_READY',
          'All laboratory results must be completed before finalizing the visit.'
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockAndValidateClinicalSelections(tx, { prescribedDrugs });

      const updatedRecord = await tx.medicalRecord.update({
        where: { id: record.id },
        data: {
          diagnosisEncrypted: encrypt(diagnosis),
          treatmentEncrypted: encrypt(treatment || ''),
          clinicalNotesEncrypted: encrypt(clinicalNotes || ''),
          ...(vitalSigns
            ? { vitalSignsJson: JSON.stringify(vitalSigns) }
            : {})
        }
      });

      let prescription = null;

      if (prescribedDrugs && prescribedDrugs.length > 0) {
        prescription = await tx.prescription.create({
          data: {
            medicalRecordId: record.id,
            patientId: record.patientId,
            doctorId,
            status: 'ACTIVE'
          }
        });

        for (const drug of prescribedDrugs) {
          await tx.prescribedDrug.create({
            data: {
              prescriptionId: prescription.id,
              drugId: drug.drugId || null,
              customDrugName: drug.customDrugName || null,
              dosage: drug.dosage,
              duration: drug.duration,
              instructionsAr: drug.instructionsAr || '',
              instructionsEn: drug.instructionsEn || '',
              qtyPrescribed: Number(drug.qtyPrescribed),
              pharmacyReviewStatus: drug.drugId
                ? 'NOT_REQUIRED'
                : 'PENDING_REVIEW'
            }
          });
        }

        await ensurePharmacyInvoiceInTransaction(tx, {
          prescriptionId: prescription.id,
          actorUserId: req.user.id,
          ipAddress: req.ip || 'unknown',
          trigger: 'PRESCRIPTION_FINALIZED'
        });
      }

      const completedAppointment = await tx.appointment.updateMany({
        where: {
          id: record.appointmentId,
          status: 'IN_CONSULTATION'
        },
        data: {
          status: 'COMPLETED'
        }
      });

      if (completedAppointment.count !== 1) {
        throw new Error(
          'Appointment status changed before the consultation could be finalized.'
        );
      }

      return {
        record: updatedRecord,
        prescription
      };
    });

    const io = req.app.get('io');

    emitQueueUpdate(
      io,
      {
        type: 'CONSULTATION_FINALIZED',
        appointmentId: record.appointmentId,
        doctorId
      },
      [doctorId]
    );

    return res.json({
      success: true,
      message: 'Consultation finalized successfully.',
      recordId: result.record.id,
      record: result.record,
      prescription: result.prescription
    });

  } catch (error) {
    if (error.status && error.code) {
      return sendError(res, error.status, error.code, error.message);
    }

    console.error('Finalize consultation error:', error);

    if (
      error.message?.includes(
        'Appointment status changed before the consultation could be finalized'
      )
    ) {
      return sendError(
        res,
        409,
        'CONSULTATION_FINALIZE_CONFLICT',
        error.message
      );
    }

    return sendError(
      res,
      500,
      'CONSULTATION_FINALIZE_FAILED',
      'Failed to finalize consultation.'
    );
  }
});


/**
 * POST /api/records/bypass
 * Break-the-Glass Emergency Access Override.
 * Logs a CRITICAL bypass entry allowing 2-hour decryption authorization.
 */
router.post('/bypass', authenticate, checkRoles('DOCTOR'), async (req, res) => {
  const { patientId, justification } = req.body;

  if (!patientId || !justification || justification.length < 20) {
    return res.status(400).json({ error: 'Patient ID and a detailed justification (min 20 characters) are required.' });
  }

  try {
    // Create audit log entry
    await prisma.tenantAuditLog.create({
      data: {
        userId: req.user.id,
        action: `EMR_BREAK_THE_GLASS_BYPASS:${patientId}`,
        details: `Emergency EMR access override. Justification: ${justification}`,
        ipAddress: req.ip || '127.0.0.1'
      }
    });

    return res.json({
      success: true,
      message: 'Break-the-Glass authorization granted. EMR details unlocked for 2 hours.'
    });
  } catch (error) {
    console.error('Break the glass bypass error:', error);
    return res.status(500).json({ error: 'Failed to authorize break-the-glass override.' });
  }
});

/**
 * GET /api/records/drugs
 * Returns list of drugs and inventory levels.
 */
router.get('/drugs', authenticate, allowRoles(ROLES.DOCTOR, ROLES.PHARMACIST), async (req, res) => {
  try {
    const drugs = await prisma.drugFormulary.findMany({
      where: req.user.role === ROLES.DOCTOR ? { status: 'ACTIVE' } : undefined,
      include: {
        inventoryBatches: true
      }
    });
    return res.json(drugs);
  } catch (error) {
    console.error('Fetch drugs error:', error);
    return res.status(500).json({ error: 'Failed to retrieve drug formulary.' });
  }
});


/**
 * GET /api/records/medication-reviews/pending
 *
 * Pharmacist-only queue for free-text medicines entered by doctors
 * that have not yet been linked to the clinic formulary or marked
 * as external.
 */
router.get(
  '/medication-reviews/pending',
  authenticate,
  allowRoles(ROLES.PHARMACIST),
  async (req, res) => {
    try {
      const items = await prisma.prescribedDrug.findMany({
        where: {
          pharmacyReviewStatus: 'PENDING_REVIEW',
          drugId: null,
          customDrugName: {
            not: null
          },
          prescription: {
            status: {
              in: ['ACTIVE', 'PARTIALLY_FILLED']
            }
          }
        },
        include: {
          prescription: {
            select: {
              id: true,
              prescriptionDate: true,
              status: true,
              doctorId: true,
              patient: {
                select: {
                  id: true,
                  fullNameAr: true,
                  fullNameEn: true
                }
              }
            }
          }
        }
      });

      const queue = items
        .filter(
          (item) =>
            typeof item.customDrugName === 'string' &&
            item.customDrugName.trim().length > 0
        )
        .sort(
          (a, b) =>
            new Date(a.prescription.prescriptionDate) -
            new Date(b.prescription.prescriptionDate)
        )
        .map((item) => ({
          id: item.id,
          prescriptionId: item.prescriptionId,

          patient: item.prescription.patient,

          doctorId: item.prescription.doctorId,

          prescriptionDate:
            item.prescription.prescriptionDate,

          prescriptionStatus:
            item.prescription.status,

          customDrugName:
            item.customDrugName,

          dosage:
            item.dosage,

          duration:
            item.duration,

          instructionsAr:
            item.instructionsAr,

          instructionsEn:
            item.instructionsEn,

          qtyPrescribed:
            Number(item.qtyPrescribed),

          qtyDispensed:
            Number(item.qtyDispensed),

          pharmacyReviewStatus:
            item.pharmacyReviewStatus,

          pharmacyReviewNote:
            item.pharmacyReviewNote
        }));

      return res.json(queue);
    } catch (error) {
      console.error(
        'Fetch pending medication reviews error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to retrieve pending medication reviews.'
      });
    }
  }
);


/**
 * POST /api/records/prescribed-drugs/:id/pharmacy-review
 *
 * Pharmacist decisions:
 * - LINK_EXISTING
 * - CREATE_FORMULARY
 * - EXTERNAL
 */
router.post(
  '/prescribed-drugs/:id/pharmacy-review',
  authenticate,
  allowRoles(ROLES.PHARMACIST),
  async (req, res) => {
    const prescribedDrugId = req.params.id;

    const decision =
      typeof req.body?.decision === 'string'
        ? req.body.decision.trim().toUpperCase()
        : '';

    const note =
      typeof req.body?.note === 'string' &&
      req.body.note.trim()
        ? req.body.note.trim()
        : null;

    const allowedDecisions = [
      'LINK_EXISTING',
      'CREATE_FORMULARY',
      'EXTERNAL'
    ];

    if (!allowedDecisions.includes(decision)) {
      return res.status(422).json({
        error:
          'decision must be LINK_EXISTING, CREATE_FORMULARY, or EXTERNAL.'
      });
    }

    const fail = (status, code, message) => {
      const error = new Error(message);
      error.httpStatus = status;
      error.publicCode = code;
      return error;
    };

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const prescribedDrug =
            await tx.prescribedDrug.findUnique({
              where: {
                id: prescribedDrugId
              },
              include: {
                prescription: {
                  select: {
                    id: true,
                    status: true,
                    patientId: true
                  }
                }
              }
            });

          if (!prescribedDrug) {
            throw fail(
              404,
              'PRESCRIBED_DRUG_NOT_FOUND',
              'Prescribed medication was not found.'
            );
          }

          if (
            prescribedDrug.pharmacyReviewStatus !==
            'PENDING_REVIEW'
          ) {
            throw fail(
              409,
              'MEDICATION_ALREADY_REVIEWED',
              'This medication is no longer awaiting pharmacy review.'
            );
          }

          if (
            !['ACTIVE', 'PARTIALLY_FILLED'].includes(
              prescribedDrug.prescription.status
            )
          ) {
            throw fail(
              409,
              'PRESCRIPTION_NOT_ACTIVE',
              'This prescription is no longer active.'
            );
          }

          if (
            prescribedDrug.drugId ||
            !prescribedDrug.customDrugName?.trim()
          ) {
            throw fail(
              409,
              'INVALID_MEDICATION_REVIEW_STATE',
              'Only unresolved custom medications can be reviewed.'
            );
          }

          let linkedDrug = null;
          let createdBatch = null;

          // --------------------------------------------------
          // EXTERNAL
          // --------------------------------------------------
          if (decision === 'EXTERNAL') {
            const claim =
              await tx.prescribedDrug.updateMany({
                where: {
                  id: prescribedDrug.id,
                  pharmacyReviewStatus: 'PENDING_REVIEW',
                  drugId: null
                },
                data: {
                  pharmacyReviewStatus: 'EXTERNAL',
                  pharmacyReviewedAt: new Date(),
                  pharmacyReviewNote: note
                }
              });

            if (claim.count !== 1) {
              throw fail(
                409,
                'MEDICATION_REVIEW_CONFLICT',
                'This medication was already reviewed by another pharmacist.'
              );
            }

            const updated =
              await tx.prescribedDrug.findUnique({
                where: {
                  id: prescribedDrug.id
                }
              });

            await tx.tenantAuditLog.create({
              data: {
                userId: req.user.id,
                action:
                  `PHARMACY_CUSTOM_MEDICATION_EXTERNAL:${prescribedDrug.id}`,
                details: JSON.stringify({
                  prescribedDrugId:
                    prescribedDrug.id,
                  prescriptionId:
                    prescribedDrug.prescriptionId,
                  customDrugName:
                    prescribedDrug.customDrugName,
                  decision: 'EXTERNAL',
                  note
                }),
                ipAddress:
                  req.ip || '127.0.0.1'
              }
            });

            await refreshPrescriptionResolution(
              tx,
              prescribedDrug.prescriptionId
            );

            await ensurePharmacyInvoiceInTransaction(tx, {
              prescriptionId: prescribedDrug.prescriptionId,
              actorUserId: req.user.id,
              ipAddress: req.ip || 'unknown',
              trigger: 'CUSTOM_MEDICATION_EXTERNAL'
            });

            return {
              decision,
              prescribedDrug: updated,
              drug: null,
              inventoryBatch: null
            };
          }

          // --------------------------------------------------
          // LINK EXISTING
          // --------------------------------------------------
          if (decision === 'LINK_EXISTING') {
            const targetDrugId =
              typeof req.body?.drugId === 'string'
                ? req.body.drugId.trim()
                : '';

            if (!targetDrugId) {
              throw fail(
                422,
                'DRUG_ID_REQUIRED',
                'drugId is required when linking an existing formulary medication.'
              );
            }

            linkedDrug =
              await tx.drugFormulary.findUnique({
                where: {
                  id: targetDrugId
                },
                include: {
                  inventoryBatches: true
                }
              });

            if (!linkedDrug) {
              throw fail(
                404,
                'FORMULARY_DRUG_NOT_FOUND',
                'The selected formulary medication was not found.'
              );
            }

            const price = Number(linkedDrug.unitPriceSdg);

            if (
              linkedDrug.status !== 'ACTIVE' ||
              !Number.isSafeInteger(price) ||
              price <= 0 ||
              price > 1_000_000_000
            ) {
              throw fail(
                409,
                'PHARMACY_PRICE_NOT_CONFIGURED',
                'The selected medication must have a valid pharmacy price before approval.'
              );
            }

            const remainingQty =
              Number(prescribedDrug.qtyPrescribed) -
              Number(prescribedDrug.qtyDispensed);

            const today =
              new Date().toISOString().slice(0, 10);

            const usableStock =
              linkedDrug.inventoryBatches
                .filter(
                  (batch) =>
                    Number(batch.qtyOnHand) > 0 &&
                    batch.expiryDate >= today
                )
                .reduce(
                  (total, batch) =>
                    total + Number(batch.qtyOnHand),
                  0
                );

            if (
              remainingQty > 0 &&
              usableStock < remainingQty
            ) {
              throw fail(
                409,
                'PHARMACY_INSUFFICIENT_STOCK_FOR_APPROVAL',
                `Only ${usableStock} usable units are currently available; ${remainingQty} are required.`
              );
            }

            const claim =
              await tx.prescribedDrug.updateMany({
                where: {
                  id: prescribedDrug.id,
                  pharmacyReviewStatus: 'PENDING_REVIEW',
                  drugId: null
                },
                data: {
                  drugId: linkedDrug.id,
                  pharmacyReviewStatus: 'APPROVED',
                  pharmacyReviewedAt: new Date(),
                  pharmacyReviewNote: note
                }
              });

            if (claim.count !== 1) {
              throw fail(
                409,
                'MEDICATION_REVIEW_CONFLICT',
                'This medication was already reviewed by another pharmacist.'
              );
            }

            const updated =
              await tx.prescribedDrug.findUnique({
                where: {
                  id: prescribedDrug.id
                }
              });

            await tx.tenantAuditLog.create({
              data: {
                userId: req.user.id,
                action:
                  `PHARMACY_CUSTOM_MEDICATION_LINKED:${prescribedDrug.id}`,
                details: JSON.stringify({
                  prescribedDrugId:
                    prescribedDrug.id,
                  prescriptionId:
                    prescribedDrug.prescriptionId,
                  customDrugName:
                    prescribedDrug.customDrugName,
                  linkedDrugId:
                    linkedDrug.id,
                  linkedDrugName:
                    linkedDrug.labelEn,
                  unitPriceSdg: price,
                  decision: 'LINK_EXISTING',
                  note
                }),
                ipAddress:
                  req.ip || '127.0.0.1'
              }
            });

            await ensurePharmacyInvoiceInTransaction(tx, {
              prescriptionId: prescribedDrug.prescriptionId,
              actorUserId: req.user.id,
              ipAddress: req.ip || 'unknown',
              trigger: 'CUSTOM_MEDICATION_LINKED'
            });

            return {
              decision,
              prescribedDrug: updated,
              drug: linkedDrug,
              inventoryBatch: null
            };
          }

          // --------------------------------------------------
          // CREATE FORMULARY + INITIAL STOCK
          // --------------------------------------------------

          const form =
            req.body?.formulary || {};

          const inventory =
            req.body?.inventory || {};

          const fallbackLabelEn =
            typeof form.labelEn === 'string' &&
            form.labelEn.trim()
              ? form.labelEn.trim()
              : prescribedDrug.customDrugName.trim();

          const fallbackLabelAr =
            typeof form.labelAr === 'string' &&
            form.labelAr.trim()
              ? form.labelAr.trim()
              : fallbackLabelEn;

          if (Object.hasOwn(form, 'unitPriceSdg')) {
            throw fail(
              422,
              'PHARMACY_PRICE_ADMIN_REQUIRED',
              'Official medicine selling prices must be configured by an administrator.'
            );
          }

          const medicineResult = pharmacistMedicineSchema.safeParse({
            ...form,
            brandName: form.brandName ?? fallbackLabelEn,
            labelAr: fallbackLabelAr,
            labelEn: fallbackLabelEn
          });

          if (!medicineResult.success) {
            throw fail(422, 'FORMULARY_DETAILS_INVALID', medicineResult.error.issues[0].message);
          }

          const batchResult = inventoryBatchSchema.safeParse(inventory);

          if (!batchResult.success) {
            throw fail(422, 'INVENTORY_BATCH_INVALID', batchResult.error.issues[0].message);
          }

          const { brandName, labelAr, labelEn, genericName, strength, dosageForm } = medicineResult.data;
          const { batchNumber, expiryDate, qtyOnHand, minReorderLevel } = batchResult.data;
          const identityKey = buildMedicineIdentityKey(medicineResult.data);
          const normalizedBatchNumber = normalizeBatchNumber(batchNumber);

          const today = getClinicDateString();

          if (expiryDate <= today) {
            throw fail(
              422,
              'INVALID_EXPIRY_DATE',
              'The initial stock batch must expire after today.'
            );
          }

          const remainingQty =
            Number(prescribedDrug.qtyPrescribed) -
            Number(prescribedDrug.qtyDispensed);

          if (qtyOnHand < remainingQty) {
            throw fail(
              409,
              'INITIAL_STOCK_BELOW_PRESCRIPTION_REQUIREMENT',
              `Initial stock must contain at least ${remainingQty} units for this prescription.`
            );
          }

          const duplicateDrug =
            await tx.drugFormulary.findUnique({
              where: {
                identityKey
              },
              select: {
                id: true,
                labelEn: true,
                brandName: true,
                genericName: true,
                strength: true,
                dosageForm: true
              }
            });

          if (duplicateDrug) {
            throw fail(
              409,
              'FORMULARY_MEDICINE_ALREADY_EXISTS',
              'A matching medication already exists in the formulary. Link the existing medication instead.'
            );
          }

          linkedDrug =
            await tx.drugFormulary.create({
              data: {
                brandName,
                labelAr,
                labelEn,
                genericName,
                strength,
                dosageForm,
                identityKey,
                unitPriceSdg: null,
                status: 'INACTIVE'
              }
            });

          createdBatch =
            await tx.inventoryBatch.create({
              data: {
                drugId: linkedDrug.id,
                batchNumber,
                normalizedBatchNumber,
                expiryDate,
                qtyOnHand,
                minReorderLevel
              }
            });

          const openingMovement = stockMovementSchema.parse({
            movementType: 'OPENING_BALANCE',
            quantityDelta: qtyOnHand,
            resultingBalance: qtyOnHand,
            actorUserId: req.user.id,
            referenceType: 'CUSTOM_MEDICATION_REVIEW',
            referenceId: prescribedDrug.id,
            reason: 'Initial stock recorded during formulary creation.',
            idempotencyKey: `custom-medication-review:${prescribedDrug.id}:opening`
          });

          await tx.stockMovement.create({
            data: {
              ...openingMovement,
              drugId: linkedDrug.id,
              inventoryBatchId: createdBatch.id
            }
          });

          const claim =
            await tx.prescribedDrug.updateMany({
              where: {
                id: prescribedDrug.id,
                pharmacyReviewStatus: 'PENDING_REVIEW',
                drugId: null
              },
              data: {
                drugId: linkedDrug.id,
                pharmacyReviewStatus: 'APPROVED',
                pharmacyReviewedAt: new Date(),
                pharmacyReviewNote: note
              }
            });

          if (claim.count !== 1) {
            throw fail(
              409,
              'MEDICATION_REVIEW_CONFLICT',
              'This medication was already reviewed by another pharmacist.'
            );
          }

          const updated =
            await tx.prescribedDrug.findUnique({
              where: {
                id: prescribedDrug.id
              }
            });

          await tx.tenantAuditLog.create({
            data: {
              userId: req.user.id,
              action:
                `PHARMACY_CUSTOM_MEDICATION_CREATED:${prescribedDrug.id}`,
              details: JSON.stringify({
                prescribedDrugId:
                  prescribedDrug.id,
                prescriptionId:
                  prescribedDrug.prescriptionId,
                customDrugName:
                  prescribedDrug.customDrugName,
                createdDrugId:
                  linkedDrug.id,
                createdDrugName:
                  linkedDrug.labelEn,
                inventoryBatchId:
                  createdBatch.id,
                batchNumber,
                expiryDate,
                qtyOnHand,
                minReorderLevel,
                decision:
                  'CREATE_FORMULARY',
                note
              }),
              ipAddress:
                req.ip || '127.0.0.1'
            }
          });

          await ensurePharmacyInvoiceInTransaction(tx, {
            prescriptionId: prescribedDrug.prescriptionId,
            actorUserId: req.user.id,
            ipAddress: req.ip || 'unknown',
            trigger: 'CUSTOM_MEDICATION_FORMULARY_CREATED'
          });

          return {
            decision,
            prescribedDrug: updated,
            drug: linkedDrug,
            inventoryBatch: createdBatch
          };
        }
      );

      return res.json({
        success: true,
        message:
          result.decision === 'EXTERNAL'
            ? 'Medication marked for external purchase.'
            : 'Medication approved by pharmacy.',
        ...result
      });
    } catch (error) {
      if (isMedicineIdentityUniqueViolation(error)) {
        return sendError(
          res,
          409,
          'FORMULARY_MEDICINE_ALREADY_EXISTS',
          'A matching medication already exists in the formulary. Link the existing medication instead.'
        );
      }

      if (error?.httpStatus) {
        return res
          .status(error.httpStatus)
          .json({
            error: {
              code: error.publicCode,
              message: error.message
            }
          });
      }

      console.error(
        'Pharmacy medication review error:',
        error
      );

      return res.status(500).json({
        error: {
          code:
            'PHARMACY_MEDICATION_REVIEW_FAILED',
          message:
            'Failed to complete pharmacy medication review.'
        }
      });
    }
  }
);

/**
 * GET /api/records/prescriptions/pending
 * Returns list of prescriptions that are ACTIVE or PARTIALLY_FILLED.
 */
router.get('/prescriptions/pending', authenticate, allowRoles(ROLES.PHARMACIST), async (req, res) => {
  try {
    const prescriptions = await prisma.prescription.findMany({
      where: {
        status: { in: ['ACTIVE', 'PARTIALLY_FILLED'] }
      },
      include: {
        patient: true,
        doctor: true,
        prescribedDrugs: {
          include: {
            drug: {
              include: {
                inventoryBatches: true
              }
            }
          }
        },
        invoices: {
          where: {
            invoiceType: 'PHARMACY',
            paymentStatus: {
              notIn: ['REFUNDED', 'VOIDED']
            }
          },
          select: {
            paymentStatus: true
          },
          orderBy: {
            invoiceDate: 'desc'
          },
          take: 1
        }
      },
      orderBy: { prescriptionDate: 'desc' }
    });

    return res.json(
      prescriptions.map(({ invoices, ...prescription }) => ({
        ...prescription,
        billingStatus: invoices[0]?.paymentStatus || 'UNBILLED'
      }))
    );
  } catch (error) {
    console.error('Fetch pending prescriptions error:', error);
    return res.status(500).json({ error: 'Failed to retrieve pending prescriptions.' });
  }
});

/**
 * GET /api/records/prescriptions/history
 * Bounded, read-only pharmacy audit history.
 */
router.get('/prescriptions/history', authenticate, allowRoles(ROLES.PHARMACIST), async (req, res) => {
  try {
    const prescriptions = await prisma.prescription.findMany({
      where: { status: { in: TERMINAL_PRESCRIPTION_STATUSES } },
      select: {
        id: true,
        prescriptionDate: true,
        status: true,
        patient: { select: { fullNameAr: true, fullNameEn: true, fileNumber: true } },
        doctor: { select: { fullNameAr: true, fullNameEn: true } },
        prescribedDrugs: {
          select: {
            id: true,
            customDrugName: true,
            dosage: true,
            duration: true,
            qtyPrescribed: true,
            qtyDispensed: true,
            pharmacyReviewStatus: true,
            pharmacyReviewNote: true,
            drug: { select: { labelAr: true, labelEn: true } }
          }
        }
      },
      orderBy: [{ prescriptionDate: 'desc' }, { id: 'desc' }],
      take: 100
    });
    return res.json(prescriptions);
  } catch (error) {
    console.error('Fetch prescription history error:', error);
    return sendError(res, 500, 'PRESCRIPTION_HISTORY_FAILED', 'Failed to retrieve prescription history.');
  }
});

/**
 * POST /api/records/prescribed-drugs/:id/unavailable
 * Resolves, but never deletes or dispenses, an item the clinic cannot supply.
 */
router.post('/prescribed-drugs/:id/unavailable', authenticate, allowRoles(ROLES.PHARMACIST), validate(z.object({
  reason: z.enum(['OUT_OF_STOCK', 'NOT_IN_FORMULARY', 'DOCTOR_REVIEW_REQUIRED', 'OTHER']),
  note: z.string().trim().max(500).optional().nullable()
})), async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.prescribedDrug.findUnique({
        where: { id: req.params.id },
        include: { prescription: { select: { id: true, status: true } } }
      });
      if (!item) throw authorityError(404, 'PRESCRIBED_DRUG_NOT_FOUND', 'Prescribed medication was not found.');
      if (!ACTIVE_PRESCRIPTION_STATUSES.includes(item.prescription.status)) {
        throw authorityError(409, 'PRESCRIPTION_NOT_ACTIVE', 'This prescription is no longer active.');
      }
      if (item.pharmacyReviewStatus === 'EXTERNAL') {
        const prescriptionStatus = await refreshPrescriptionResolution(tx, item.prescriptionId);
        await tx.tenantAuditLog.create({
          data: {
            userId: req.user.id,
            action: `PHARMACY_MEDICATION_RESOLUTION_RECONCILED:${item.id}`,
            details: JSON.stringify({ prescribedDrugId: item.id, prescriptionId: item.prescriptionId, prescriptionStatus }),
            ipAddress: req.ip || 'unknown'
          }
        });
        return { prescribedDrugId: item.id, prescriptionId: item.prescriptionId, prescriptionStatus, billing: null, reconciled: true };
      }
      if (item.qtyDispensed >= item.qtyPrescribed) {
        throw authorityError(409, 'MEDICATION_ALREADY_RESOLVED', 'This medication is already resolved.');
      }

      const invoices = await tx.invoice.findMany({
        where: {
          prescriptionId: item.prescriptionId,
          invoiceType: 'PHARMACY',
          paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] }
        },
        select: { id: true, paymentStatus: true, payments: { select: { id: true }, take: 1 } },
        take: 2
      });
      if (invoices.length > 1) {
        throw authorityError(409, 'PHARMACY_INVOICE_INVARIANT_VIOLATION', 'Pharmacy billing requires administrative review.');
      }
      const invoice = invoices[0];
      if (invoice && (invoice.paymentStatus !== 'UNPAID' || invoice.payments.length > 0)) {
        throw authorityError(409, 'PHARMACY_UNAVAILABLE_PAID_REVIEW_REQUIRED', 'Paid medication cannot be marked unavailable without financial review.');
      }
      if (invoice) {
        await tx.invoice.update({ where: { id: invoice.id }, data: { paymentStatus: 'VOIDED' } });
      }

      const note = req.body.note?.trim() || null;
      await tx.prescribedDrug.update({
        where: { id: item.id },
        data: {
          pharmacyReviewStatus: 'EXTERNAL',
          pharmacyReviewedAt: new Date(),
          pharmacyReviewNote: note ? `${req.body.reason}: ${note}` : req.body.reason
        }
      });
      const prescriptionStatus = await refreshPrescriptionResolution(tx, item.prescriptionId);
      await tx.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: `PHARMACY_MEDICATION_UNAVAILABLE:${item.id}`,
          details: JSON.stringify({ prescribedDrugId: item.id, prescriptionId: item.prescriptionId, reason: req.body.reason, note, voidedInvoiceId: invoice?.id || null }),
          ipAddress: req.ip || 'unknown'
        }
      });

      let billing = null;
      if (ACTIVE_PRESCRIPTION_STATUSES.includes(prescriptionStatus)) {
        billing = await ensurePharmacyInvoiceInTransaction(tx, {
          prescriptionId: item.prescriptionId,
          actorUserId: req.user.id,
          ipAddress: req.ip || 'unknown',
          trigger: 'MEDICATION_UNAVAILABLE'
        });
      }
      return { prescribedDrugId: item.id, prescriptionId: item.prescriptionId, prescriptionStatus, billing };
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error.status && error.code) return sendError(res, error.status, error.code, error.message);
    console.error('Resolve unavailable medication error:', error);
    return sendError(res, 500, 'PHARMACY_UNAVAILABLE_FAILED', 'Failed to resolve unavailable medication.');
  }
});

/**
 * POST /api/records/prescriptions/:id/dispense
 * Fills or partially fills a prescription. Updates inventory levels.
 */
router.post('/prescriptions/:id/dispense', authenticate, allowRoles(ROLES.PHARMACIST), validate(z.object({
  items: z.array(z.object({
    prescribedDrugId: z.string().uuid(),
    qtyToDispense: z.coerce.number().int().positive()
  })).min(1).max(100)
})), async (req, res) => {
  const prescriptionId = req.params.id;
  const { items } = req.body; // Array of { prescribedDrugId, qtyToDispense, batchId }

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Dispensing items are required.' });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Financial hard gate: pharmacy dispensing is allowed only when
      // the prescription has a fully paid PHARMACY invoice.
      const paidPharmacyInvoice = await tx.invoice.findFirst({
        where: {
          prescriptionId,
          invoiceType: 'PHARMACY',
          paymentStatus: 'PAID'
        },
        select: {
          id: true
        }
      });

      if (!paidPharmacyInvoice) {
        throw Object.assign(
          new Error('Prescription dispensing requires full pharmacy payment.'),
          {
            status: 403,
            code: 'PHARMACY_PAYMENT_REQUIRED'
          }
        );
      }

      for (const item of items) {
        const { prescribedDrugId } = item;
        const qtyToDispense = Number(item.qtyToDispense);
        if (!Number.isInteger(qtyToDispense) || qtyToDispense <= 0) throw new Error('Dispensing quantity must be a positive whole number.');

        const prescribedDrug = await tx.prescribedDrug.findUnique({
          where: { id: prescribedDrugId }
        });

        if (!prescribedDrug) {
          throw new Error('Prescribed drug item not found.');
        }
        if (prescribedDrug.prescriptionId !== prescriptionId) throw new Error('Prescribed drug does not belong to this prescription.');
        if (!prescribedDrug.drugId) {
          // Custom/free-text medications are not linked to clinic inventory.
          // They are excluded from automatic pharmacy stock dispensing.
          continue;
        }
        if (prescribedDrug.pharmacyReviewStatus === 'EXTERNAL') {
          throw new Error('Unavailable medication cannot be dispensed.');
        }

        const remaining = prescribedDrug.qtyPrescribed - prescribedDrug.qtyDispensed;
        if (qtyToDispense > remaining) throw new Error('Dispensing quantity exceeds the remaining prescribed quantity.');

        const eligibleBatches = await tx.inventoryBatch.findMany({
          where: {
            drugId: prescribedDrug.drugId,
            qtyOnHand: { gt: 0 },
            expiryDate: { gte: getClinicDateString() }
          },
          orderBy: [
            { expiryDate: 'asc' },
            { batchNumber: 'asc' }
          ]
        });

        const totalAvailable = eligibleBatches.reduce(
          (sum, batch) => sum + batch.qtyOnHand,
          0
        );

        if (totalAvailable < qtyToDispense) {
          throw new Error(
            `Insufficient stock. Required ${qtyToDispense}, available ${totalAvailable}.`
          );
        }

        let remainingToDispense = qtyToDispense;

        for (const batch of eligibleBatches) {
          if (remainingToDispense <= 0) break;

          const quantityFromBatch = Math.min(
            batch.qtyOnHand,
            remainingToDispense
          );

          const batchClaim = await tx.inventoryBatch.updateMany({
            where: {
              id: batch.id,
              qtyOnHand: batch.qtyOnHand,
              ledgerVersion: batch.ledgerVersion
            },
            data: {
              qtyOnHand: { decrement: quantityFromBatch },
              ledgerVersion: { increment: 1 }
            }
          });

          if (batchClaim.count !== 1) {
            throw new Error(
              'Inventory changed concurrently. Reload and retry dispensing.'
            );
          }

          const resultingBalance = batch.qtyOnHand - quantityFromBatch;
          const movement = stockMovementSchema.parse({
            movementType: 'DISPENSE',
            quantityDelta: -quantityFromBatch,
            resultingBalance,
            actorUserId: req.user.id,
            referenceType: 'PRESCRIBED_DRUG_DISPENSE',
            referenceId: prescribedDrug.id,
            reason: 'Stock dispensed for a prescription.'
          });

          await tx.stockMovement.create({
            data: {
              ...movement,
              drugId: batch.drugId,
              inventoryBatchId: batch.id
            }
          });

          remainingToDispense -= quantityFromBatch;
        }

        if (remainingToDispense !== 0) {
          throw new Error(
            'Unable to allocate the full dispensing quantity across FEFO inventory batches.'
          );
        }

        const newQtyDispensed = prescribedDrug.qtyDispensed + qtyToDispense;
        const prescriptionClaim = await tx.prescribedDrug.updateMany({
          where: { id: prescribedDrugId, qtyDispensed: prescribedDrug.qtyDispensed, ledgerVersion: prescribedDrug.ledgerVersion },
          data: { qtyDispensed: newQtyDispensed, ledgerVersion: { increment: 1 } }
        });
        if (prescriptionClaim.count !== 1) throw new Error('Prescription changed concurrently. Reload and retry dispensing.');

      }
      await refreshPrescriptionResolution(tx, prescriptionId);
    });

    return res.json({ success: true, message: 'Prescription dispensed successfully.' });

  } catch (error) {
    if (error.status && error.code) {
      return sendError(res, error.status, error.code, error.message);
    }

    const knownValidation = [
      'positive whole number', 'does not belong', 'exceeds the remaining',
      'not found', 'changed concurrently', 'Unable to allocate', 'cannot be dispensed'
    ].some((fragment) => error.message?.includes(fragment));
    if (knownValidation) return sendError(res, 422, 'DISPENSING_VALIDATION_FAILED', error.message);
    if (error.message?.includes('Insufficient stock')) return sendError(res, 409, 'INSUFFICIENT_STOCK', error.message);
    console.error('Dispense prescription error:', error);
    return sendError(res, 500, 'DISPENSING_FAILED', 'Failed to dispense prescription.');
  }
});

/**
 * GET /api/records/lab-orders/pending
 * Returns test orders.
 */
router.get('/lab-order-items/pending-review', authenticate, allowRoles(ROLES.LAB_TECH), async (req, res) => {
  try {
    const items = await prisma.labOrderItem.findMany({
      where: { labReviewStatus: 'PENDING_REVIEW', serviceId: null },
      select: {
        id: true,
        customTestName: true,
        labOrder: {
          select: {
            id: true,
            orderDate: true,
            status: true,
            patient: { select: { id: true, fullNameAr: true, fullNameEn: true } },
            doctor: { select: { id: true, fullNameAr: true, fullNameEn: true } }
          }
        }
      },
      orderBy: { labOrder: { orderDate: 'asc' } }
    });
    return res.json(items);
  } catch (error) {
    console.error('Fetch pending lab reviews error:', error);
    return sendError(res, 500, 'LAB_REVIEW_QUEUE_FAILED', 'Failed to retrieve custom laboratory test requests.');
  }
});

router.post('/lab-order-items/:id/review', authenticate, allowRoles(ROLES.LAB_TECH), async (req, res) => {
  const decision = typeof req.body?.decision === 'string' ? req.body.decision.trim().toUpperCase() : '';
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : null;
  const allowed = ['LINK_EXISTING', 'CREATE_SERVICE', 'EXTERNAL'];
  if (!allowed.includes(decision)) {
    return sendError(res, 422, 'LAB_REVIEW_DECISION_INVALID', 'decision must be LINK_EXISTING, CREATE_SERVICE, or EXTERNAL.');
  }

  const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
  const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.labOrderItem.findUnique({
        where: { id: req.params.id },
        include: { labOrder: { select: { id: true, status: true, medicalRecord: { select: { appointmentId: true } } } } }
      });
      if (!item) throw fail(404, 'LAB_ORDER_ITEM_NOT_FOUND', 'Laboratory order item was not found.');
      if (item.labReviewStatus !== 'PENDING_REVIEW') throw fail(409, 'LAB_TEST_ALREADY_REVIEWED', 'This laboratory test is no longer awaiting review.');
      if (item.serviceId || !item.customTestName?.trim()) throw fail(409, 'LAB_REVIEW_STATE_INVALID', 'Only unresolved custom laboratory tests can be reviewed.');
      if (item.labOrder.status !== 'PENDING_BILLING') throw fail(409, 'LAB_REVIEW_ORDER_STATE_INVALID', 'This laboratory order can no longer be reviewed.');

      let service = null;
      if (decision === 'LINK_EXISTING') {
        const serviceId = typeof req.body?.serviceId === 'string' ? req.body.serviceId.trim() : '';
        if (!serviceId) throw fail(422, 'LAB_SERVICE_ID_REQUIRED', 'serviceId is required when linking an existing service.');
        service = await tx.clinicalService.findUnique({ where: { id: serviceId } });
        if (!service || service.category !== 'LABORATORY') throw fail(404, 'LAB_SERVICE_NOT_FOUND', 'The selected laboratory service was not found.');
        const price = Number(service.baseFeeSdg);
        if (service.status !== 'ACTIVE' || !Number.isSafeInteger(price) || price <= 0 || price > 1_000_000_000) {
          throw fail(409, 'LAB_SERVICE_PRICE_NOT_CONFIGURED', 'The selected service must be active with a valid configured price.');
        }
      }

      if (decision === 'CREATE_SERVICE') {
        const form = req.body?.service || {};
        const labelEn = typeof form.labelEn === 'string' ? form.labelEn.trim() : '';
        const labelAr = typeof form.labelAr === 'string' ? form.labelAr.trim() : '';
        if (!labelEn || !labelAr || labelEn.length > 150 || labelAr.length > 150) {
          throw fail(422, 'LAB_SERVICE_LABELS_REQUIRED', 'Arabic and English service labels are required and must not exceed 150 characters.');
        }
        if (Object.hasOwn(form, 'baseFeeSdg') || Object.hasOwn(form, 'baseFeeUsd')) {
          throw fail(422, 'LAB_PRICE_ADMIN_REQUIRED', 'Official laboratory prices must be configured by an administrator.');
        }

        const normalizedEn = normalizeName(labelEn);
        const normalizedAr = normalizeName(labelAr);
        const duplicateLocks = [...new Set([normalizedEn, normalizedAr])].sort();
        for (const normalizedLabel of duplicateLocks) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'lab-service:' + normalizedLabel}))`;
        }
        const existing = (await tx.clinicalService.findMany({ where: { category: 'LABORATORY' } })).find(
          (candidate) => normalizeName(candidate.labelEn) === normalizedEn || normalizeName(candidate.labelAr) === normalizedAr
        );
        if (existing) throw fail(409, 'LAB_SERVICE_ALREADY_EXISTS', 'A laboratory service with the same normalized name already exists. Link the existing service instead.');

        service = await tx.clinicalService.create({
          data: {
            labelAr,
            labelEn,
            baseFeeSdg: null,
            baseFeeUsd: null,
            category: 'LABORATORY',
            status: 'INACTIVE'
          }
        });
      }

      const nextStatus = decision === 'EXTERNAL' ? 'EXTERNAL' : 'APPROVED';
      const claimed = await tx.labOrderItem.updateMany({
        where: { id: item.id, labReviewStatus: 'PENDING_REVIEW', serviceId: null },
        data: {
          serviceId: service?.id || null,
          labReviewStatus: nextStatus,
          labReviewedAt: new Date(),
          labReviewNote: note
        }
      });
      if (claimed.count !== 1) throw fail(409, 'LAB_REVIEW_CONFLICT', 'This laboratory test was already reviewed by another lab technician.');

      let returnedAppointmentId = null;
      if (decision === 'EXTERNAL') {
        const remainingClinicItems = await tx.labOrderItem.count({
          where: { labOrderId: item.labOrderId, labReviewStatus: { not: 'EXTERNAL' } }
        });
        if (remainingClinicItems === 0) {
          await tx.labOrder.update({ where: { id: item.labOrderId }, data: { status: 'COMPLETED' } });
          returnedAppointmentId = item.labOrder.medicalRecord?.appointmentId || null;
          if (returnedAppointmentId) {
            await tx.appointment.updateMany({
              where: { id: returnedAppointmentId, status: 'WAITING_LAB' },
              data: { status: 'IN_CONSULTATION' }
            });
          }
        }
      }

      await tx.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: `LAB_CUSTOM_TEST_${decision}:${item.id}`,
          details: JSON.stringify({ labOrderItemId: item.id, labOrderId: item.labOrderId, customTestName: item.customTestName, decision, serviceId: service?.id || null, note }),
          ipAddress: req.ip || '127.0.0.1'
        }
      });

      const updated = await tx.labOrderItem.findUnique({ where: { id: item.id }, include: { service: true } });
      return { decision, item: updated, service, returnedAppointmentId };
    });

    emitQueueUpdate(
      req.app.get('io'),
      { type: 'LAB_REVIEW_RESOLVED', labOrderItemId: result.item.id, labOrderId: result.item.labOrderId, decision: result.decision },
      []
    );
    if (result.returnedAppointmentId) {
      emitQueueUpdate(req.app.get('io'), { type: 'LAB_RESULTS_COMPLETED', appointmentId: result.returnedAppointmentId, status: 'IN_CONSULTATION' }, []);
    }
    return res.json(result);
  } catch (error) {
    if (error.status && error.code) return sendError(res, error.status, error.code, error.message);
    console.error('Review custom laboratory test error:', error);
    return sendError(res, 500, 'LAB_REVIEW_FAILED', 'Failed to review the custom laboratory test.');
  }
});

router.get('/lab-orders/pending', authenticate, allowRoles(ROLES.LAB_TECH), async (req, res) => {
  try {
    const orders = await prisma.labOrder.findMany({
      // PENDING_BILLING remains visible to preserve the existing workflow until
      // invoices are explicitly linked to lab orders in a later forward migration.
      where: {
        OR: [
          { status: { in: ['PENDING_BILLING', 'PAID', 'SAMPLE_COLLECTED'] } },
          { status: 'COMPLETED', releasedToPatientAt: null }
        ]
      },
      include: {
        patient: true,
        doctor: true,
        items: {
          include: {
            service: true
          }
        }
      },
      orderBy: { orderDate: 'desc' }
    });
    return res.json(orders);
  } catch (error) {
    console.error('Fetch pending lab orders error:', error);
    return res.status(500).json({ error: 'Failed to retrieve pending lab orders.' });
  }
});

/**
 * GET /api/records/lab-orders/history
 * Returns a bounded, newest-first laboratory audit view for technicians.
 * Released orders are immutable clinical history and are never part of the
 * operational pending queue.
 */
router.get('/lab-orders/history', authenticate, allowRoles(ROLES.LAB_TECH), async (req, res) => {
  try {
    const orders = await prisma.labOrder.findMany({
      where: {
        status: 'COMPLETED',
        releasedToPatientAt: { not: null }
      },
      select: {
        id: true,
        orderDate: true,
        status: true,
        releasedToPatientAt: true,
        patient: { select: { fullNameAr: true, fullNameEn: true, fileNumber: true } },
        doctor: { select: { fullNameAr: true, fullNameEn: true } },
        items: {
          select: {
            id: true,
            customTestName: true,
            labReviewStatus: true,
            resultValue: true,
            referenceRangeMin: true,
            referenceRangeMax: true,
            isOutOfRange: true,
            resultVersion: true,
            service: { select: { labelAr: true, labelEn: true } }
          }
        }
      },
      orderBy: [{ releasedToPatientAt: 'desc' }, { orderDate: 'desc' }],
      take: 100
    });
    return res.json(orders);
  } catch (error) {
    console.error('Fetch laboratory history error:', error);
    return sendError(res, 500, 'LAB_HISTORY_FAILED', 'Failed to retrieve laboratory history.');
  }
});

/**
 * PUT /api/records/lab-orders/:id/collect-sample
 * Allows the laboratory to collect/process a sample only after full payment.
 */
router.put('/lab-orders/:id/collect-sample', authenticate, allowRoles(ROLES.LAB_TECH), async (req, res) => {
  const orderId = req.params.id;

  try {
    const order = await prisma.labOrder.findUnique({
      where: { id: orderId },
      include: { patient: true, items: { select: { labReviewStatus: true } } }
    });

    if (!order) {
      return sendError(
        res,
        404,
        'LAB_ORDER_NOT_FOUND',
        'Laboratory order not found.'
      );
    }

    if (order.items.some((item) => item.labReviewStatus === 'PENDING_REVIEW')) {
      return sendError(res, 409, 'LAB_REVIEW_PENDING', 'Custom laboratory tests must be reviewed before sample collection.');
    }

    if (order.status === 'PENDING_BILLING') {
      return sendError(
        res,
        403,
        'LAB_PAYMENT_REQUIRED',
        'Laboratory work cannot start until the laboratory invoice is fully paid.'
      );
    }

    if (order.status === 'SAMPLE_COLLECTED') {
      return res.json({
        ...order,
        idempotentReplay: true
      });
    }

    if (order.status !== 'PAID') {
      return sendError(
        res,
        409,
        'LAB_SAMPLE_COLLECTION_INVALID_STATE',
        'Sample collection is only available for fully paid laboratory orders.'
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.labOrder.updateMany({
        where: {
          id: order.id,
          status: 'PAID'
        },
        data: {
          status: 'SAMPLE_COLLECTED'
        }
      });

      if (claimed.count !== 1) {
        const current = await tx.labOrder.findUnique({
          where: { id: order.id },
          select: { status: true }
        });

        if (current?.status === 'PENDING_BILLING') {
          throw Object.assign(
            new Error(
              'Laboratory work cannot start until the laboratory invoice is fully paid.'
            ),
            { status: 403, code: 'LAB_PAYMENT_REQUIRED' }
          );
        }

        if (current?.status === 'SAMPLE_COLLECTED') {
          return tx.labOrder.findUnique({
            where: { id: order.id }
          });
        }

        throw Object.assign(
          new Error(
            'Sample collection is no longer available for this laboratory order.'
          ),
          { status: 409, code: 'LAB_SAMPLE_COLLECTION_INVALID_STATE' }
        );
      }

      const collectedOrder = await tx.labOrder.findUnique({
        where: { id: order.id }
      });

      await tx.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'LAB_SAMPLE_COLLECTED',
          details: `Collected sample for Lab Order ${order.id} for Patient ${order.patient.fullNameEn}`,
          ipAddress: req.ip || '127.0.0.1'
        }
      });

      return collectedOrder;
    });

    return res.json(updated);
  } catch (error) {
    if (error.status && error.code) {
      return sendError(res, error.status, error.code, error.message);
    }

    console.error('Collect laboratory sample error:', error);
    return sendError(
      res,
      500,
      'LAB_SAMPLE_COLLECTION_FAILED',
      'Failed to record laboratory sample collection.'
    );
  }
});

/**
 * PUT /api/records/lab-orders/items/:id/results
 * Logs structured results and updates completed status.
 */
router.put('/lab-orders/items/:id/results', authenticate, allowRoles(ROLES.LAB_TECH), validate(z.object({
  expectedVersion: z.number().int().nonnegative().safe(),
  resultValue: z.string().trim().min(1).max(2000), referenceRangeMin: z.coerce.number().optional(),
  referenceRangeMax: z.coerce.number().optional(), isOutOfRange: z.boolean().optional(), fileAttachmentPath: z.string().max(300).optional()
})), async (req, res) => {
  const itemId = req.params.id;
  const { expectedVersion, resultValue, referenceRangeMin, referenceRangeMax, isOutOfRange, fileAttachmentPath } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw`
        SELECT o."id"
        FROM "LabOrder" o
        INNER JOIN "LabOrderItem" i ON i."labOrderId" = o."id"
        WHERE i."id" = ${itemId}
        FOR UPDATE OF o
      `;

      if (lockedOrders.length !== 1) {
        throw Object.assign(new Error('Laboratory order item not found.'), {
          status: 404,
          code: 'LAB_ORDER_ITEM_NOT_FOUND'
        });
      }

      const existingItem = await tx.labOrderItem.findUnique({
        where: { id: itemId },
        include: {
          labOrder: {
            include: {
              medicalRecord: { select: { appointmentId: true } }
            }
          }
        }
      });

      if (!existingItem) {
        throw Object.assign(new Error('Laboratory order item not found.'), {
          status: 404,
          code: 'LAB_ORDER_ITEM_NOT_FOUND'
        });
      }

      if (existingItem.labOrder.status === 'PENDING_BILLING') {
        throw Object.assign(new Error('Laboratory results cannot be entered until the laboratory invoice is fully paid.'), {
          status: 403,
          code: 'LAB_PAYMENT_REQUIRED'
        });
      }

      if (existingItem.labOrder.status === 'PAID') {
        throw Object.assign(new Error('The laboratory sample must be collected before results can be entered.'), {
          status: 409,
          code: 'LAB_SAMPLE_NOT_COLLECTED'
        });
      }

      if (existingItem.labOrder.status !== 'SAMPLE_COLLECTED' || existingItem.labOrder.releasedToPatientAt != null) {
        throw Object.assign(new Error('This laboratory result is finalized and can no longer be changed.'), {
          status: 409,
          code: 'LAB_RESULT_FINALIZED'
        });
      }

      if (existingItem.labReviewStatus === 'EXTERNAL') {
        throw Object.assign(new Error('External laboratory tests do not accept clinic results.'), {
          status: 409,
          code: 'LAB_EXTERNAL_TEST'
        });
      }

      if (existingItem.labReviewStatus === 'PENDING_REVIEW' || !existingItem.serviceId) {
        throw Object.assign(new Error('This laboratory test must be reviewed before results can be entered.'), {
          status: 409,
          code: 'LAB_REVIEW_PENDING'
        });
      }

      if (existingItem.resultVersion !== expectedVersion) {
        throw Object.assign(new Error('This laboratory result was changed by another user. Reload the latest result before saving.'), {
          status: 409,
          code: 'LAB_RESULT_CONFLICT'
        });
      }

      const updated = await tx.labOrderItem.updateMany({
        where: { id: itemId, resultVersion: expectedVersion },
        data: {
          resultValue,
          referenceRangeMin: referenceRangeMin !== undefined ? Number(referenceRangeMin) : null,
          referenceRangeMax: referenceRangeMax !== undefined ? Number(referenceRangeMax) : null,
          isOutOfRange: !!isOutOfRange,
          fileAttachmentPath,
          resultVersion: { increment: 1 }
        }
      });

      if (updated.count !== 1) {
        throw Object.assign(new Error('This laboratory result was changed by another user. Reload the latest result before saving.'), {
          status: 409,
          code: 'LAB_RESULT_CONFLICT'
        });
      }

      const item = await tx.labOrderItem.findUniqueOrThrow({
        where: { id: itemId },
        include: { labOrder: true }
      });
      const remainingItems = await tx.labOrderItem.count({
        where: {
          labOrderId: item.labOrderId,
          labReviewStatus: { not: 'EXTERNAL' },
          resultValue: null
        }
      });

      let returnedAppointmentId = null;
      let returnedDoctorId = null;
      if (remainingItems === 0) {
        const completed = await tx.labOrder.updateMany({
          where: {
            id: item.labOrderId,
            status: 'SAMPLE_COLLECTED',
            releasedToPatientAt: null
          },
          data: { status: 'COMPLETED' }
        });
        if (completed.count !== 1) {
          throw Object.assign(new Error('This laboratory result is finalized and can no longer be changed.'), {
            status: 409,
            code: 'LAB_RESULT_FINALIZED'
          });
        }

        returnedAppointmentId = existingItem.labOrder.medicalRecord?.appointmentId || null;
        if (returnedAppointmentId) {
          const returnedToDoctor = await tx.appointment.updateMany({
            where: { id: returnedAppointmentId, status: 'WAITING_LAB' },
            data: { status: 'IN_CONSULTATION' }
          });
          if (returnedToDoctor.count === 1) returnedDoctorId = existingItem.labOrder.doctorId;
        }
      }

      await tx.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'LAB_RESULTS_LOGGED',
          details: JSON.stringify({ labOrderItemId: item.id, labOrderId: item.labOrderId, resultVersion: item.resultVersion }),
          ipAddress: req.ip || '127.0.0.1'
        }
      });

      return { item, returnedAppointmentId, returnedDoctorId };
    });

    if (result.returnedAppointmentId && result.returnedDoctorId) {
      emitQueueUpdate(
        req.app.get('io'),
        {
          type: 'LAB_RESULTS_COMPLETED',
          appointmentId: result.returnedAppointmentId,
          doctorId: result.returnedDoctorId,
          status: 'IN_CONSULTATION'
        },
        [result.returnedDoctorId]
      );
    }

    return res.json(result.item);

  } catch (error) {
    if (error.status && error.code) return sendError(res, error.status, error.code, error.message);
    console.error('Log lab results error:', error);
    return res.status(500).json({ error: 'Failed to save lab results.' });
  }
});

router.put('/lab-orders/:id/release', authenticate, allowRoles(ROLES.LAB_TECH), async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "LabOrder" WHERE "id" = ${req.params.id} FOR UPDATE`;
      if (locked.length !== 1) {
        throw Object.assign(new Error('Lab order not found.'), { status: 404, code: 'LAB_ORDER_NOT_FOUND' });
      }

      const order = await tx.labOrder.findUnique({ where: { id: req.params.id } });
      if (!order) throw Object.assign(new Error('Lab order not found.'), { status: 404, code: 'LAB_ORDER_NOT_FOUND' });
      if (order.status !== 'COMPLETED') {
        throw Object.assign(new Error('Only completed lab orders can be released.'), { status: 409, code: 'LAB_ORDER_NOT_COMPLETE' });
      }
      if (order.releasedToPatientAt != null) return { order, idempotentReplay: true };

      const updated = await tx.labOrder.update({
        where: { id: order.id },
        data: { releasedToPatientAt: new Date() }
      });
      await tx.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'LAB_RESULTS_RELEASED_TO_PATIENT',
          details: `Released lab order ${order.id} to patient.`,
          ipAddress: req.ip || 'unknown'
        }
      });
      return { order: updated, idempotentReplay: false };
    });
    return res.json({
      id: result.order.id,
      releasedToPatientAt: result.order.releasedToPatientAt,
      ...(result.idempotentReplay ? { idempotentReplay: true } : {})
    });
  } catch (error) {
    if (error.status && error.code) return sendError(res, error.status, error.code, error.message);
    console.error('Release laboratory results error:', error);
    return sendError(res, 500, 'LAB_RESULTS_RELEASE_FAILED', 'Failed to release laboratory results.');
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
 * GET /api/records/:id/summary
 * Fetches compiled post-visit summary for a medical record or appointment ID.
 */
router.get('/:id/summary', authenticate, allowRoles(ROLES.DOCTOR), async (req, res) => {
  const targetId = req.params.id;
  if (!targetId || targetId === 'undefined' || targetId === 'null') {
    return res.status(400).json({ error: 'Record ID or Appointment ID is required.' });
  }

  try {
    let record = await prisma.medicalRecord.findFirst({
      where: {
        OR: [
          { id: targetId },
          { appointmentId: targetId }
        ]
      },
      include: {
        patient: true,
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
    });

    if (!record) {
      console.warn(`[GET /api/records/:id/summary] No record found matching targetId: "${targetId}"`);
      return res.status(404).json({ error: 'Visit medical record not found.' });
    }
    if (record.doctorId !== req.user.doctorId) return sendError(res, 403, 'RECORD_ACCESS_FORBIDDEN', 'This clinical record does not belong to the authenticated doctor.');

    let vitals = {};
    if (record.vitalSignsJson) {
      try {
        vitals = typeof record.vitalSignsJson === 'string' ? JSON.parse(record.vitalSignsJson) : record.vitalSignsJson;
      } catch (e) {
        console.error('Failed to parse vitalSignsJson:', e);
        vitals = {};
      }
    }

    const summary = {
      id: record.id,
      appointmentId: record.appointmentId,
      visitDate: record.visitDate,
      patient: {
        id: record.patient?.id || '',
        fullNameAr: record.patient?.fullNameAr || '',
        fullNameEn: record.patient?.fullNameEn || '',
        gender: record.patient?.gender || '',
        dateOfBirth: record.patient?.dateOfBirth || '',
        phone: record.patient?.phone || ''
      },
      doctor: {
        fullNameAr: record.doctor?.fullNameAr || '',
        fullNameEn: record.doctor?.fullNameEn || '',
        specialtyAr: record.doctor?.specialtyAr || '',
        specialtyEn: record.doctor?.specialtyEn || ''
      },
      vitals,
      symptoms: safeDecryptField(record.symptomsEncrypted),
      diagnosis: safeDecryptField(record.diagnosisEncrypted),
      treatment: safeDecryptField(record.treatmentEncrypted),
      clinicalNotes: safeDecryptField(record.clinicalNotesEncrypted),
      prescriptions: (record.prescriptions || []).flatMap(p => (p.prescribedDrugs || []).map(pd => ({
        drugNameAr: pd.drug?.labelAr || pd.drug?.genericName || pd.customDrugName || '',
        drugNameEn: pd.drug?.labelEn || pd.drug?.genericName || pd.customDrugName || '',
        dosage: pd.dosage || '',
        duration: pd.duration || '',
        instructionsAr: pd.instructionsAr || '',
        instructionsEn: pd.instructionsEn || '',
        qtyPrescribed: pd.qtyPrescribed || 0
      }))),
      labOrders: (record.labOrders || []).flatMap(lo => (lo.items || []).map(i => ({
        serviceNameAr: i.service?.labelAr || i.customTestName || '',
        serviceNameEn: i.service?.labelEn || i.customTestName || '',
        resultValue: i.resultValue || '',
        referenceRangeMin:
          i.referenceRangeMin !== null && i.referenceRangeMin !== undefined
            ? String(i.referenceRangeMin)
            : '',
        referenceRangeMax:
          i.referenceRangeMax !== null && i.referenceRangeMax !== undefined
            ? String(i.referenceRangeMax)
            : '',
        isOutOfRange: !!i.isOutOfRange
      }))),
      // There is currently no dedicated clinician-authored patient-instructions
      // field on MedicalRecord. Never synthesize clinical advice in a summary.
      instructions: []
    };

    return res.json(summary);
  } catch (error) {
    console.error('Fetch visit summary error:', error);
    return res.status(500).json({ error: 'Failed to generate visit summary.' });
  }
});

/**
 * POST /api/records/:id/send-summary
 * Emails post-visit summary directly to the patient.
 */
router.post('/:id/send-summary', authenticate, allowRoles(ROLES.DOCTOR), validate(z.object({}).strict()), async (req, res) => {
  const targetId = req.params.id;

  try {
    let record = await prisma.medicalRecord.findUnique({
      where: { id: targetId },
      include: {
        patient: true,
        doctor: true,
        prescriptions: {
          include: {
            prescribedDrugs: {
              include: { drug: true }
            }
          }
        }
      }
    });

    if (!record) {
      record = await prisma.medicalRecord.findFirst({
        where: { appointmentId: targetId },
        include: {
          patient: true,
          doctor: true,
          prescriptions: {
            include: {
              prescribedDrugs: {
                include: { drug: true }
              }
            }
          }
        }
      });
    }
    if (!record) {
      return sendError(res, 404, 'MEDICAL_RECORD_NOT_FOUND', 'Visit medical record not found.');
    }
    if (record.doctorId !== req.user.doctorId) return sendError(res, 403, 'RECORD_ACCESS_FORBIDDEN', 'This clinical record does not belong to the authenticated doctor.');

    const patientUser = record.patient.userId
      ? await prisma.user.findUnique({
        where: { id: record.patient.userId },
        select: { email: true, emailVerifiedAt: true, role: true }
      })
      : null;
    if (
      !patientUser
      || patientUser.role !== ROLES.PATIENT
      || !patientUser.emailVerifiedAt
      || !patientUser.email
      || !z.string().email().safeParse(patientUser.email).success
    ) {
      return sendError(res, 409, 'PATIENT_VERIFIED_EMAIL_REQUIRED', 'A verified patient email address is required to send the visit summary.');
    }
    const recipientEmail = patientUser.email;
    const diagnosis = decrypt(record.diagnosisEncrypted);
    const treatment = decrypt(record.treatmentEncrypted);
    const vitals = JSON.parse(record.vitalSignsJson || '{}');

    const drugsListHtml = record.prescriptions.flatMap(p => p.prescribedDrugs).map(pd => {
      const medicationInstructions = pd.instructionsEn || pd.instructionsAr;
      return `<li><strong>${pd.drug?.labelEn || pd.drug?.genericName || pd.customDrugName || ''}</strong>: ${pd.dosage} for ${pd.duration}${medicationInstructions ? ` (${medicationInstructions})` : ''}</li>`;
    }).join('');

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; color: #1f2937;">
        <h2 style="color: #0d9488; text-align: center; border-bottom: 2px solid #0d9488; padding-bottom: 10px;">Al-Shifa Medical Center<br/><span style="font-size:16px;">Visit Summary</span></h2>
        
        <p><strong>Patient Name:</strong> ${record.patient.fullNameEn} (${record.patient.fullNameAr})</p>
        <p><strong>Attending Doctor:</strong> ${record.doctor.fullNameEn} - ${record.doctor.specialtyEn}</p>
        <p><strong>Visit Date:</strong> ${new Date(record.visitDate).toLocaleDateString()}</p>
        
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        
        <h4 style="color: #0369a1; margin-bottom: 8px;">Vital Signs</h4>
        <p style="background: #f0f9ff; padding: 10px; border-radius: 6px;">
          Blood Pressure: ${vitals.blood_pressure || 'N/A'} | Heart Rate: ${vitals.heart_rate || 'N/A'} bpm | Temp: ${vitals.temperature || 'N/A'} °C | Weight: ${vitals.weight || 'N/A'} kg
        </p>

        <h4 style="color: #0369a1; margin-bottom: 8px;">Diagnosis & Care Plan</h4>
        <p><strong>Diagnosis:</strong> ${diagnosis}</p>
        <p><strong>Treatment:</strong> ${treatment}</p>

        ${drugsListHtml ? `<h4 style="color: #0369a1; margin-bottom: 8px;">Prescribed Medications</h4><ul>${drugsListHtml}</ul>` : ''}

        <p style="text-align: center; font-size: 12px; color: #6b7280; margin-top: 24px;">Al-Shifa Medical Center - Khartoum, Sudan. Phone: +249 91 234 5678</p>
      </div>
    `;

    const delivery = await sendEmail({
      to: recipientEmail,
      subject: `Post-Visit Summary - Al-Shifa Medical Center`,
      text: `Visit summary for ${record.patient.fullNameEn}. Diagnosis: ${diagnosis}. Treatment: ${treatment}`,
      html: htmlContent
    });

    if (!delivery) return sendError(res, 503, 'EMAIL_DELIVERY_FAILED', 'Post-visit summary could not be delivered.');
    return res.json({ success: true, message: 'Post-visit summary emailed successfully.' });

  } catch (error) {
    console.error('Email visit summary error:', error);
    return res.status(500).json({ error: 'Failed to email visit summary.' });
  }
});

export default router;
