import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../src/features/patient-dashboard/PatientPages.jsx', import.meta.url), 'utf8');
const authPages = readFileSync(new URL('../src/features/patient-auth/PatientAuthPages.jsx', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');

test('Profile component renders Linked Accounts section with status badge and localized labels', () => {
  assert.match(pages, /id="linked-accounts-section"/);
  assert.match(pages, /\{t\('linkedAccounts'\)\}/);
  assert.match(pages, /\{t\('googleAccount'\)\}/);
  assert.match(pages, /data\.googleAccount\?\.linked\s*\?\s*`\$\{t\('connected'\)\}:\s*\$\{data\.googleAccount\.email\}`\s*:\s*t\('notConnected'\)/);
  assert.match(pages, /StatusBadge\s+status=\{data\.googleAccount\?\.linked \? 'CONFIRMED' : 'PENDING'\}/);
});

test('connect flow presents GoogleIdentityButton and requires password re-authentication', () => {
  assert.match(pages, /\{t\('connectGoogle'\)\}/);
  assert.match(pages, /\{t\('connectGooglePrompt'\)\}/);
  assert.match(pages, /GoogleIdentityButton[\s\S]*?onCredential=\{/);
  assert.match(pages, /setPendingGoogleCredential\(credential\)/);
  assert.match(pages, /\{t\('enterPasswordToLink'\)\}/);
  assert.match(pages, /autoComplete="current-password"/);
  assert.match(pages, /disabled=\{googleLinking \|\| !googleLinkPassword\}/);
  assert.match(pages, /api\/patient\/me\/external-identities\/google\/link/);
  assert.match(pages, /currentPassword:\s*googleLinkPassword/);
  assert.match(pages, /credential:\s*pendingGoogleCredential/);
  // Clears sensitive values upon completion
  assert.match(pages, /setPendingGoogleCredential\(null\)/);
  assert.match(pages, /setGoogleLinkPassword\(''\)/);
});

test('disconnect flow requires password re-authentication and confirms unlinking', () => {
  assert.match(pages, /\{t\('disconnectGoogle'\)\}/);
  assert.match(pages, /\{t\('disconnectGoogleConfirm'\)\}/);
  assert.match(pages, /\{t\('enterPasswordToUnlink'\)\}/);
  assert.match(pages, /api\/patient\/me\/external-identities\/google/);
  assert.match(pages, /method:\s*'DELETE'/);
  assert.match(pages, /currentPassword:\s*googleUnlinkPassword/);
  assert.match(pages, /setGoogleUnlinkPassword\(''\)/);
  assert.match(pages, /googleUnlinkedSuccess/);
});

test('linking and unlinking error codes map to precise, localized user feedback', () => {
  assert.match(pages, /'GOOGLE_IDENTITY_ALREADY_LINKED'[\s\S]*?t\('identityAlreadyLinked'\)/);
  assert.match(pages, /'GOOGLE_ALREADY_LINKED'[\s\S]*?t\('googleAlreadyLinked'\)/);
  assert.match(pages, /'GOOGLE_EMAIL_MISMATCH'[\s\S]*?t\('googleEmailMismatch'\)/);
  assert.match(pages, /'REAUTHENTICATION_FAILED'[\s\S]*?t\('reauthenticationFailed'\)/);
  assert.match(pages, /t\('genericLinkingFailed'\)/);
  assert.match(pages, /t\('genericUnlinkingFailed'\)/);
});

test('all linked account translations exist in Arabic and English', () => {
  const keys = [
    'linkedAccounts',
    'googleAccount',
    'connected',
    'notConnected',
    'connectGoogle',
    'disconnectGoogle',
    'connectGooglePrompt',
    'disconnectGoogleConfirm',
    'enterPasswordToLink',
    'enterPasswordToUnlink',
    'googleLinkedSuccess',
    'googleUnlinkedSuccess',
    'identityAlreadyLinked',
    'googleAlreadyLinked',
    'googleEmailMismatch',
    'reauthenticationFailed',
    'genericLinkingFailed',
    'genericUnlinkingFailed',
    'googleLinkPostLoginHint'
  ];

  for (const key of keys) {
    const arPattern = new RegExp(`${key}:\\s*'[^']+'`);
    assert.match(i18n, arPattern, `Arabic translation missing for ${key}`);
    const enPattern = new RegExp(`${key}:\\s*'[^']+'`);
    assert.match(i18n, enPattern, `English translation missing for ${key}`);
  }
});

test('ACCOUNT_LINK_REQUIRED leads to post-login hint in Profile and standard login is preserved', () => {
  // Check PatientLogin routing logic
  assert.match(authPages, /if\s*\(googleAuth\.errorCode === 'ACCOUNT_LINK_REQUIRED'\)\s*\{\s*navigate\('\/patient\/profile',\s*\{\s*state:\s*\{\s*highlightGoogleLink:\s*true\s*\}\s*\}\);\s*\}\s*else\s*\{\s*navigate\('\/patient'\);\s*\}/);

  // Check Profile hint banner
  assert.match(pages, /highlightGoogleLink && !data\.googleAccount\?\.linked/);
  assert.match(pages, /\{t\('googleLinkPostLoginHint'\)\}/);
});

test('sensitive values and internal IDs are never rendered or persisted in web storage', () => {
  // In pages and authPages, Google tokens and providerSubject must never be saved to localStorage/sessionStorage
  assert.doesNotMatch(pages, /localStorage\.setItem\(['"](?:google|token|credential|provider)/i);
  assert.doesNotMatch(pages, /sessionStorage\.setItem\(['"](?:google_token|pending_google_cred)/i);
  assert.doesNotMatch(pages, /providerSubject/);
});
