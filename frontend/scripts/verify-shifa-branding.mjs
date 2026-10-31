// Run against a production preview. Dependencies may be installed outside the repo:
// QA_PLAYWRIGHT_MODULE=/tmp/shifa-brand-qa/node_modules/playwright/index.mjs
// QA_AXE_PATH=/tmp/shifa-brand-qa/node_modules/axe-core/axe.min.js
// PLAYWRIGHT_BROWSERS_PATH=/tmp/shifa-brand-qa/browsers
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.QA_OUTPUT || path.resolve(root, '../docs/shifa-branding-evidence');
const origin = process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5196';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Use a local preview only');
const playwright = await import(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const axe = await readFile(process.env.QA_AXE_PATH || createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const engines = (process.env.QA_BROWSERS || 'chromium,firefox,webkit').split(',');
const loginScenarios = ['staff-login', 'patient-login', 'patient-login-via-staff'];
const scenarios = ['public', ...loginScenarios, 'forgot-password', 'reset-password', 'registration', 'staff-mfa', 'staff-recovery', 'staff-enrollment', 'patient-verification', 'admin', 'patient-layout', 'staff-password-required'];
const selected = process.env.QA_SCENARIOS?.split(',') || scenarios;
const sizes = [{ name: 'mobile', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 1000 }];
const report = { generatedAt: new Date().toISOString(), origin, api: 'Controlled synthetic API and Google button fixtures; no real account or production data. Authentication, MFA transport and Google OAuth are not end-to-end tested.', assets: [], browsers: [], matrix: [], reflow: [], interactions: [], portalTransitions: [], screenshots: [], errors: [], accessibility: [], expectedFixtureConsole: [], assetDecodeByBrowser: {} };
await mkdir(output, { recursive: true });

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assetNames = (await readdir(path.join(root, 'public/brand'))).filter(n => n.endsWith('.png') && !n.includes('-source'));
for (const name of assetNames) {
  const bytes = await readFile(path.join(root, 'public/brand', name));
  const response = await fetch(`${origin}/brand/${name}`);
  const served = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, name);
  assert.match(response.headers.get('content-type'), /image\/png/);
  assert.equal(sha(served), sha(bytes), `${name}: served bytes must be unchanged`);
  const built = await readFile(path.join(root, 'dist/brand', name));
  assert.equal(sha(built), sha(bytes), `${name}: build must preserve approved bytes`);
  report.assets.push({ path: `/brand/${name}`, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: sha(bytes), status: response.status });
}
const manifestResponse = await fetch(`${origin}/manifest.webmanifest`);
assert.equal(manifestResponse.status, 200);
const manifest = await manifestResponse.json();
for (const icon of manifest.icons) {
  const asset = report.assets.find(a => a.path === icon.src);
  assert.ok(asset, `Manifest asset exists: ${icon.src}`);
  assert.equal(icon.sizes, `${asset.width}x${asset.height}`);
}
report.manifest = manifest;

function fixture(scenario, pathname, method) {
  if (pathname === '/api/public-config') return { clinicTimeZone: 'Africa/Khartoum', googleAuthEnabled: false };
  if (pathname === '/api/patient-auth/address-states') return { complete: true, states: [] };
  if (pathname === '/api/patient-auth/forgot-password') return { challengeId: 'synthetic-reset' };
  if (pathname === '/api/auth/login') {
    if (scenario === 'staff-enrollment') return { mfaEnrollmentRequired: true, enrollmentToken: 'synthetic-enrollment' };
    if (scenario === 'patient-verification') return { status: 403, error: { code: 'ACCOUNT_PENDING_VERIFICATION' } };
    return { mfaRequired: true, challengeToken: 'synthetic-challenge', expiresAt: new Date(Date.now() + 600000).toISOString() };
  }
  if (pathname === '/api/auth/mfa/enroll/required') return { secret: 'SYNTHETICSETUPCODE', otpauthUri: 'otpauth://totp/Shifa:fixture?secret=JBSWY3DPEHPK3PXP&issuer=Shifa' };
  if (pathname === '/api/patient-auth/verification/resend-by-identity') return { challengeId: 'synthetic-verification' };
  if (pathname === '/api/specialties' || pathname === '/api/notifications' || pathname === '/api/patient/appointments') return [];
  if (method === 'GET' && pathname === '/api/notifications/unread-count') return { count: 0 };
  throw Error(`Unhandled fixture: ${method} ${pathname}`);
}

async function submitLogin(page) {
  await page.locator('input[autocomplete="username"]').fill('branding@example.test');
  await page.locator('input[autocomplete="current-password"]').fill('SyntheticPassword123');
  await page.locator('form button[type="submit"], form > button.patient-button').first().click();
}

async function setup(page, scenario) {
  const url = scenario === 'patient-login-via-staff' ? '/staff' : scenario === 'public' ? '/' : scenario === 'registration' ? '/register'
    : scenario.includes('password') && !scenario.startsWith('staff') ? '/forgot-password'
      : scenario === 'patient-layout' ? '/patient/appointments' : scenario.startsWith('patient') ? '/patient-login' : '/staff';
  await page.goto(origin + url, { waitUntil: 'load' });
  const ready = scenario === 'public' ? '.public-footer' : scenario === 'admin' ? '.admin-sidebar-brand'
    : scenario === 'patient-layout' ? '.patient-nav' : scenario === 'staff-password-required' ? '.staff-login-card' : '.auth-form-shifa-logo';
  await page.locator(ready).waitFor();
  if (scenario === 'patient-login-via-staff') {
    assert.equal(new URL(page.url()).pathname, '/staff');
    const portal = page.locator('.patient-auth-topbar .staff-topbar-patient-link');
    assert.equal(await portal.getAttribute('href'), '/patient-login');
    await portal.click();
    await page.waitForURL(origin + '/patient-login');
    await page.locator('#patient-auth-title').waitFor();
  }
  if (scenario === 'reset-password') {
    await page.locator('input[type="email"]').fill('branding@example.test');
    await page.locator('form > button.patient-button').first().click();
    await page.locator('input[autocomplete="one-time-code"]').waitFor();
  }
  if (['staff-mfa', 'staff-recovery', 'staff-enrollment', 'patient-verification'].includes(scenario)) {
    await submitLogin(page);
    if (scenario === 'staff-enrollment') await page.locator('#required-mfa-code').waitFor();
    else if (scenario.startsWith('staff')) {
      await page.locator('#staff-mfa-code').waitFor();
      if (scenario === 'staff-recovery') {
        await page.locator('form button.secondary').first().click();
        await page.locator('#staff-recovery-code').waitFor();
      }
    } else {
      await page.locator('form button[type="button"].patient-button').click();
      await page.locator('input[inputmode="numeric"]').waitFor();
    }
  }
  await page.evaluate(() => document.fonts.ready);
}

async function inspect(page, scenario, lang, theme) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter(i => i.src.includes('/brand/')).map(i => i.decode()));
  });
  const info = await page.evaluate(() => {
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return {
      lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme,
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      overflowElements: [...document.querySelectorAll('body *')].filter(visible).filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(e => ({ tag: e.tagName, class: e.className, ...box(e) })),
      logos: [...document.querySelectorAll('img[src^="/brand/"]')].filter(visible).map(i => ({ src: i.getAttribute('src'), alt: i.alt, naturalWidth: i.naturalWidth, naturalHeight: i.naturalHeight, fit: getComputedStyle(i).objectFit, filter: getComputedStyle(i).filter, transform: getComputedStyle(i).transform, ...box(i) })),
      authLogo: document.querySelector('.auth-form-shifa-logo') ? box(document.querySelector('.auth-form-shifa-logo')) : null,
      authHeader: (() => {
        const brand = document.querySelector('.patient-auth-topbar .patient-auth-brand');
        if (!brand) return null;
        const lockup = brand.querySelector('.shifa-logo-responsive');
        return { href: brand.getAttribute('href'), sharedLogoCount: brand.querySelectorAll('.shifa-logo-responsive').length, role: lockup?.getAttribute('role'), label: lockup?.getAttribute('aria-label'), full: lockup?.querySelector('.shifa-logo-responsive__full')?.getAttribute('src'), compact: lockup?.querySelector('.shifa-logo-responsive__compact')?.getAttribute('src'), visibleImages: [...brand.querySelectorAll('img')].filter(visible).map(i => i.getAttribute('src')), legacyMarkup: Boolean(brand.querySelector('.patient-auth-brand-mark, .brand-product-descriptor, svg')) };
      })(),
      form: document.querySelector('form') ? box(document.querySelector('form')) : null,
      unlabelledControls: [...document.querySelectorAll('button,a,input,select')].filter(visible).filter(e => !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.textContent.trim() && !e.labels?.length && !e.querySelector('img[alt]:not([alt=""])')).map(e => e.outerHTML.slice(0, 140))
    };
  });
  assert.equal(info.lang, lang);
  assert.equal(info.dir, lang === 'ar' ? 'rtl' : 'ltr');
  assert.equal(info.theme, theme);
  assert.ok(info.scrollWidth <= info.width + 1, `Page overflow: ${info.scrollWidth}/${info.width}; ${JSON.stringify(info.overflowElements)}`);
  assert.ok(info.logos.length >= (scenario === 'public' || scenario === 'admin' ? 2 : 1), 'Expected visible brand placements');
  for (const logo of info.logos) {
    assert.ok(logo.naturalWidth > 0 && logo.naturalHeight > 0, `Loaded ${logo.src}`);
    assert.equal(logo.fit, 'contain', `Uncropped ${logo.src}`);
    assert.equal(logo.filter, 'none', `Unrecolored ${logo.src}`);
    assert.ok(logo.x >= -1 && logo.x + logo.width <= info.width + 1, `Logo bounds ${logo.src}`);
    assert.ok(logo.width > 0 && logo.height > 0, `Logo dimensions: ${JSON.stringify(logo)}`);
    assert.ok(logo.src === '/brand/shifa-mark-light.png' || logo.src === `/brand/shifa-logo-${lang}-${theme}.png`, `Language/theme asset: ${logo.src}`);
  }
  if (info.authLogo) {
    assert.ok(info.authLogo.width >= 200 && info.authLogo.width <= 273, 'Prominent full auth logo');
    assert.ok(info.authLogo.y + info.authLogo.height <= info.form.y, 'Full logo above form');
  }
  if (info.authHeader) {
    assert.equal(info.authHeader.href, '/', 'Auth header retains home navigation');
    assert.equal(info.authHeader.sharedLogoCount, 1, 'Header itself uses the single shared ShifaLogo');
    assert.equal(info.authHeader.role, 'img');
    assert.ok(info.authHeader.label, 'Header logo has an accessible name');
    assert.equal(info.authHeader.full, `/brand/shifa-logo-${lang}-${theme}.png`);
    assert.equal(info.authHeader.compact, '/brand/shifa-mark-light.png');
    assert.equal(info.authHeader.legacyMarkup, false, 'No legacy blue icon/text lockup in the auth header');
    assert.equal(info.authHeader.visibleImages.length, 1, 'Exactly one visible header logo');
  } else if (info.authLogo && scenario !== 'staff-password-required') assert.fail('Authentication header is missing');
  assert.deepEqual(info.unlabelledControls, [], 'Controls have accessible names');
  return info;
}

