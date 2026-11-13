import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';
import { PrismaService } from '../../database/prisma.service.js';

const require = createRequire(import.meta.url);
const {
  createVerificationChallenge,
  consumeVerificationChallenge,
  registrationPurpose,
  invalidateChallenges,
  verificationUnavailable,
} = require('../../services/verification.js');
const { resolveGooglePatientIdentity } = require('../../services/googlePatientIdentity.js');
const { completeGooglePatientOnboarding } = require('../../services/googlePatientOnboarding.js');
const { normalizeEmail, normalizePhone } = require('../../utils/identity.js');
const { normalizePatientPhone } = require('../../utils/patientIdentity.js');
const { lockPatientIdentity, patientIdentitySummary } = require('../../utils/patientOnboarding.js');
const { structuredPatientName } = require('../../utils/patientName.js');
const { getClinicDateString } = require('../../utils/clinicTime.js');
const { ApiError } = require('../../utils/apiError.js');

const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
const verificationResendCooldownMs = 60 * 1000;
const CLAIM_PUBLIC_ID_BYTES = 12;
const CLAIM_SECRET_BYTES = 24;
const CLAIM_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32}$/;

const offlineVerificationDisabled = () => process.env.VERIFICATION_PROVIDER === 'disabled';
const requestedAddressStateId = (value?: number) => value ?? Number(process.env.DEFAULT_STATE_ID || 1);

