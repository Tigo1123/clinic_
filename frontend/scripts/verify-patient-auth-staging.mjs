// Read-only staging navigation check. No credentials or forms are submitted.
// Set QA_PLAYWRIGHT_MODULE if Playwright is installed outside this project.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const origin = 'https://clinic-staging-web.onrender.com';
const output = fileURLToPath(new URL('../../docs/patient-auth-branding-followup/staging/', import.meta.url));
await mkdir(output, { recursive: true });
const report = { origin, checkedAt: new Date().toISOString(), scope: 'Live staging frontend assets and navigation; public config/Google button isolated, no authentication submitted.', documents: [], cases: [], errors: [] };
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
report.browser = browser.version();
try {
  for (const mode of ['direct', 'staff-portal']) for (const lang of ['en', 'ar']) for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
    const id = `${mode}-${lang}-${theme}-${width}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: theme, reducedMotion: 'reduce' });
    await context.addInitScript(({ lang, theme }) => { localStorage.setItem('shifa_language', lang); localStorage.setItem('alshifa_theme', theme); }, { lang, theme });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.route('**/api/**', route => route.fulfill({ json: { clinicTimeZone: 'Africa/Khartoum' } }));
    await page.route('https://accounts.google.com/gsi/client**', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{id:{initialize(){},renderButton(container,options){const b=document.createElement('button');b.type='button';b.textContent=options.locale==='ar'?'المتابعة باستخدام Google':'Continue with Google';b.style.cssText='width:100%;min-height:44px;color:inherit;background:transparent;border:1px solid #71869b';container.append(b);}}}};` }));
    page.on('response', async response => {
      if (response.request().resourceType() !== 'document' || !response.url().startsWith(origin)) return;
      const headers = response.headers();
      report.documents.push({ id, url: response.url(), status: response.status(), cacheControl: headers['cache-control'], age: headers.age || '0', etag: headers.etag, lastModified: headers['last-modified'], cacheStatus: headers['cf-cache-status'] });
    });
    page.on('pageerror', error => report.errors.push({ id, type: 'runtime', message: error.message }));
    try {
      await page.goto(origin + (mode === 'direct' ? '/patient-login' : '/staff'), { waitUntil: 'load' });
      if (mode === 'staff-portal') {
        await page.locator('#staff-auth-title').waitFor();
        const link = page.locator('.patient-auth-topbar .staff-topbar-patient-link');
        assert.equal(await link.getAttribute('href'), '/patient-login');
        await link.click();
        await page.waitForURL(origin + '/patient-login');
      }
      await page.locator('#patient-auth-title').waitFor();
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.querySelectorAll('.patient-auth-brand img,.auth-form-shifa-logo')].map(i => i.decode())); });
      const info = await page.evaluate(() => {
        const header = document.querySelector('.patient-auth-topbar .patient-auth-brand');
        const shared = header.querySelector('.shifa-logo-responsive');
        return { url: location.pathname, lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, entry: document.querySelector('script[type="module"][src]')?.getAttribute('src'), header: { sharedCount: header.querySelectorAll('.shifa-logo-responsive').length, role: shared?.getAttribute('role'), label: shared?.getAttribute('aria-label'), full: shared?.querySelector('.shifa-logo-responsive__full')?.getAttribute('src'), compact: shared?.querySelector('.shifa-logo-responsive__compact')?.getAttribute('src'), visible: [...header.querySelectorAll('img')].filter(i => i.getClientRects().length).map(i => ({ src: i.getAttribute('src'), width: i.naturalWidth, height: i.naturalHeight, fit: getComputedStyle(i).objectFit })), legacy: Boolean(header.querySelector('.patient-auth-brand-mark,.brand-product-descriptor,svg')) }, formLogo: document.querySelector('.auth-form-shifa-logo')?.getAttribute('src') };
      });
      const full = `/brand/shifa-logo-${lang}-${theme}.png`;
      assert.equal(info.url, '/patient-login');
      assert.equal(info.lang, lang); assert.equal(info.dir, lang === 'ar' ? 'rtl' : 'ltr'); assert.equal(info.theme, theme);
      assert.equal(info.header.sharedCount, 1); assert.equal(info.header.role, 'img'); assert.ok(info.header.label);
      assert.equal(info.header.full, full); assert.equal(info.header.compact, '/brand/shifa-mark-light.png'); assert.equal(info.formLogo, full);
      assert.equal(info.header.legacy, false); assert.equal(info.header.visible.length, 1);
      assert.equal(info.header.visible[0].src, width === 390 ? '/brand/shifa-mark-light.png' : full);
      assert.equal(info.header.visible[0].fit, 'contain'); assert.ok(info.header.visible[0].width > 0 && info.header.visible[0].height > 0);
      assert.ok(info.scrollWidth <= width);
      const screenshot = `staging-${id}.png`;
      await page.screenshot({ path: output + '/' + screenshot, fullPage: true });
      report.cases.push({ id, status: 'pass', ...info, screenshot });
    } catch (error) { report.errors.push({ id, type: 'assertion', message: error.message }); }
    finally { await context.close(); }
    await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n');
    console.log(id, report.errors.some(e => e.id === id) ? 'FAIL' : 'pass');
  }
} finally { await browser.close(); }
report.summary = { passed: report.cases.length, errors: report.errors.length };
await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(report.summary);
if (report.errors.length || report.cases.length !== 16) process.exitCode = 1;