for (const engine of engines) {
  let browser;
  try {
    browser = await playwright[engine].launch(engine === 'chromium' ? { executablePath: process.env.QA_CHROME || '/opt/google/chrome/chrome', args: ['--no-sandbox'] } : {});
    report.browsers.push({ engine, version: browser.version(), status: 'launched' });
    for (const scenario of selected) for (const lang of ['en', 'ar']) for (const theme of ['light', 'dark']) {
      const id = `${engine}-${scenario}-${lang}-${theme}`;
      const context = await browser.newContext({ viewport: sizes[2], locale: lang, colorScheme: theme, reducedMotion: 'reduce' });
      await context.addInitScript(({ lang, theme, scenario }) => {
        localStorage.setItem('shifa_language', lang); localStorage.setItem('alshifa_theme', theme);
        if (scenario === 'admin' || scenario === 'staff-password-required') {
          sessionStorage.setItem('cms_staff_user', JSON.stringify({ id: 'synthetic-admin', username: 'branding@example.test', role: 'ADMIN', mustChangePassword: scenario === 'staff-password-required' }));
          sessionStorage.setItem('cms_staff_token', 'synthetic-token');
        }
        if (scenario === 'patient-layout') {
          sessionStorage.setItem('cms_patient_user', JSON.stringify({ id: 'synthetic-patient', role: 'PATIENT', patientLinked: true }));
          sessionStorage.setItem('cms_patient_token', 'synthetic-token');
        }
      }, { lang, theme, scenario });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push({ id, type: 'exception', message: error.message }));
      page.on('console', message => {
        if (message.type() !== 'error') return;
        const item = { id, type: 'console', message: message.text() };
        if (scenario === 'patient-verification' && /status of 403/.test(message.text())) report.expectedFixtureConsole.push(item);
        else report.errors.push(item);
      });
      page.on('request', request => { if (/\/brand\/(README|.*-source)/.test(request.url())) report.errors.push({ id, type: 'reference-file-loaded', url: request.url() }); });
      page.on('response', response => { if (response.url().includes('/brand/') && response.status() !== 200) report.errors.push({ id, type: 'asset-http', url: response.url(), status: response.status() }); });
      await page.route('**/api/**', async route => {
        try {
          const result = fixture(scenario, new URL(route.request().url()).pathname, route.request().method());
          await route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify(result) });
        } catch (error) { report.errors.push({ id, type: 'fixture', message: error.message }); await route.fulfill({ status: 500, json: {} }); }
      });
      await page.route('https://accounts.google.com/gsi/client**', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{id:{initialize(){},renderButton(container,options){const b=document.createElement('button');b.type='button';b.textContent=options.locale==='ar'?'المتابعة باستخدام Google':'Continue with Google';b.style.cssText='width:100%;min-height:44px;border:1px solid #71869b;border-radius:6px;font:inherit;color:inherit;background:transparent';container.append(b);}}}};` }));
      // The offline visual fixture deliberately has no live notification socket.
      await page.route('**/socket.io/**', route => route.fulfill({ contentType: 'text/plain', body: '0{"sid":"synthetic","upgrades":[],"pingInterval":60000,"pingTimeout":60000}' }));
      try {
        if (scenario !== 'patient-login-via-staff') await setup(page, scenario);
        for (const size of sizes) {
          await page.setViewportSize(size);
          if (scenario === 'patient-login-via-staff') {
            await setup(page, scenario);
            report.portalTransitions.push({ id, viewport: size.name, from: '/staff', control: 'Patient portal', to: new URL(page.url()).pathname, hrefPreserved: true });
          }
          const info = await inspect(page, scenario, lang, theme);
          report.matrix.push({ id, viewport: size.name, status: 'pass', ...info });
          const authShot = loginScenarios.includes(scenario) && size.name === (theme === 'dark' ? 'mobile' : 'desktop');
          const otherShot = engine === 'chromium' && lang === 'ar' && theme === 'dark' && ['public', 'admin', 'patient-layout', 'staff-mfa', 'staff-enrollment', 'reset-password', 'registration'].includes(scenario) && size.name === 'tablet';
          if (authShot || otherShot) {
            const name = `${id}-${size.name}.png`;
            await page.screenshot({ path: path.join(output, name), fullPage: true });
            report.screenshots.push(name);
          }
        }
        await page.setViewportSize({ width: 320, height: 640 });
        await inspect(page, scenario, lang, theme);
        report.reflow.push({ id, width: 320, status: 'pass' });
        if (engine === 'chromium' || loginScenarios.includes(scenario)) {
          for (const viewport of engine === 'chromium' ? [sizes[0], sizes[2]] : [sizes[2]]) {
          await page.setViewportSize(viewport);
          await page.evaluate(axe);
          const scan = await page.evaluate(async () => {
            const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
            return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), passes: r.passes.length, incomplete: r.incomplete.map(v => v.id) };
          });
          report.accessibility.push({ id, viewport: viewport.name, ...scan });
          }
        }
        if (loginScenarios.includes(scenario)) {
          const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
          const next = lang === 'en' ? 'ar' : 'en';
          await page.locator(`.patient-auth-language button[lang="${next}"]`).click();
          await page.waitForFunction(next => document.documentElement.lang === next, next);
          await page.locator('.theme-toggle-btn').click();
          const switched = await inspect(page, scenario, next, theme === 'light' ? 'dark' : 'light');
          assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), navigationCount);
          await page.setViewportSize({ width: 320, height: 640 });
          await inspect(page, scenario, next, theme === 'light' ? 'dark' : 'light');
          await page.keyboard.press('Tab');
          assert.ok(await page.evaluate(() => document.activeElement !== document.body));
          const focus = await page.evaluate(() => { const e = document.activeElement, s = getComputedStyle(e); return { tag: e.tagName, outline: s.outlineStyle, boxShadow: s.boxShadow }; });
          assert.ok(focus.outline !== 'none' || focus.boxShadow !== 'none', 'Visible keyboard focus');
          report.interactions.push({ id, liveLanguageAndThemeSwitch: true, noReload: true, width320: true, keyboardFocus: focus, logo: switched.logos.find(l => l.alt)?.src });
        }
        if (scenario === 'public') {
          await page.setViewportSize(sizes[0]);
          await page.locator('.public-menu-toggle').click();
          await page.locator('.public-mobile-menu').waitFor({ state: 'visible' });
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('.public-menu-toggle').getAttribute('aria-expanded'), 'false');
          assert.ok(await page.locator('.public-menu-toggle').evaluate(e => document.activeElement === e));
          report.interactions.push({ id, mobileMenuAndEscapeFocus: true });
        }
        if (scenario === 'public' && lang === 'en' && theme === 'light') {
          report.assetDecodeByBrowser[engine] = await page.evaluate(async names => {
            const r = [];
            for (const name of names) { const i = new Image(); i.src = '/brand/' + name; await i.decode(); r.push({ name, width: i.naturalWidth, height: i.naturalHeight }); }
            return r;
          }, assetNames);
          report.iconLinks = await page.locator('link[rel="icon"],link[rel="apple-touch-icon"],link[rel="manifest"]').evaluateAll(nodes => nodes.map(n => ({ rel: n.rel, href: n.getAttribute('href'), sizes: n.sizes?.value })));
          for (const link of report.iconLinks) assert.ok(link.rel === 'manifest' ? link.href === '/manifest.webmanifest' : report.assets.some(a => a.path === link.href));
          if (engine === 'chromium') {
            const cdp = await context.newCDPSession(page);
            const manifest = await cdp.send('Page.getAppManifest');
            assert.deepEqual(manifest.errors, []);
            report.manifestBrowser = { url: manifest.url, errors: manifest.errors };
            await cdp.detach();
          }
          await page.setViewportSize(sizes[2]);
          const footer = `${engine}-public-footer-en-light-desktop.png`;
          await page.locator('.public-footer').screenshot({ path: path.join(output, footer) });
          report.screenshots.push(footer);
        }
      } catch (error) {
        report.errors.push({ id, type: 'assertion', message: error.message, logos: await page.locator('img[src^="/brand/"]').evaluateAll(nodes => nodes.map(n => ({ src: n.getAttribute('src'), className: n.className, width: n.clientWidth, height: n.clientHeight, display: getComputedStyle(n).display, parentWidth: n.parentElement.clientWidth }))).catch(() => []) });
        await page.screenshot({ path: path.join(output, `${id}-failure.png`), fullPage: true }).catch(() => {});
      } finally { await context.close(); }
      await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(`${id}: ${report.errors.some(e => e.id === id) ? 'FAIL' : 'checked'}`);
    }
  } catch (error) { report.errors.push({ engine, type: 'launch', message: error.message }); }
  finally { await browser?.close(); }
}
report.summary = { matrixPasses: report.matrix.length, errors: report.errors.length, accessibilityScans: report.accessibility.length, accessibilityViolations: report.accessibility.reduce((n, a) => n + a.violations.length, 0), screenshots: report.screenshots.length };
await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
if (report.errors.length || report.summary.accessibilityViolations) process.exitCode = 1;