async function resolveAddressStateId(client: any, addressStateId: number) {
  const state = await client.state.findUnique({ where: { id: addressStateId }, select: { id: true } });
  if (!state) {
    throw new HttpException(
      { code: 'INVALID_ADDRESS_STATE', message: 'The selected address state is unavailable.' },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return state.id;
}

function parseClaimCredential(code: string) {
  if (!CLAIM_CREDENTIAL_PATTERN.test(String(code))) return null;
  const [publicId, secret] = String(code).split('.');
  return { publicId, secret };
}

const claimVerificationFailed = () => new ApiError(422, 'CLAIM_VERIFICATION_FAILED', 'Claim verification failed.');

async function matchingPatients(phoneNormalized: string, dateOfBirth: string, db: any) {
  const candidates = await db.patient.findMany({
    where: { dateOfBirth },
    select: { id: true, phone: true, userId: true },
  });
  return candidates.filter((patient: any) => normalizePatientPhone(patient.phone) === phoneNormalized);
}

async function consumeClaimCredential(
  tx: any,
  { credential, patientId, dateOfBirth }: any,
): Promise<{ error?: any; claim?: any }> {
  // ApiError (not HttpException) so offline activation can audit rejections like Express does.
  const claimFailure = () => ({
    error: new ApiError(422, 'CLAIM_VERIFICATION_FAILED', 'Claim verification failed.'),
  });

  const parsed = parseClaimCredential(credential);
  if (!parsed) return claimFailure();

  const claim = await tx.patientClaimCode.findUnique({
    where: { publicId: parsed.publicId },
    include: {
      patient: { select: { id: true, userId: true, dateOfBirth: true } },
      createdBy: { select: { status: true, role: true, authVersion: true } },
    },
  });

  if (
    !claim ||
    claim.patientId !== patientId ||
    claim.patient.userId ||
    claim.patient.dateOfBirth !== dateOfBirth ||
    claim.usedAt ||
    claim.expiresAt <= new Date() ||
    claim.attemptCount >= claim.maxAttempts ||
    claim.issuerAuthVersion === null ||
    claim.createdBy.status !== 'ACTIVE' ||
    !['ADMIN', 'RECEPTIONIST'].includes(claim.createdBy.role) ||
    claim.createdBy.authVersion !== claim.issuerAuthVersion
  ) {
    return claimFailure();
  }

  const valid = await bcrypt.compare(parsed.secret, claim.codeHash);
  if (!valid) {
    await tx.patientClaimCode.updateMany({
      where: { id: claim.id, usedAt: null, attemptCount: { lt: claim.maxAttempts } },
      data: { attemptCount: { increment: 1 } },
    });
    return claimFailure();
  }

  const consumed = await tx.patientClaimCode.updateMany({
    where: {
      id: claim.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
      attemptCount: { lt: claim.maxAttempts },
    },
    data: { usedAt: new Date() },
  });

  return consumed.count === 1 ? { claim } : claimFailure();
}

@Injectable()
export class PatientAuthService {
  constructor(private readonly prisma: PrismaService) {}

  private async audit(userId: string | null, action: string, details: string, ip?: string, tx?: any) {
    const client = tx || this.prisma;
    return client.tenantAuditLog.create({
      data: {
        userId,
        action,
        details,
        ipAddress: ip || 'unknown',
      },
    });
  }

  async register(body: any, ip?: string) {
    let createdUserId: string | null = null;
    try {
      if (offlineVerificationDisabled()) {
        throw verificationUnavailable();
      }

      const addressStateId = requestedAddressStateId(body.addressStateId);
      const phoneNormalized = normalizePatientPhone(body.phone);
      const email = normalizeEmail(body.email);

      if (!phoneNormalized) {
        throw new HttpException(
          { code: 'PHONE_INVALID', message: 'Phone number is invalid.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      if (body.dateOfBirth >= getClinicDateString()) {
        throw new HttpException(
          { code: 'INVALID_DATE_OF_BIRTH', message: 'Date of birth must be in the past.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      if (await this.prisma.user.findUnique({ where: { phoneNormalized } })) {
        throw new HttpException(
          { code: 'PHONE_ALREADY_REGISTERED', message: 'An account already exists for this phone number.' },
          HttpStatus.CONFLICT,
        );
      }

      if (
        email &&
        (await this.prisma.user.findFirst({
          where: {
            OR: [
              { email: { equals: email, mode: 'insensitive' } },
              { username: { equals: email, mode: 'insensitive' } },
            ],
          },
        }))
      ) {
        throw new HttpException(
          { code: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email.' },
          HttpStatus.CONFLICT,
        );
      }

      const passwordHash = await bcrypt.hash(body.password, bcryptRounds);

      const user = await this.prisma.$transaction(async (tx: any) => {
        const resolvedAddressStateId = await resolveAddressStateId(tx, addressStateId);
        const created = await tx.user.create({
          data: {
            username: email || phoneNormalized,
            email,
            phoneNormalized,
            passwordHash,
            role: 'PATIENT',
            status: 'PENDING_VERIFICATION',
            preferredLanguage: 'en',
          },
        });
        const name = structuredPatientName(body);
        await tx.patientRegistration.create({
          data: {
            userId: created.id,
            ...name,
            gender: body.gender,
            dateOfBirth: body.dateOfBirth,
            addressStateId: resolvedAddressStateId,
          },
        });
        await this.audit(created.id, 'PATIENT_ACCOUNT_REGISTRATION', 'Patient online account registration started.', ip, tx);
        return created;
      });

      createdUserId = user.id;
      const verificationType = registrationPurpose();
      const verificationTarget = verificationType.endsWith('EMAIL') ? email : phoneNormalized;

      if (!verificationTarget) {
        throw new HttpException(
          { code: 'VERIFICATION_TARGET_MISSING', message: 'Email is required when email verification is configured.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const { challenge, developmentCode } = await createVerificationChallenge(user, verificationType, verificationTarget);

      return {
        state: 'VERIFICATION_REQUIRED',
        identity: patientIdentitySummary({
          ...structuredPatientName(body),
          gender: body.gender,
          dateOfBirth: body.dateOfBirth,
          phone: phoneNormalized,
          addressStateId,
        }),
        challengeId: challenge.id,
        ...(developmentCode ? { developmentCode } : {}),
      };
    } catch (error: any) {
      if (createdUserId) {
        await this.prisma.$transaction(async (tx: any) => {
          await tx.user.deleteMany({ where: { id: createdUserId } });
          await tx.tenantAuditLog.deleteMany({ where: { userId: createdUserId, action: 'PATIENT_ACCOUNT_REGISTRATION' } });
        }).catch(() => {});
      }
      if (error instanceof HttpException) throw error;
      if (error.code === 'P2002') {
        const target = error.meta?.target || [];
        if (target.includes('phoneNormalized')) {
          throw new HttpException({ code: 'PHONE_ALREADY_REGISTERED', message: 'An account already exists for this phone number.' }, HttpStatus.CONFLICT);
        }
        if (target.includes('email') || target.includes('username')) {
          throw new HttpException({ code: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email.' }, HttpStatus.CONFLICT);
        }
        throw new HttpException({ code: 'ACCOUNT_ALREADY_EXISTS', message: 'An account already exists for this identity.' }, HttpStatus.CONFLICT);
      }
      if (error.status && error.code) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  }

  async verify(body: { challengeId: string; code: string }, ip?: string) {
    const challengeRecord = await this.prisma.verificationChallenge.findUnique({
      where: { id: body.challengeId },
      select: { type: true },
    });
    if (!challengeRecord || !['REGISTRATION_EMAIL', 'REGISTRATION_PHONE'].includes(challengeRecord.type)) {
      throw new HttpException(
        { code: 'VERIFICATION_INVALID', message: 'Verification challenge is invalid or already used.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const result = await consumeVerificationChallenge({
      challengeId: body.challengeId,
      code: body.code,
      purpose: challengeRecord.type,
      transition: async (tx: any, challenge: any) => {
        const linkedPatient = await tx.patient.findUnique({ where: { userId: challenge.userId } });
        if (linkedPatient) return { state: 'VERIFIED', patient: patientIdentitySummary(linkedPatient) };

        const registration = await tx.patientRegistration.findUnique({ where: { userId: challenge.userId } });
        if (!registration) {
          throw new HttpException(
            { code: 'REGISTRATION_STATE_INVALID', message: 'Registration details are unavailable.' },
            HttpStatus.CONFLICT,
          );
        }

        const addressStateId = await resolveAddressStateId(tx, registration.addressStateId);
        await tx.user.update({
          where: { id: challenge.userId },
          data: {
            status: 'ACTIVE',
            ...(challenge.type.endsWith('PHONE') ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() }),
          },
        });

        await lockPatientIdentity(tx, { phone: challenge.user.phoneNormalized, dateOfBirth: registration.dateOfBirth });
        const matches = await matchingPatients(challenge.user.phoneNormalized, registration.dateOfBirth, tx);

        if (matches.some((patient: any) => patient.userId)) {
          await this.audit(challenge.userId, 'PATIENT_CLAIM_REJECTED', 'Matching patient record is already claimed.', ip, tx);
          return { state: 'MANUAL_REVIEW_REQUIRED' };
        }

        if (matches.length === 0) {
          const patient = await tx.patient.create({
            data: {
              userId: challenge.userId,
              fullNameAr: registration.fullNameAr,
              fullNameEn: registration.fullNameEn,
              firstNameAr: registration.firstNameAr,
              fatherNameAr: registration.fatherNameAr,
              grandfatherNameAr: registration.grandfatherNameAr,
              familyNameAr: registration.familyNameAr,
              firstNameEn: registration.firstNameEn,
              fatherNameEn: registration.fatherNameEn,
              grandfatherNameEn: registration.grandfatherNameEn,
              familyNameEn: registration.familyNameEn,
              gender: registration.gender,
              dateOfBirth: registration.dateOfBirth,
              phone: challenge.user.phoneNormalized,
              addressStateId,
              emergencyContact: 'Self',
            },
          });
          await this.audit(challenge.userId, 'PATIENT_FILE_CREATED', JSON.stringify({ patientId: patient.id, fileNumber: patient.fileNumber, context: 'ONLINE_VERIFICATION' }), ip, tx);
          await this.audit(challenge.userId, 'PATIENT_RECORD_CREATED', `Created patient record ${patient.id} for verified account.`, ip, tx);
          return { state: 'CLAIMED', patient: patientIdentitySummary(patient) };
        }

        if (matches.length === 1) {
          const matchedPatient = matches[0];
          const verifiedUser = await tx.user.findUnique({
            where: { id: challenge.userId },
            select: { phoneVerifiedAt: true },
          });

          if (!verifiedUser?.phoneVerifiedAt) {
            await this.audit(challenge.userId, 'PATIENT_AUTO_LINK_REJECTED', 'Automatic linkage to an existing patient record requires a verified phone number.', ip, tx);
            return { state: 'MANUAL_REVIEW_REQUIRED', reason: 'VERIFIED_PHONE_REQUIRED' };
          }

          const linked = await tx.patient.updateMany({
            where: { id: matchedPatient.id, userId: null },
            data: { userId: challenge.userId },
          });

          if (linked.count !== 1) {
            await this.audit(challenge.userId, 'PATIENT_AUTO_LINK_CONFLICT', 'Matching patient record could not be auto-linked because ownership changed.', ip, tx);
            return { state: 'MANUAL_REVIEW_REQUIRED' };
          }

          await this.audit(challenge.userId, 'PATIENT_RECORD_AUTO_LINKED', `Automatically linked verified account to existing patient record ${matchedPatient.id}.`, ip, tx);
          return { state: 'CLAIMED', patient: patientIdentitySummary(await tx.patient.findUnique({ where: { id: matchedPatient.id } })) };
        }

        await this.audit(challenge.userId, 'PATIENT_CLAIM_AMBIGUOUS', 'Multiple patient records matched verified identity and date of birth.', ip, tx);
        return { state: 'AMBIGUOUS_MATCH' };
      },
    });

    return result;
  }

  async verifyGoogle(credential: string) {
    const result = await resolveGooglePatientIdentity({ credential });
    const status = ['ACCOUNT_LINK_REQUIRED', 'REGISTRATION_PENDING'].includes(result.status)
      ? HttpStatus.CONFLICT
      : HttpStatus.OK;
    return { status, result };
  }

  async completeGoogle(body: any) {
    try {
      return await completeGooglePatientOnboarding({ onboardingToken: body.onboardingToken, fields: body });
    } catch (error: any) {
      if (error.code === 'P2002') {
        const target = error.meta?.target || [];
        if (target.includes('phoneNormalized')) {
          throw new HttpException({ code: 'PHONE_ALREADY_REGISTERED', message: 'An account already exists for this phone number.' }, HttpStatus.CONFLICT);
        }
        if (target.includes('email') || target.includes('username')) {
          throw new HttpException({ code: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email.' }, HttpStatus.CONFLICT);
        }
        throw new HttpException({ code: 'ACCOUNT_ALREADY_EXISTS', message: 'An account already exists for this identity.' }, HttpStatus.CONFLICT);
      }
      if (error.status && error.code) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  }

  async claim(userId: string, body: { code: string; dateOfBirth: string }, ip?: string) {
    if (await this.prisma.patient.findUnique({ where: { userId } })) {
      throw new HttpException(
        { code: 'PATIENT_ALREADY_LINKED', message: 'Account is already linked to a patient record.' },
        HttpStatus.CONFLICT,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found.' }, HttpStatus.NOT_FOUND);

    const matches = await matchingPatients(user.phoneNormalized!, body.dateOfBirth, this.prisma);
    if (matches.length !== 1 || matches[0].userId) {
      await this.audit(user.id, 'PATIENT_CLAIM_REJECTED', 'Patient claim did not resolve to one available record.', ip);
      return { state: matches.length > 1 ? 'AMBIGUOUS_MATCH' : 'MANUAL_REVIEW_REQUIRED' };
    }

    const linked = await this.prisma.$transaction(async (tx: any) => {
      const result = await consumeClaimCredential(tx, {
        credential: body.code,
        patientId: matches[0].id,
        dateOfBirth: body.dateOfBirth,
      });
      if (result.error) return false;
      const updated = await tx.patient.updateMany({
        where: { id: matches[0].id, userId: null },
        data: { userId: user.id },
      });
      if (updated.count !== 1) return false;
      await this.audit(user.id, 'PATIENT_RECORD_CLAIMED', `Claimed existing patient record ${matches[0].id}.`, ip, tx);
      return true;
    });

    if (!linked) {
      await this.audit(user.id, 'PATIENT_CLAIM_REJECTED', 'Patient claim credential was rejected or ownership changed.', ip);
      throw new HttpException(
        { code: 'CLAIM_VERIFICATION_FAILED', message: 'Claim verification failed.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return { state: 'CLAIMED' };
  }

  async offlineActivation(body: any, ip?: string) {
    try {
      if (!offlineVerificationDisabled()) {
        throw new ApiError(409, 'OFFLINE_ACTIVATION_UNAVAILABLE', 'Clinic-assisted activation is not available while online verification is enabled.');
      }

      const parsed = parseClaimCredential(body.code);
      if (!parsed) throw claimVerificationFailed();

      const preliminary = await this.prisma.patientClaimCode.findUnique({
        where: { publicId: parsed.publicId },
        select: { patientId: true },
      });
      if (!preliminary) throw claimVerificationFailed();

      const email = body.email ? normalizeEmail(body.email) : null;
      const passwordHash = await bcrypt.hash(body.password, bcryptRounds);

      // Failures are returned, not thrown, inside the transaction: a thrown
      // error would roll back the claim-attempt counter that consumeClaimCredential
      // just incremented, which would remove the brute-force limit.
      const result = await this.prisma.$transaction(async (tx: any) => {
        const patient = await tx.patient.findUnique({ where: { id: preliminary.patientId } });
        if (!patient || patient.userId) return { error: claimVerificationFailed() };

        const consumed = await consumeClaimCredential(tx, {
          credential: body.code,
          patientId: patient.id,
          dateOfBirth: body.dateOfBirth,
        });
        if (consumed.error) return { error: consumed.error };

        const phoneNormalized = normalizePhone(patient.phone);
        if (!phoneNormalized) return { error: claimVerificationFailed() };

        const user = await tx.user.create({
          data: {
            username: email || phoneNormalized,
            email,
            phoneNormalized,
            passwordHash,
            role: 'PATIENT',
            status: 'ACTIVE',
            preferredLanguage: 'en',
          },
        });

        const linked = await tx.patient.updateMany({
          where: { id: patient.id, userId: null },
          data: { userId: user.id },
        });

        if (linked.count !== 1) {
          throw new ApiError(409, 'PATIENT_ALREADY_CLAIMED', 'Patient record was claimed by another account.');
        }

        await this.audit(user.id, 'PATIENT_OFFLINE_ACTIVATION_COMPLETED', `Clinic-assisted activation linked patient record ${patient.id}.`, ip, tx);
        return { userId: user.id, patientId: patient.id, patient: patientIdentitySummary(patient) };
      });

      if (result.error) throw result.error;
      return { state: 'ACTIVATED', patient: result.patient };
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ApiError(409, 'ACCOUNT_ALREADY_EXISTS', 'An account already exists for this identity.');
      }
      if (error instanceof ApiError && error.code === 'CLAIM_VERIFICATION_FAILED') {
        await this.audit(null, 'PATIENT_OFFLINE_ACTIVATION_REJECTED', 'Offline activation credential was rejected.', ip).catch(() => {});
      }
      throw error;
    }
  }

  async issueClaimCode(patientId: string, actor: any, ip?: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      throw new HttpException({ code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' }, HttpStatus.NOT_FOUND);
    }
    if (patient.userId) {
      throw new HttpException({ code: 'PATIENT_ALREADY_CLAIMED', message: 'Patient record is already linked.' }, HttpStatus.CONFLICT);
    }

    const publicId = crypto.randomBytes(CLAIM_PUBLIC_ID_BYTES).toString('base64url');
    const secret = crypto.randomBytes(CLAIM_SECRET_BYTES).toString('base64url');
    const code = `${publicId}.${secret}`;

    await this.prisma.$transaction(async (tx: any) => {
      await tx.patientClaimCode.updateMany({
        where: { patientId: patient.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.patientClaimCode.create({
        data: {
          patientId: patient.id,
          publicId,
          codeHash: await bcrypt.hash(secret, 10),
          expiresAt: new Date(Date.now() + 30 * 60000),
          createdById: actor.id,
          issuerAuthVersion: actor.av,
        },
      });
      await this.audit(actor.id, 'PATIENT_CLAIM_CODE_ISSUED', `Issued claim code for patient ${patient.id}.`, ip, tx);
    });

    return { code, expiresInMinutes: 30 };
  }

  async forgotPassword(body: { email: string }, ip?: string) {
    // Deliberately non-generic in offline mode: a generic "sent" response would
    // be a false delivery claim. It reveals no account state.
    if (offlineVerificationDisabled()) throw verificationUnavailable();
    const email = normalizeEmail(body.email);

    const genericResponse = {
      success: true,
      message: 'If an account exists for this email, a password reset code has been sent.',
    };

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Do not reveal whether the email exists.
    if (!user || user.role !== 'PATIENT' || user.status !== 'ACTIVE') {
      return { ...genericResponse, challengeId: crypto.randomUUID() };
    }

    let issued: any;
    try {
      issued = await createVerificationChallenge(user, 'PASSWORD_RESET', email);
    } catch (error: any) {
      if (!(error instanceof ApiError)) throw error;
      // Delivery and concurrent identity changes must not disclose existence.
      return { ...genericResponse, challengeId: crypto.randomUUID() };
    }
    const { challenge, developmentCode } = issued;

    await this.audit(user.id, 'PATIENT_PASSWORD_RESET_REQUESTED', 'Patient requested a password reset code.', ip);

    return {
      ...genericResponse,
      challengeId: challenge.id,
      ...(process.env.VERIFICATION_PROVIDER === 'development' && process.env.NODE_ENV !== 'production'
        ? { developmentCode }
        : {}),
    };
  }

  async resetPassword(body: { challengeId: string; code: string; newPassword: string }, ip?: string) {
    const passwordHash = await bcrypt.hash(body.newPassword, bcryptRounds);
    try {
      await consumeVerificationChallenge({
        challengeId: body.challengeId,
        code: body.code,
        purpose: 'PASSWORD_RESET',
        transition: async (tx: any, challenge: any) => {
          await tx.user.update({
            where: { id: challenge.userId },
            data: { passwordHash, lastPasswordChange: new Date(), authVersion: { increment: 1 } },
          });
          await invalidateChallenges(tx, challenge.userId);
          await this.audit(challenge.userId, 'PATIENT_PASSWORD_RESET_COMPLETED', 'Patient password was reset successfully.', ip, tx);
        },
      });
    } catch (error: any) {
      // Password-reset clients see PASSWORD_RESET_* codes for the shared verification failures.
      if (error instanceof ApiError && error.code?.startsWith('VERIFICATION_')) {
        error.code = error.code.replace('VERIFICATION_', 'PASSWORD_RESET_');
      }
      throw error;
    }

    return { success: true, message: 'Password reset successfully.' };
  }

  async resendRegistrationChallenge(challengeId: string, ip?: string) {
    const previousChallenge = await this.prisma.verificationChallenge.findUnique({
      where: { id: challengeId },
      include: { user: true },
    });

    if (
      !previousChallenge ||
      previousChallenge.usedAt ||
      !['REGISTRATION_EMAIL', 'REGISTRATION_PHONE'].includes(previousChallenge.type) ||
      previousChallenge.authVersion !== previousChallenge.user.authVersion
    ) {
      throw new ApiError(422, 'VERIFICATION_INVALID', 'Verification challenge is invalid or already used.');
    }

    if (previousChallenge.user.status !== 'PENDING_VERIFICATION') {
      throw new ApiError(409, 'ACCOUNT_ALREADY_VERIFIED', 'This account is already verified.');
    }

    const verificationType = previousChallenge.type;
    const target = verificationType.endsWith('EMAIL') ? previousChallenge.user.email : previousChallenge.user.phoneNormalized;
    if (!target) {
      throw new ApiError(422, 'VERIFICATION_TARGET_MISSING', 'Verification target is unavailable.');
    }

    const { challenge, developmentCode } = await createVerificationChallenge(
      previousChallenge.user,
      verificationType,
      target,
      { cooldownMs: verificationResendCooldownMs },
    );

    await this.audit(previousChallenge.user.id, 'PATIENT_VERIFICATION_RESENT', 'Patient verification code resent.', ip);

    return {
      state: 'VERIFICATION_REQUIRED',
      challengeId: challenge.id,
      ...(developmentCode ? { developmentCode } : {}),
    };
  }

  async resendByIdentity(body: { identity: string; password: string }, ip?: string) {
    const identity = body.identity.trim();
    const normalizedEmail = identity.includes('@') ? normalizeEmail(identity) : null;
    const normalizedPhone = normalizePhone(identity);

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: identity },
          ...(normalizedEmail ? [{ email: normalizedEmail }, { username: normalizedEmail }] : []),
          ...(normalizedPhone ? [{ phoneNormalized: normalizedPhone }] : []),
        ],
      },
    });

    if (!user) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    const passwordValid = await bcrypt.compare(body.password, user.passwordHash);
    if (!passwordValid) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    if (user.role !== 'PATIENT') {
      throw new ApiError(403, 'PATIENT_ACCOUNT_REQUIRED', 'A patient account is required.');
    }

    if (user.status !== 'PENDING_VERIFICATION') {
      throw new ApiError(409, 'ACCOUNT_NOT_PENDING_VERIFICATION', 'This account does not require verification.');
    }

    const googleIdentity = await this.prisma.userExternalIdentity.findFirst({
      where: { userId: user.id, provider: 'GOOGLE' },
      select: { id: true },
    });
    const verificationType = googleIdentity ? 'REGISTRATION_PHONE' : registrationPurpose();

    const target = verificationType.endsWith('EMAIL') ? user.email : user.phoneNormalized;
    if (!target) {
      throw new ApiError(422, 'VERIFICATION_TARGET_MISSING', 'Verification target is unavailable.');
    }

    const { challenge, developmentCode } = await createVerificationChallenge(user, verificationType, target, {
      cooldownMs: verificationResendCooldownMs,
    });

    await this.audit(user.id, 'PATIENT_VERIFICATION_RESENT', 'Patient requested a new account verification code.', ip);

    return {
      state: 'VERIFICATION_REQUIRED',
      challengeId: challenge.id,
      ...(developmentCode ? { developmentCode } : {}),
    };
  }

  async verifyContact(user: { id: string; av: number }, body: { challengeId: string; code: string; type: 'PHONE' | 'EMAIL' }) {
    await consumeVerificationChallenge({
      challengeId: body.challengeId,
      code: body.code,
      purpose: body.type,
      userId: user.id,
      authVersion: user.av,
      transition: (tx: any, challenge: any) =>
        tx.user.update({
          where: { id: challenge.userId },
          data: body.type === 'PHONE' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() },
          select: { id: true },
        }),
    });
    return { state: 'VERIFIED' };
  }

  async requestContactVerification(userId: string, type: 'PHONE' | 'EMAIL') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // Matches Express: a missing user row is an unhandled error (500), not a 404.
    const target = type === 'PHONE' ? user!.phoneNormalized : user!.email;
    if (!target) {
      throw new ApiError(422, 'VERIFICATION_TARGET_MISSING', `No ${type.toLowerCase()} is configured for this account.`);
    }

    const { challenge, developmentCode } = await createVerificationChallenge(user, type, target);
    return {
      state: 'VERIFICATION_REQUIRED',
      challengeId: challenge.id,
      ...(developmentCode ? { developmentCode } : {}),
    };
  }

  async recoverLink(userId: string, dateOfBirth: string, ip?: string) {
    // 1. Idempotent success if already linked.
    const existingPatient = await this.prisma.patient.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existingPatient) {
      return { state: 'LINKED', patientId: existingPatient.id, recovered: false };
    }

    // 2. Load the authenticated patient account.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, phoneNormalized: true, phoneVerifiedAt: true },
    });
    if (!user) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'User account not found.');
    }
    if (user.role !== 'PATIENT') {
      throw new ApiError(403, 'PATIENT_ACCOUNT_REQUIRED', 'A patient account is required.');
    }
    if (user.status !== 'ACTIVE') {
      throw new ApiError(403, 'ACCOUNT_NOT_ACTIVE', 'The patient account must be active before record recovery.');
    }

    // 3. Automatic linkage requires a VERIFIED phone identity.
    if (!user.phoneNormalized || !user.phoneVerifiedAt) {
      await this.audit(user.id, 'PATIENT_LINK_RECOVERY_REJECTED', 'Automatic patient linkage recovery requires a verified phone number.', ip);
      return { state: 'MANUAL_REVIEW_REQUIRED', reason: 'VERIFIED_PHONE_REQUIRED' };
    }

    // 4. Match using exact DOB + normalized verified phone.
    const matches = await matchingPatients(user.phoneNormalized, dateOfBirth, this.prisma);

    if (matches.length === 0) {
      await this.audit(user.id, 'PATIENT_LINK_RECOVERY_NO_MATCH', 'No patient record matched verified phone and supplied date of birth.', ip);
      return { state: 'MANUAL_REVIEW_REQUIRED', reason: 'NO_MATCH' };
    }

    if (matches.length > 1) {
      await this.audit(user.id, 'PATIENT_LINK_RECOVERY_AMBIGUOUS', 'Multiple patient records matched verified phone and supplied date of birth.', ip);
      return { state: 'AMBIGUOUS_MATCH', reason: 'MULTIPLE_MATCHES' };
    }

    const patient = matches[0];

    // 5. Never steal ownership from another patient account.
    if (patient.userId) {
      await this.audit(user.id, 'PATIENT_LINK_RECOVERY_CONFLICT', 'Matching patient record is already linked to another account.', ip);
      return { state: 'MANUAL_REVIEW_REQUIRED', reason: 'ALREADY_CLAIMED' };
    }

    // 6. Atomic ownership claim (updateMany + userId:null guards concurrent claims).
    const linked = await this.prisma.$transaction(async (tx: any) => {
      const result = await tx.patient.updateMany({
        where: { id: patient.id, userId: null },
        data: { userId: user.id },
      });
      if (result.count === 1) {
        await this.audit(user.id, 'PATIENT_LINK_RECOVERED', `Recovered legacy patient account linkage to patient record ${patient.id}.`, ip, tx);
      }
      return result;
    });

    if (linked.count !== 1) {
      await this.audit(user.id, 'PATIENT_LINK_RECOVERY_CONFLICT', 'Patient linkage changed concurrently before recovery completed.', ip);
      return { state: 'MANUAL_REVIEW_REQUIRED', reason: 'LINK_CONFLICT' };
    }

    return { state: 'LINKED', patientId: patient.id, recovered: true };
  }
}
