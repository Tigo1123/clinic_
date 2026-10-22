import test from 'node:test';
import assert from 'node:assert/strict';
import { patientFirstName, patientGreeting } from '../src/utils/patientGreeting.js';

for (const [language, profile, expected] of [
  ['ar', { firstNameAr: 'تاج', firstNameEn: 'Tag', fullNameAr: 'تاج محمد أحمد' }, 'مساء الخير، تاج'],
  ['en', { firstNameAr: 'تاج', firstNameEn: 'Tag', fullNameEn: 'Tag Mohamed Ahmed' }, 'Good evening, Tag'],
  ['ar-SD', { fullNameAr: '  تاج   محمد أحمد ', fullNameEn: 'Tag Mohamed' }, 'مساء الخير، تاج'],
  ['en-GB', { fullNameEn: '\u200f  Tag\tMohamed Ahmed\u200e' }, 'Good evening, Tag'],
  ['ar', { fullNameEn: 'Tag Mohamed Ahmed' }, 'مساء الخير، Tag'],
  ['en', { firstNameEn: ' ', fullNameAr: 'تاج محمد' }, 'Good evening, تاج'],
  ['en', undefined, 'Good evening'],
  ['ar', { firstNameAr: '\u200b ', fullNameAr: null }, 'مساء الخير'],
]) test(`first-name-only greeting: ${language} ${expected}`, () => assert.equal(patientGreeting(profile, language, 18), expected));

test('morning greetings use a localized separator and never append missing names', () => {
  assert.equal(patientGreeting({ firstNameEn: 'Tag', fullNameEn: 'Tag Mohamed' }, 'en', 8), 'Good morning, Tag');
  assert.equal(patientGreeting({ firstNameAr: 'تاج' }, 'ar', 8), 'صباح الخير، تاج');
  assert.equal(patientGreeting({}, 'en', 8), 'Good morning');
  assert.equal(patientGreeting({}, 'ar', 8), 'صباح الخير');
});
test('first name cannot leak subsequent tokens, mutate the profile, or stringify invalid values', () => {
  const profile = Object.freeze({ firstNameEn: 'Tag Mohamed', fullNameEn: 'Tag Mohamed Ahmed' });
  assert.equal(patientFirstName(profile, 'en'), 'Tag');
  assert.equal(profile.fullNameEn, 'Tag Mohamed Ahmed');
  assert.equal(patientFirstName({ firstNameEn: 123, fullNameEn: {} }, 'en'), '');
});
