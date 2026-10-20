import nodemailer from 'nodemailer';
import prisma from '../db.js';
import { logger } from './logger.js';
import { readSmtpConfig } from './smtpConfig.js';
import { maskPhone } from './patientIdentity.js';
import { escapeHtmlText, getFacilityBranding } from './facilityBranding.js';

export function smtpTransport(config = readSmtpConfig()) {
  if (!config) return null;
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: config.connectionTimeout
  });
}

/**
 * Sends a real or mock email.
 */
export async function sendEmail({ to, subject, text, html }) {
  if (process.env.NOTIFICATIONS_DISABLED === 'true') {
    logger.info('email.disabled', { delivered: false });
    return null;
  }
  const smtp = readSmtpConfig();
  const transporter = smtpTransport(smtp);
  if (!transporter) {
    logger.warn('email.not_configured');
    return null;
  }
  const from = {
    name: smtp.fromName,
    address: smtp.fromEmail
  };

  try {
    // If running in development and Ethereal fallback is used, it logs a link
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html
    });

    logger.info('email.sent', { messageId: info.messageId });
    
    // Log to NotificationLog model in DB
    await prisma.notificationLog.create({
      data: {
        recipientPhone: to, // Using email in phone field as general recipient string
        messageType: 'EMAIL',
        messageBody: `Subject: ${subject}`,
        language: 'en',
        status: 'SENT'
      }
    });

    return info;
  } catch (error) {
    logger.error('email.failed', { error });
    
    // Log failed delivery attempt
    await prisma.notificationLog.create({
      data: {
        recipientPhone: to,
        messageType: 'EMAIL',
        messageBody: `FAILED | Subject: ${subject}`,
        language: 'en',
        status: 'FAILED'
      }
    });
    
    return null;
  }
}

async function recordSmsAttempt(log, { to, language, status }) {
  try {
    await log({
      data: {
        recipientPhone: maskPhone(to),
        messageType: 'SMS',
        messageBody: 'Appointment notification',
        language,
        status,
        lastAttempt: new Date()
      }
    });
  } catch {
    // SMS logging is best effort after an appointment has committed.
    logger.warn('sms.notification_log_failed');
  }
}

/** Provider-neutral SMS seam. No transport is configured by the application. */
export async function sendSMS({ to, body, language = 'en' }, { env = process.env, transport = null, simulated = false, log = (args) => prisma.notificationLog.create(args) } = {}) {
  if (env.NOTIFICATIONS_DISABLED === 'true') return false;
  const provider = env.SMS_PROVIDER || 'disabled';
  const developmentEnvironment = ['development', 'test'].includes(env.NODE_ENV);
  if (provider === 'disabled') {
    logger.warn('sms.provider_unavailable');
    await recordSmsAttempt(log, { to, language, status: 'FAILED' });
    return false;
  }
  if (provider === 'development') {
    if (!developmentEnvironment) {
      logger.warn('sms.provider_unavailable');
      await recordSmsAttempt(log, { to, language, status: 'FAILED' });
      return false;
    }
    logger.info('sms.simulated', { sent: false, delivered: false });
    await recordSmsAttempt(log, { to, language, status: 'SIMULATED' });
    return false;
  }
  if (provider !== 'transport' || typeof transport !== 'function' || (simulated && !developmentEnvironment)) {
    logger.warn('sms.provider_unavailable');
    await recordSmsAttempt(log, { to, language, status: 'FAILED' });
    return false;
  }
  try {
    const result = await transport({ to, body, language });
    const validAcceptance = result !== null
      && typeof result === 'object'
      && !Array.isArray(result)
      && (Object.getPrototypeOf(result) === Object.prototype || Object.getPrototypeOf(result) === null)
      && result.accepted === true
      && Object.keys(result).length === 1;
    if (!validAcceptance) {
      logger.warn('sms.delivery_not_accepted');
      await recordSmsAttempt(log, { to, language, status: 'FAILED' });
      return false;
    }
    if (simulated) {
      await recordSmsAttempt(log, { to, language, status: 'SIMULATED' });
      logger.info('sms.simulated', { accepted: false, delivered: false });
      return false;
    }
    await recordSmsAttempt(log, { to, language, status: 'ACCEPTED' });
    logger.info('sms.accepted', { delivered: false });
    return true;
  } catch {
    logger.warn('sms.delivery_failed');
    await recordSmsAttempt(log, { to, language, status: 'FAILED' });
    return false;
  }
}

/**
 * Utility to generate direct WhatsApp click-to-chat URL for Sudanese numbers & international formats.
 */
export function getWhatsAppLink({ phone, message }) {
  if (!phone) return '';
  // Clean phone number: remove non-digits
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '249' + cleaned.substring(1); // Default to Sudan country code 249 if starting with 0
  } else if (!cleaned.startsWith('249') && cleaned.length === 9) {
    cleaned = '249' + cleaned;
  }
  const encodedText = encodeURIComponent(message || '');
  return `https://wa.me/${cleaned}?text=${encodedText}`;
}

/**
 * Sends booking confirmation via SMS and Email, and returns WhatsApp links.
 */
