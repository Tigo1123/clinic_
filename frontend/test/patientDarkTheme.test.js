import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const patientCss = readFileSync(new URL('../src/layouts/patient.css', import.meta.url), 'utf8');
const uiCss = readFileSync(new URL('../src/components/ui/ui.css', import.meta.url), 'utf8');
const medicalCss = readFileSync(new URL('../src/styles/medical.css', import.meta.url), 'utf8');

function declarations(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{3,8})\s*;/gi)]
    .map(([, name, value]) => [name, value]));
}

function luminance(hex) {
  const raw = hex.slice(1);
  const rgb = raw.length === 3
    ? [...raw].map((channel) => Number.parseInt(channel + channel, 16))
    : [0, 2, 4].map((index) => Number.parseInt(raw.slice(index, index + 2), 16));
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const lightBlock = tokens.match(/:root\s*\{([^}]+)\}/)?.[1];
const darkBlock = tokens.match(/\[data-theme=['"]dark['"]\]\s*\{([^}]+)\}/)?.[1];
assert.ok(lightBlock && darkBlock, 'light and dark semantic token sets exist');
assert.match(lightBlock, /--gradient-primary:/);
assert.doesNotMatch(darkBlock, /--gradient-(?:primary|sky):/);
const light = declarations(lightBlock);
const dark = { ...light, ...declarations(darkBlock) };

test('patient theme semantic text and control tokens meet contrast thresholds', () => {
  assert.ok(contrast(dark['color-text'], dark['color-surface']) >= 4.5);
  assert.ok(contrast(dark['color-text-secondary'], dark['color-surface']) >= 4.5);
  assert.ok(contrast(dark['color-primary-strong'], dark['color-surface']) >= 4.5);
  assert.ok(contrast(dark['color-text-secondary'], dark['color-surface-muted']) >= 4.5);
  assert.ok(contrast('#ffffff', dark['color-primary-action']) >= 4.5);
  assert.ok(contrast(dark['color-control-border'], dark['color-surface']) >= 3);
  assert.ok(contrast(dark['color-border'], dark['color-surface']) >= 3);
  assert.ok(contrast(dark['color-on-danger'], dark['color-danger']) >= 4.5);
  assert.ok(contrast(light['color-control-border'], light['color-surface']) >= 3);
  assert.ok(contrast(light['color-on-danger'], light['color-danger']) >= 4.5);
  assert.ok(contrast('#ffffff', light['color-primary-action']) >= 4.5);
  assert.ok(contrast(light['color-success'], light['color-success-soft']) >= 4.5);
  assert.ok(contrast(light['color-warning'], light['color-warning-soft']) >= 4.5);
  for (const [status, soft] of [
    ['color-success', 'color-success-soft'],
    ['color-warning', 'color-warning-soft'],
    ['color-danger', 'color-danger-soft'],
  ]) {
    assert.ok(contrast(dark[status], dark[soft]) >= 4.5, `${status} remains readable in dark mode`);
  }
});

test('patient surfaces and interactive states use semantic theme tokens', () => {
  assert.match(patientCss, /\.patient-card\{[^}]*background:var\(--color-surface\)/);
  assert.match(patientCss, /\.patient-field input,\.patient-field select,\.patient-card form>input\{[^}]*background:var\(--color-surface\)[^}]*color:var\(--color-text\)/);
  assert.match(patientCss, /\.patient-field input:focus,\.patient-field select:focus,\.patient-card form>input:focus\{[^}]*outline:3px solid var\(--color-primary-strong\)/);
  assert.match(patientCss, /\.patient-field input\[aria-invalid="true"\]/);
  assert.match(patientCss, /\.patient-field input:disabled,\.patient-field select:disabled,\.patient-card form>input:disabled\{[^}]*var\(--color-surface-muted\)/);
  assert.match(patientCss, /\.patient-field input::placeholder,\.patient-card form>input::placeholder\{color:var\(--color-text-secondary\);opacity:1\}/);
  assert.match(patientCss, /\.patient-button\{[^}]*background:var\(--color-primary-action\)/);
  assert.match(patientCss, /\.patient-app\{--patient-hero-gradient:/);
  assert.match(patientCss, /\[data-theme='dark'\] \.patient-app\{--patient-hero-gradient:/);
  assert.match(patientCss, /\.patient-hero--care\{background:var\(--patient-hero-gradient\)\}/);
  assert.match(patientCss, /\.patient-alert\.error\{background:var\(--color-danger-soft\);color:var\(--color-danger\)\}/);
  assert.match(uiCss, /\.ui-dialog\{[^}]*background:var\(--color-surface\)/);
  assert.match(uiCss, /\.empty-state,\.error-state\{[^}]*border:1px dashed var\(--color-control-border\)/);
  assert.match(uiCss, /\.ui-button--danger\{background:var\(--color-danger\);color:var\(--color-on-danger,#fff\)\}/);
  assert.match(uiCss, /\.ui-button:disabled\{[^}]*border-color:var\(--color-control-border\)/);
  assert.match(medicalCss, /\.btn-danger \{ background: var\(--color-danger\); color: var\(--color-on-danger, #fff\); \}/);
  assert.match(uiCss, /\.skeleton-line\{[^}]*var\(--color-skeleton-start\)/);
  assert.match(medicalCss, /:focus-visible\s*\{\s*outline:\s*3px solid var\(--color-primary-strong\)/);
  assert.match(medicalCss, /\.patient-lab-status--normal\s*\{\s*background:\s*var\(--color-success-soft\);\s*color:\s*var\(--color-success\)/);
  assert.match(medicalCss, /\.patient-lab-status--abnormal\s*\{\s*background:\s*var\(--color-danger-soft\);\s*color:\s*var\(--color-danger\)/);
  assert.doesNotMatch(medicalCss, /\.patient-lab-(?:result__eyebrow|category|disclaimer)[^{]*\{[^}]*opacity:/);
});
