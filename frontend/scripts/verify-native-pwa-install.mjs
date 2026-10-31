// Run against a local production preview with an isolated desktop Chrome profile.
// The offer is native. DevTools tests actual installation and standalone launch;
// it bypasses the chooser/appinstalled path tested separately with UI fixtures.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5199';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const output = fileURLToPath(new URL('../../docs/pwa-install-evidence/', import.meta.url));
await mkdir(output, { recursive: true });
const profile = await mkdtemp('/tmp/shifa-native-install-');
const report = { generatedAt: new Date().toISOString(), origin, profile, syntheticInstallEvents: false, installationMethod: 'DevTools PWA.install in an isolated test profile', errors: [] };
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.QA_CHROME || '/opt/google/chrome/chrome', headless: false,
  viewport: { width: 1440, height: 1000 }, args: ['--no-sandbox'],
  env: { ...process.env, XDG_DATA_HOME: profile + '/data', XDG_CONFIG_HOME: profile + '/config', XDG_CACHE_HOME: profile + '/cache' }
});
report.browser = context.browser().version();
let cdp, installed = false;
try {
  await context.addInitScript(() => {
    window.__nativeOffers = [];
    window.__nativeInstallations = [];
    window.addEventListener('beforeinstallprompt', event => window.__nativeOffers.push({ trusted: event.isTrusted, platforms: event.platforms }));
    window.addEventListener('appinstalled', event => window.__nativeInstallations.push({ trusted: event.isTrusted }));
    localStorage.setItem('shifa_language', 'en');
    localStorage.setItem('alshifa_theme', 'light');
  });
  await context.route('**/api/**', route => route.fulfill({ json: { clinicTimeZone: 'Africa/Khartoum' } }));
  const page = context.pages()[0];
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(origin);
  await page.locator('.public-header').waitFor();
  // Real engagement is required before Chrome offers installation.
  await page.locator('.public-theme-toggle').click();
  await page.waitForFunction(() => window.__nativeOffers.length > 0, { timeout: 60000 });
  await page.locator('.pwa-install-button').waitFor();
  report.nativeOffer = await page.evaluate(() => window.__nativeOffers);
  assert.equal(report.nativeOffer[0].trusted, true);
  await page.screenshot({ path: path.join(output, 'native-chrome-install-offer.png') });
  cdp = await context.newCDPSession(page);
  report.installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(report.installability.installabilityErrors, []);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []);
  report.manifest = { url: manifest.url, errors: manifest.errors, icons: JSON.parse(manifest.data).icons };

  await cdp.send('PWA.install', { manifestId: origin + '/', installUrlOrBundleUrl: origin + '/' });
  installed = true;
  // PWA.install bypasses Chrome's chooser, and does not necessarily notify the
  // existing tab with appinstalled. Record this without inventing a native event.
  report.appinstalled = await page.evaluate(() => ({ events: window.__nativeInstallations }));
  report.appinstalled.methodLimitation = 'DevTools installation bypasses the chooser; appinstalled handling is covered by controlled UI/state tests.';
  report.osAppState = await cdp.send('PWA.getOsAppState', { manifestId: origin + '/' });
  await cdp.send('PWA.changeAppUserSettings', { manifestId: origin + '/', displayMode: 'standalone' });
  const launch = await cdp.send('PWA.launch', { manifestId: origin + '/' });
  let app;
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const candidate of context.pages().filter(candidate => candidate !== page)) {
      const session = await context.newCDPSession(candidate);
      const { targetInfo } = await session.send('Target.getTargetInfo');
      await session.detach();
      if (targetInfo.targetId === launch.targetId) app = candidate;
    }
    if (!app) {
      const candidates = context.pages().filter(candidate => candidate !== page && candidate.url() === origin + '/');
      if (candidates.length === 1) app = candidates[0];
    }
    if (app) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(app, 'Installed app window is exposed');
  await app.locator('.public-header').waitFor();
  report.standalone = await app.evaluate(() => ({ matches: matchMedia('(display-mode: standalone)').matches, buttonHidden: !document.querySelector('.pwa-install-button'), nativeOffers: window.__nativeOffers }));
  assert.equal(report.standalone.matches, true);
  assert.equal(report.standalone.buttonHidden, true);
  await app.screenshot({ path: path.join(output, 'native-chrome-installed-standalone.png') });
  await app.close();

  const tab = await context.newPage();
  await tab.goto(origin);
  await tab.locator('.public-header').waitFor();
  await tab.locator('.public-theme-toggle').click();
  // Wait past Chromium's engagement interval; already-installed tabs receive no offer.
  await tab.waitForTimeout(32000);
  report.alreadyInstalledTab = await tab.evaluate(() => ({ nativeOffers: window.__nativeOffers, buttonHidden: !document.querySelector('.pwa-install-button') }));
  assert.equal(report.alreadyInstalledTab.nativeOffers.length, 0);
  assert.equal(report.alreadyInstalledTab.buttonHidden, true);
} catch (error) {
  report.errors.push(error.stack || error.message);
  process.exitCode = 1;
} finally {
  if (installed) {
    await cdp.send('PWA.uninstall', { manifestId: origin + '/' })
      .then(() => { report.testInstallationRemoved = true; })
      .catch(error => { report.errors.push('Cleanup: ' + error.message); process.exitCode = 1; });
  }
  await context.close();
  await writeFile(path.join(output, 'native-browser-report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