export async function sendBookingConfirmation(appointment) {
  const { patient, doctor, appointmentDate, appointmentTime, id } = appointment;
  const patientPhone = patient?.phone;

  const branding = getFacilityBranding();
  const smsTextEn = `${branding.displayNameEn}: Appointment request received for ${doctor?.fullNameEn || 'Doctor'} on ${appointmentDate} at ${appointmentTime}. Status: PENDING APPROVAL. Ticket #${id.substring(0, 8).toUpperCase()}`;
  const smsTextAr = `${branding.displayNameAr}: تم استلام طلب موعدك مع ${doctor?.fullNameAr || 'الطبيب'} بتاريخ ${appointmentDate} الساعة ${appointmentTime}. الحالة: قيد المراجعة والتأكيد. رقم التذكرة #${id.substring(0, 8).toUpperCase()}`;

  const whatsAppLinkAr = getWhatsAppLink({ phone: patientPhone, message: smsTextAr });
  const whatsAppLinkEn = getWhatsAppLink({ phone: patientPhone, message: smsTextEn });

  if (patientPhone) {
    await sendSMS({ to: patientPhone, body: smsTextAr, language: 'ar' });
  }

  // Patient email belongs to its optional linked account. Resolve it privately
  // instead of adding User fields to appointment/API projections.
  if (process.env.NOTIFICATIONS_DISABLED !== 'true') {
    try {
      const recipient = await prisma.patient.findUnique({
        where: { id: appointment.patientId },
        select: { user: { select: { email: true } } }
      });
      const recipientEmail = recipient?.user?.email;
      if (recipientEmail) {
        const emailSubject = `Appointment Request Pending - ${branding.displayNameEn}`;
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #1f2937;">
            <h2 style="color: #0d9488;">${escapeHtmlText(branding.displayNameEn)} / ${escapeHtmlText(branding.displayNameAr)}</h2>
            <p>Dear <strong>${patient?.fullNameEn || patient?.fullNameAr}</strong>,</p>
            <p>Your appointment request is currently <strong>PENDING APPROVAL</strong> by our reception team.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
              <tr><td><strong>Doctor:</strong></td><td>${doctor?.fullNameEn} (${doctor?.specialtyEn})</td></tr>
              <tr><td><strong>Date:</strong></td><td>${appointmentDate}</td></tr>
              <tr><td><strong>Time:</strong></td><td>${appointmentTime}</td></tr>
              <tr><td><strong>Ticket Number:</strong></td><td>#${id.substring(0, 8).toUpperCase()}</td></tr>
            </table>
            <p>We will send you a WhatsApp message as soon as your booking is confirmed.</p>
          </div>
        `;
        await sendEmail({ to: recipientEmail, subject: emailSubject, text: smsTextEn, html: emailHtml });
      }
    } catch {
      // Booking is already committed. Lookup, configuration, delivery, or log
      // failures must not turn it into a failed booking response.
      logger.warn('appointment.confirmation_email_failed');
    }
  }

  return { smsTextAr, smsTextEn, whatsAppLinkAr, whatsAppLinkEn };
}

/**
 * Sends status update notification via SMS and Email.
 */
export async function sendStatusUpdateNotification(appointment, status) {
  const { patient, doctor, appointmentDate, appointmentTime, id } = appointment;
  const patientPhone = patient?.phone;
  const branding = getFacilityBranding();

  let messageEn = '';
  let messageAr = '';

  switch (status) {
    case 'CONFIRMED':
      messageEn = `${branding.displayNameEn}: Your appointment with ${doctor?.fullNameEn} on ${appointmentDate} at ${appointmentTime} is CONFIRMED. Ticket #${id.substring(0, 8).toUpperCase()}`;
      messageAr = `${branding.displayNameAr}: تم تأكيد موعدك بنجاح مع ${doctor?.fullNameAr} بتاريخ ${appointmentDate} الساعة ${appointmentTime}. رقم التذكرة #${id.substring(0, 8).toUpperCase()}`;
      break;
    case 'CHECKED_IN':
      messageEn = `${branding.displayNameEn}: You are checked in for your appointment with ${doctor?.fullNameEn}. Please wait in the lounge.`;
      messageAr = `${branding.displayNameAr}: تم تسجيل دخولك لموعدك مع ${doctor?.fullNameAr}. يرجى الانتظار في صالة الانتظار.`;
      break;
    case 'IN_CONSULTATION':
      messageEn = `${branding.displayNameEn}: It's your turn! Please proceed to ${doctor?.fullNameEn}'s office.`;
      messageAr = `${branding.displayNameAr}: حان دورك! يرجى التوجه لعيادة ${doctor?.fullNameAr}.`;
      break;
    case 'COMPLETED':
      messageEn = `${branding.displayNameEn}: Your visit with ${doctor?.fullNameEn} is complete. Thank you for visiting ${branding.displayNameEn}!`;
      messageAr = `${branding.displayNameAr}: انتهت زيارتك مع ${doctor?.fullNameAr}. شكراً لزيارتك ${branding.displayNameAr}!`;
      break;
    case 'CANCELLED':
      messageEn = `${branding.displayNameEn}: Your appointment on ${appointmentDate} at ${appointmentTime} has been cancelled.`;
      messageAr = `${branding.displayNameAr}: تم إلغاء موعدك بتاريخ ${appointmentDate} الساعة ${appointmentTime}.`;
      break;
    default:
      return null;
  }

  if (patientPhone) {
    await sendSMS({ to: patientPhone, body: messageAr, language: 'ar' });
  }

  const whatsAppLinkAr = getWhatsAppLink({ phone: patientPhone, message: messageAr });
  const whatsAppLinkEn = getWhatsAppLink({ phone: patientPhone, message: messageEn });

  return { messageAr, messageEn, whatsAppLinkAr, whatsAppLinkEn };
}
