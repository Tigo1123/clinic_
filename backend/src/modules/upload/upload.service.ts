import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';

const signatures = [
  { mime: 'image/jpeg', ext: '.jpg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: 'image/gif', ext: '.gif', matches: (b: Buffer) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString()) },
  { mime: 'application/pdf', ext: '.pdf', matches: (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx', matches: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
];

export interface UploadedMulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
}

@Injectable()
export class UploadService {
  private readonly uploadDir: string;

  constructor(private readonly prisma: PrismaService) {
    this.uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
    if (!fs.existsSync(this.uploadDir)) {
      try {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      } catch {
        // Ignored if cannot create in sandbox
      }
    }
  }

  getUploadDir(): string {
    return this.uploadDir;
  }

  async validateAndSaveFile(file?: UploadedMulterFile): Promise<{ message: string; filePath: string }> {
    if (!file || !file.buffer) {
      throw new HttpException(
        { code: 'FILE_REQUIRED', message: 'No file was provided.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const detected = signatures.find((signature) => signature.matches(file.buffer));
    if (!detected || detected.mime !== file.mimetype) {
      throw new HttpException(
        {
          code: 'UNSUPPORTED_FILE_TYPE',
          message: 'File content does not match an allowed JPEG, PNG, GIF, PDF, or DOCX type.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const filename = `${crypto.randomUUID()}${detected.ext}`;
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }

    fs.writeFileSync(path.join(this.uploadDir, filename), file.buffer, { flag: 'wx' });

    return {
      message: 'File uploaded successfully.',
      filePath: `/api/upload/${filename}`,
    };
  }

  async getAuthorizedFilePath(paramFilename: string, user: any): Promise<string> {
    const filename = path.basename(paramFilename);
    if (filename !== paramFilename) {
      throw new HttpException(
        { code: 'INVALID_FILE_PATH', message: 'Invalid attachment path.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const legacyPath = `/uploads/${filename}`;
    const securePath = `/api/upload/${filename}`;
    let authorized = false;

    if (['ADMIN', 'RECEPTIONIST'].includes(user.role)) {
      authorized = Boolean(
        await this.prisma.patient.findFirst({
          where: {
            OR: [
              { nationalIdAttachmentPath: { in: [legacyPath, securePath] } },
              { insuranceAttachmentPath: { in: [legacyPath, securePath] } },
            ],
          },
          select: { id: true },
        }),
      );
    }

    if (!authorized && user.role === 'DOCTOR') {
      const mr = await this.prisma.medicalRecord.findFirst({
        where: { attachmentPath: { in: [legacyPath, securePath] }, doctorId: user.doctorId },
        select: { id: true },
      });
      const lo = await this.prisma.labOrderItem.findFirst({
        where: { fileAttachmentPath: { in: [legacyPath, securePath] }, labOrder: { doctorId: user.doctorId } },
        select: { id: true },
      });
      authorized = Boolean(mr || lo);
    }

    if (!authorized && user.role === 'LAB_TECH') {
      authorized = Boolean(
        await this.prisma.labOrderItem.findFirst({
          where: { fileAttachmentPath: { in: [legacyPath, securePath] } },
          select: { id: true },
        }),
      );
    }

    if (!authorized && user.role === 'PATIENT') {
      const ownedPatient = await this.prisma.patient.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (ownedPatient) {
        const mr = await this.prisma.medicalRecord.findFirst({
          where: { patientId: ownedPatient.id, attachmentPath: { in: [legacyPath, securePath] } },
          select: { id: true },
        });
        const lo = await this.prisma.labOrderItem.findFirst({
          where: {
            fileAttachmentPath: { in: [legacyPath, securePath] },
            labOrder: { patientId: ownedPatient.id, status: 'COMPLETED', releasedToPatientAt: { not: null } },
          },
          select: { id: true },
        });
        authorized = Boolean(mr || lo);
      }
    }

    if (!authorized) {
      throw new HttpException(
        { code: 'ATTACHMENT_ACCESS_FORBIDDEN', message: 'You do not have access to this attachment.' },
        HttpStatus.FORBIDDEN,
      );
    }

    const resolved = path.join(this.uploadDir, filename);
    if (!fs.existsSync(resolved)) {
      throw new HttpException(
        { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    return resolved;
  }
}
