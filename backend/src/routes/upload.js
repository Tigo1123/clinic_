import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { sendError } from '../utils/apiError.js';

const router = express.Router();
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024), files: 1 } });
const signatures = [
  { mime: 'image/jpeg', ext: '.jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  { mime: 'image/gif', ext: '.gif', matches: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString()) },
  { mime: 'application/pdf', ext: '.pdf', matches: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx', matches: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 }
];

router.post('/', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DOCTOR, ROLES.LAB_TECH), upload.single('file'), (req, res) => {
  if (!req.file) return sendError(res, 400, 'FILE_REQUIRED', 'No file was provided.');
  const detected = signatures.find((signature) => signature.matches(req.file.buffer));
  if (!detected || detected.mime !== req.file.mimetype) {
    return sendError(res, 422, 'UNSUPPORTED_FILE_TYPE', 'File content does not match an allowed JPEG, PNG, GIF, PDF, or DOCX type.');
  }
  const filename = `${crypto.randomUUID()}${detected.ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer, { flag: 'wx' });
  return res.status(201).json({ message: 'File uploaded successfully.', filePath: `/api/upload/${filename}` });
});

router.get('/:filename', authenticate, async (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename);
    if (filename !== req.params.filename) return sendError(res, 400, 'INVALID_FILE_PATH', 'Invalid attachment path.');
    const legacyPath = `/uploads/${filename}`;
    const securePath = `/api/upload/${filename}`;
    let authorized = false;

    if ([ROLES.ADMIN, ROLES.RECEPTIONIST].includes(req.user.role)) {
      authorized = Boolean(await prisma.patient.findFirst({
        where: { OR: [{ nationalIdAttachmentPath: { in: [legacyPath, securePath] } }, { insuranceAttachmentPath: { in: [legacyPath, securePath] } }] },
        select: { id: true }
      }));
    }
    if (!authorized && req.user.role === ROLES.DOCTOR) {
      authorized = Boolean(await prisma.medicalRecord.findFirst({
        where: { attachmentPath: { in: [legacyPath, securePath] }, doctorId: req.user.doctorId }, select: { id: true }
      })) || Boolean(await prisma.labOrderItem.findFirst({
        where: { fileAttachmentPath: { in: [legacyPath, securePath] }, labOrder: { doctorId: req.user.doctorId } }, select: { id: true }
      }));
    }
    if (!authorized && req.user.role === ROLES.LAB_TECH) {
      authorized = Boolean(await prisma.labOrderItem.findFirst({
        where: { fileAttachmentPath: { in: [legacyPath, securePath] } }, select: { id: true }
      }));
    }
    if (!authorized && req.user.role === ROLES.PATIENT) {
      const ownedPatient = await prisma.patient.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (ownedPatient) {
        authorized = Boolean(await prisma.medicalRecord.findFirst({ where: { patientId: ownedPatient.id, attachmentPath: { in: [legacyPath, securePath] } }, select: { id: true } })) || Boolean(await prisma.labOrderItem.findFirst({ where: { fileAttachmentPath: { in: [legacyPath, securePath] }, labOrder: { patientId: ownedPatient.id, status: 'COMPLETED', releasedToPatientAt: { not: null } } }, select: { id: true } }));
      }
    }
    if (!authorized) return sendError(res, 403, 'ATTACHMENT_ACCESS_FORBIDDEN', 'You do not have access to this attachment.');

    const resolved = path.join(uploadDir, filename);
    if (!fs.existsSync(resolved)) return sendError(res, 404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found.');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(resolved);
  } catch (error) { next(error); }
});

export default router;
