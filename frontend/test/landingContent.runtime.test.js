import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { landingCopy } from '../src/features/public/landingCopy.js';

const photoFile = new URL(`.landing-photo-${process.pid}.mjs`, import.meta.url);
const photoSource = await readFile(new URL('../src/features/public/components/LandingPhoto.jsx', import.meta.url), 'utf8');
await writeFile(photoFile, (await transformWithOxc(photoSource, 'LandingPhoto.jsx', { jsx: { runtime: 'automatic' } })).code);

async function loadComponent(name, sourcePath) {
  const source = (await readFile(new URL(sourcePath, import.meta.url), 'utf8'))
    .replace(/import LandingPhoto from [^;]+;/, `import LandingPhoto from '${photoFile.href}';`)
    .replace(/import ShifaLogo from [^;]+;/, 'const ShifaLogo = () => <img src="/brand/shifa-logo-en-light.png" alt="Shifa" />;')
    .replace(/import (\w+Photo) from '[^']+\.webp';/g, 'const $1 = "/$1.webp";');
  const file = new URL(`.landing-content-${name}-${process.pid}.mjs`, import.meta.url);
  await writeFile(file, (await transformWithOxc(source, `${name}.jsx`, { jsx: { runtime: 'automatic' } })).code);
  try { return await import(file.href); } finally { await unlink(file); }
}
const { default: Hero } = await loadComponent('hero', '../src/features/public/components/LandingHero.jsx');
const Sections = await loadComponent('sections', '../src/features/public/components/LandingSections.jsx');
await unlink(photoFile);

for (const language of ['en', 'ar']) test(`landing content meets the patient, module, photo and navigation contract (${language})`, () => {
  const copy = landingCopy[language];
  assert.deepEqual(copy.modules.map(m => m.id).sort(), ['appointments', 'billing', 'doctor', 'laboratory', 'pharmacy', 'reception', 'records']);
  const markup = renderToStaticMarkup(h(MemoryRouter, null, h('main', null,
    h(Hero, { copy }), h(Sections.SystemOverview, { copy }), h(Sections.AboutSection, { copy }), h(Sections.HowItWorksSection, { copy }),
    h(Sections.FeatureSection, { copy }), h(Sections.JourneySection, { copy }), h(Sections.BenefitsSection, { copy }), h(Sections.FinalCTA, { copy }))));
  const dom = new JSDOM(markup), document = dom.window.document;
  try {
    assert.equal(document.querySelectorAll('h1').length, 1);
    assert.equal(document.querySelectorAll('.public-feature').length, 7);
    assert.equal(document.querySelectorAll('.public-how__steps > li').length, 3);
    assert.equal(document.querySelectorAll('.public-journey__track > li').length, 6);
    assert.equal(document.querySelectorAll('.public-benefit').length, 4);
    assert.equal(document.querySelectorAll('.public-photo img').length, 5, 'Five purposeful photographs support the care story');
    assert.ok(document.querySelector('#about h2'));
    assert.ok(document.querySelector('#why-shifa h2'));
    assert.equal(document.querySelectorAll('#about .public-about__values li').length, 3);
    assert.equal(new Set([...document.querySelectorAll('[id]')].map(e => e.id)).size, document.querySelectorAll('[id]').length);
    for (const image of document.querySelectorAll('section:not(.public-hero) .public-photo img')) assert.equal(image.getAttribute('loading'), 'lazy');
    const hero = document.querySelector('.public-hero img');
    assert.equal(hero.getAttribute('loading'), 'eager'); assert.equal(hero.getAttribute('fetchPriority'), 'high');
    assert.equal(document.querySelector('.public-benefits img').getAttribute('loading'), 'lazy');
    for (const img of document.querySelectorAll('.public-photo img')) {
      assert.ok(img.getAttribute('srcset')); assert.ok(img.getAttribute('sizes')); assert.equal(img.getAttribute('decoding'), 'async');
      assert.ok(img.alt.trim()); assert.ok(Number(img.width) > 0 && Number(img.height) > 0);
    }
    for (const region of document.querySelectorAll('section[aria-labelledby]')) assert.ok(document.getElementById(region.getAttribute('aria-labelledby')));
    assert.equal(document.querySelector('.public-hero__actions a').getAttribute('href'), '/register');
    assert.equal(document.querySelector('.public-hero__actions a:last-child').getAttribute('href'), '/patient-login');
    assert.equal(document.querySelector('.public-how__intro a').getAttribute('href'), '#features');
    assert.equal(copy.journey[3].title, language === 'en' ? 'Arrange payment' : 'نظّم الدفع', 'Paid service workflow remains in the correct order');
    assert.equal(copy.journey[5].title, language === 'en' ? 'Follow your care' : 'تابع رعايتك');
  } finally { dom.window.close(); }
});
