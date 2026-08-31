import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const frontendRuntime = [
  read('frontend/index.html'),
  ...['frontend/src/index.css', 'frontend/src/App.css', 'frontend/src/styles/medical.css', 'frontend/src/styles/tokens.css'].map(read)
].join('\n');
const lanFiles = [
  read('compose.lan.yml'), read('deploy/lan/env.example'),
  read('deploy/lan/nginx.conf'), read('deploy/lan/README.md')
].join('\n');

test('normal frontend page assets have no automatic public font dependency', () => {
  assert.doesNotMatch(frontendRuntime, /fonts\.googleapis\.com|fonts\.gstatic\.com/i);
  assert.doesNotMatch(frontendRuntime, /@import\s+url\(\s*['"]?https?:\/\//i);
  const indexCss = read('frontend/src/index.css');
  assert.match(indexCss, /--font-ar:\s*Tahoma, Arial, system-ui, sans-serif;/);
  assert.match(indexCss, /--font-en:\s*system-ui, -apple-system, BlinkMacSystemFont/);
});

test('disabled notification mode exits before SMTP and reports not delivered', () => {
  const notifications = read('backend/src/utils/notifications.js');
  const disabledGuard = notifications.indexOf("if (process.env.NOTIFICATIONS_DISABLED === 'true')");
  const disabledResult = notifications.indexOf('return null;', disabledGuard);
  const smtpRead = notifications.indexOf('const smtp = readSmtpConfig();', disabledGuard);
  const transportCreation = notifications.indexOf('const transporter = smtpTransport(smtp);', disabledGuard);
  assert.ok(disabledGuard >= 0);
  assert.ok(disabledResult > disabledGuard);
  assert.ok(smtpRead > disabledResult);
  assert.ok(transportCreation > disabledResult);
  assert.doesNotMatch(notifications.slice(disabledGuard, disabledResult), /messageId|SENT|sendMail/);
});

test('optional appointment communication does not claim email delivery or gate its result', () => {
  const notifications = read('backend/src/utils/notifications.js');
  const bookingFunction = notifications.match(/export async function sendBookingConfirmation[\s\S]*?(?=\/\*\*\n \* Sends status update)/)?.[0];
  assert.ok(bookingFunction);
  assert.match(bookingFunction, /await sendEmail\(/);
  assert.doesNotMatch(bookingFunction, /if \(!.*sendEmail|throw new .*EMAIL|emailSent|status:\s*['"]SENT/);
  assert.match(bookingFunction, /return \{ smsTextAr, smsTextEn, whatsAppLinkAr, whatsAppLinkEn \};/);
});

test('email-required security paths reject disabled or failed delivery', () => {
  const verification = read('backend/src/services/verification.js');
  const patientAuth = read('backend/src/routes/patientAuth.js');
  const patientProfile = read('backend/src/routes/patient.js');
  const records = read('backend/src/routes/records.js');
  const config = read('backend/src/config.js');

  assert.match(verification, /if \(!sent\) throw new ApiError\(503, 'VERIFICATION_DELIVERY_FAILED'/);
  assert.match(patientAuth, /if \(!sent\) \{[\s\S]*?verificationChallenge[\s\S]*?\.delete/);
  assert.match(patientProfile, /if \(!sent\) \{[\s\S]*?verificationChallenge[\s\S]*?\.delete/);
  assert.match(records, /if \(!delivery\) return sendError\(res, 503, 'EMAIL_DELIVERY_FAILED'/);
  assert.match(config, /NOTIFICATIONS_DISABLED cannot be true when email verification is enabled/);
  assert.doesNotMatch(verification, /emailVerifiedAt:[\s\S]*?sendEmail/);
});

test('offline behavior is explicitly opt-in and LAN configuration disables email verification', () => {
  const notifications = read('backend/src/utils/notifications.js');
  const backendEnvironment = read('backend/.env.example');
  const lanEnvironment = read('deploy/lan/env.example');
  assert.match(notifications, /process\.env\.NOTIFICATIONS_DISABLED === 'true'/);
  assert.match(backendEnvironment, /^NOTIFICATIONS_DISABLED=true$/m);
  assert.match(lanEnvironment, /^NOTIFICATIONS_DISABLED=true$/m);
  assert.match(lanEnvironment, /^VERIFICATION_PROVIDER=disabled$/m);
  assert.doesNotMatch(lanEnvironment, /^VERIFICATION_PROVIDER=email$/m);
});

test('LAN files remain Render-independent and document WhatsApp as optional WAN-only', () => {
  assert.doesNotMatch(lanFiles, /(?:^|[./-])render\.com\b|onrender\.com\b/i);
  assert.match(read('deploy/lan/README.md'), /optional WhatsApp `wa\.me` actions/);
  assert.match(read('deploy/lan/README.md'), /user clicks them/);
  assert.match(read('frontend/src/features/reception/clinicData.js'), /return `https:\/\/wa\.me\//);
});
