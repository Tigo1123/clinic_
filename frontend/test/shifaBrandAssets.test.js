import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shifaLogoAlternative, shifaLogoAsset } from '../src/components/brand/shifaLogoAssets.js';

test('shared logo source follows current language and theme and uses the compact mark', () => {
  assert.equal(shifaLogoAsset({ language: 'ar', theme: 'light' }), '/brand/shifa-logo-ar-light.png');
  assert.equal(shifaLogoAsset({ language: 'ar', theme: 'dark' }), '/brand/shifa-logo-ar-dark.png');
  assert.equal(shifaLogoAsset({ language: 'en', theme: 'light' }), '/brand/shifa-logo-en-light.png');
  assert.equal(shifaLogoAsset({ language: 'en', theme: 'dark' }), '/brand/shifa-logo-en-dark.png');
  assert.equal(shifaLogoAsset({ language: 'ar', theme: 'dark', compact: true }), '/brand/shifa-mark-light.png');
  assert.equal(shifaLogoAlternative('ar'), 'شفاء — نظام إدارة المنشآت الصحية');
  assert.equal(shifaLogoAlternative('en'), 'Shifa Clinic Management System');
});

test('PWA manifest has the requested icons and approved theme/background colors', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'Shifa Clinic Management System');
  assert.equal(manifest.short_name, 'Shifa');
  assert.equal(manifest.theme_color, '#0F766E');
  assert.equal(manifest.background_color, '#F8FAFC');
  assert.deepEqual(manifest.icons.map(({ src, sizes }) => ({ src, sizes })), [
    { src: '/brand/pwa-192x192.png', sizes: '192x192' },
    { src: '/brand/pwa-512x512.png', sizes: '512x512' }
  ]);
});

test('favicon and Apple touch icon reference only supplied brand assets', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /sizes="16x16" href="\/brand\/shifa-icon-16\.png"/);
  assert.match(html, /sizes="32x32" href="\/brand\/shifa-icon-32\.png"/);
  assert.match(html, /apple-touch-icon" sizes="180x180" href="\/brand\/shifa-icon-180\.png"/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.doesNotMatch(html, /favicon\.svg/);
});

test('all required approved raster assets are present and correctly sized', async () => {
  const expected = new Map([
    ['pwa-192x192.png', 192], ['pwa-512x512.png', 512], ['shifa-icon-180.png', 180],
    ['shifa-icon-64.png', 64], ['shifa-icon-32.png', 32], ['shifa-icon-16.png', 16],
    ['shifa-logo-en-light.png', [610, 240]], ['shifa-logo-en-dark.png', [270, 110]],
    ['shifa-logo-ar-light.png', [445, 240]], ['shifa-logo-ar-dark.png', [270, 105]],
    ['shifa-mark-light.png', [180, 210]]
  ]);
  for (const [name, size] of expected) {
    const bytes = await readFile(new URL(`../public/brand/${name}`, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} must be PNG`);
    const [width, height] = Array.isArray(size) ? size : [size, size];
    assert.equal(bytes.readUInt32BE(16), width, `${name} width`);
    assert.equal(bytes.readUInt32BE(20), height, `${name} height`);
  }
});
