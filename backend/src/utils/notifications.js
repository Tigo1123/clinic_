import nodemailer from 'nodemailer';
import prisma from '../db.js';
import { logger } from './logger.js';
import { readSmtpConfig } from './smtpConfig.js';

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

/**
 * Sends a real or mock SMS.
 */
export async function sendSMS({ to, body, language = 'en' }) {
  if (process.env.NOTIFICATIONS_DISABLED === 'true') return false;
  logger.warn('sms.provider_unavailable');
  await prisma.notificationLog.create({ data: { recipientPhone: to, messageType: 'SMS', messageBody: 'SMS provider unavailable', language, status: 'FAILED', lastAttempt: new Date() } });
  return false;
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

  const smsTextEn = `Al-Shifa Clinic: Appointment request received for ${doctor?.fullNameEn || 'Doctor'} on ${appointmentDate} at ${appointmentTime}. Status: PENDING APPROVAL. Ticket #${id.substring(0, 8).toUpperCase()}`;
  const smsTextAr = `مركز الشفاء الطبي: تم استلام طلب موعدك مع ${doctor?.fullNameAr || 'الطبيب'} بتاريخ ${appointmentDate} الساعة ${appointmentTime}. الحالة: قيد المراجعة والتأكيد. رقم التذكرة #${id.substring(0, 8).toUpperCase()}`;

  const whatsAppLinkAr = getWhatsAppLink({ phone: patientPhone, message: smsTextAr });
  const whatsAppLinkEn = getWhatsAppLink({ phone: patientPhone, message: smsTextEn });

  if (patientPhone) {
    await sendSMS({ to: patientPhone, body: smsTextAr, language: 'ar' });
  }

  // If patient has an email (or mock recipient), send confirmation email
  const recipientEmail = patient?.email || null;
  if (recipientEmail) {
    const emailSubject = `Appointment Request Pending - Al-Shifa Medical Center`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1f2937;">
        <h2 style="color: #0d9488;">Al-Shifa Medical Center / مركز الشفاء الطبي</h2>
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

  return { smsTextAr, smsTextEn, whatsAppLinkAr, whatsAppLinkEn };
}

/**
 * Sends status update notification via SMS and Email.
 */
export async function sendStatusUpdateNotification(appointment, status) {
  const { patient, doctor, appointmentDate, appointmentTime, id } = appointment;
  const patientPhone = patient?.phone;

  let messageEn = '';
  let messageAr = '';

  switch (status) {
    case 'CONFIRMED':
      messageEn = `Al-Shifa Clinic: Your appointment with ${doctor?.fullNameEn} on ${appointmentDate} at ${appointmentTime} is CONFIRMED. Ticket #${id.substring(0, 8).toUpperCase()}`;
      messageAr = `مركز الشفاء الطبي: تم تأكيد موعدك بنجاح مع ${doctor?.fullNameAr} بتاريخ ${appointmentDate} الساعة ${appointmentTime}. رقم التذكرة #${id.substring(0, 8).toUpperCase()}`;
      break;
    case 'CHECKED_IN':
      messageEn = `Al-Shifa Clinic: You are checked in for your appointment with ${doctor?.fullNameEn}. Please wait in the lounge.`;
      messageAr = `مركز الشفاء الطبي: تم تسجيل دخولك لموعدك مع ${doctor?.fullNameAr}. يرجى الانتظار في صالة الانتظار.`;
      break;
    case 'IN_CONSULTATION':
      messageEn = `Al-Shifa Clinic: It's your turn! Please proceed to ${doctor?.fullNameEn}'s office.`;
      messageAr = `مركز الشفاء الطبي: حان دورك! يرجى التوجه لعيادة ${doctor?.fullNameAr}.`;
      break;
    case 'COMPLETED':
      messageEn = `Al-Shifa Clinic: Your visit with ${doctor?.fullNameEn} is complete. Thank you for visiting Al-Shifa Medical Center!`;
      messageAr = `مركز الشفاء الطبي: انتهت زيارتك مع ${doctor?.fullNameAr}. شكراً لزيارتك مركز الشفاء الطبي!`;
      break;
    case 'CANCELLED':
      messageEn = `Al-Shifa Clinic: Your appointment on ${appointmentDate} at ${appointmentTime} has been cancelled.`;
      messageAr = `مركز الشفاء الطبي: تم إلغاء موعدك بتاريخ ${appointmentDate} الساعة ${appointmentTime}.`;
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
