// QA_PLAYWRIGHT_MODULE can point to an externally installed Playwright module.
// Only an isolated local Chrome profile and local production preview are used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'docs/shifa-pwa-icon-evidence');
const origin = process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5198';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const profile = await mkdtemp('/tmp/shifa-pwa-install-');
const report = { checkedAt: new Date().toISOString(), origin, profile, androidDeviceConnected: false, assets: [], previews: [], installation: {}, errors: [] };
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.QA_CHROME || '/opt/google/chrome/chrome', headless: process.env.QA_HEADED !== '1',
  args: ['--no-sandbox'], viewport: { width: 1280, height: 1000 },
  env: { ...process.env, XDG_DATA_HOME: path.join(profile, 'xdg-data'), XDG_CONFIG_HOME: path.join(profile, 'xdg-config'), XDG_CACHE_HOME: path.join(profile, 'xdg-cache') }
});
report.browser = context.browser()?.version();
await context.route('**/api/**', route => route.fulfill({ json: { clinicTimeZone: 'Africa/Khartoum' } }));
await context.route('**/__pwa-evidence/**', async route => {
  const file = path.basename(new URL(route.request().url()).pathname);
  await route.fulfill({ path: path.join(output, file) });
});
let cdp, installed = false;
try {
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(origin, { waitUntil: 'load' });
  await page.locator('.public-header').waitFor();
  cdp = await context.newCDPSession(page);
  const parsed = await cdp.send('Page.getAppManifest');
  assert.deepEqual(parsed.errors, []);
  const manifest = JSON.parse(parsed.data);
  assert.equal(manifest.background_color, '#FFFFFF');
  assert.equal(manifest.theme_color, '#0F766E');
  assert.equal(manifest.icons.length, 4);
  report.manifest = manifest;
  report.manifestErrors = parsed.errors;
  for (const icon of manifest.icons) {
    const expected = await readFile(path.join(root, 'frontend/public', icon.src));
    const built = await readFile(path.join(root, 'frontend/dist', icon.src));
    assert.deepEqual(built, expected);
    const info = await page.evaluate(async src => {
      const response = await fetch(src);
      const buffer = await response.arrayBuffer();
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
      const image = await createImageBitmap(new Blob([buffer], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const c = canvas.getContext('2d'); c.drawImage(image, 0, 0);
      const pixels = c.getImageData(0, 0, image.width, image.height).data;
      let minX = image.width, minY = image.height, maxX = -1, maxY = -1, minAlpha = 255, maxRadius = 0, inkPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        minAlpha = Math.min(minAlpha, pixels[i + 3]);
        if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) continue;
        const x = i / 4 % image.width, y = Math.floor(i / 4 / image.width);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); inkPixels++;
        maxRadius = Math.max(maxRadius, Math.hypot(x + .5 - image.width / 2, y + .5 - image.height / 2));
      }
      return { status: response.status, contentType: response.headers.get('content-type'), width: image.width, height: image.height, sha256, minAlpha, bounds: [minX, minY, maxX + 1, maxY + 1], centerOffset: [(minX + maxX + 1 - image.width) / 2, (minY + maxY + 1 - image.height) / 2], inkPixels, maxRadiusRatio: maxRadius / image.width, pixelCornerRadiusRatio: (maxRadius + Math.SQRT1_2) / image.width };
    }, icon.src);
    assert.equal(info.status, 200); assert.match(info.contentType, /image\/png/);
    assert.equal(info.sha256, createHash('sha256').update(expected).digest('hex'));
    assert.equal(icon.sizes, `${info.width}x${info.height}`);
    assert.equal(info.minAlpha, 255);
    assert.deepEqual(info.centerOffset, [0, 0]);
    if (icon.purpose === 'maskable') assert.ok(info.pixelCornerRadiusRatio < .4, 'Entire mark including antialias pixels is inside safe circle');
    report.assets.push({ ...icon, ...info });
  }
  await page.goto(origin + '/__pwa-evidence/preview.html');
  await page.waitForFunction(() => window.previewReady === true);
  await page.screenshot({ path: path.join(output, 'composition-and-masks.png'), fullPage: true });
  await page.locator('#safe').check();
  await page.screenshot({ path: path.join(output, 'mask-safe-zone-overlay.png'), fullPage: true });
  report.previews.push('composition-and-masks.png', 'mask-safe-zone-overlay.png');

  // This verifies desktop Chrome installation. It is not an Android device test.
  try {
    await cdp.send('PWA.install', { manifestId: origin + '/', installUrlOrBundleUrl: origin + '/' });
    installed = true;
    report.installation.installed = true;
    report.installation.osState = await cdp.send('PWA.getOsAppState', { manifestId: origin + '/' });
    await cdp.send('PWA.changeAppUserSettings', { manifestId: origin + '/', displayMode: 'standalone' });
    const launch = await cdp.send('PWA.launch', { manifestId: origin + '/' });
    report.installation.launchTarget = launch.targetId;
    for (let attempt = 0; attempt < 50; attempt++) {
      let candidate;
      for (const possible of context.pages().filter(p => p !== page)) {
        const session = await context.newCDPSession(possible);
        const target = await session.send('Target.getTargetInfo');
        await session.detach();
        if (target.targetInfo.targetId === launch.targetId) candidate = possible;
      }
      // Chrome can replace the launch target while moving it into an app window.
      // This isolated profile has only the preview tab and this one app URL.
      if (!candidate) {
        const appPages = context.pages().filter(p => p !== page && p.url() === origin + '/');
        if (appPages.length === 1) candidate = appPages[0];
      }
      if (candidate) {
        await candidate.locator('.public-header').waitFor();
        report.installation.displayModeStandalone = await candidate.evaluate(() => matchMedia('(display-mode: standalone)').matches);
        await candidate.screenshot({ path: path.join(output, 'desktop-installed-app.png'), fullPage: false });
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    report.installation.targets = (await cdp.send('Target.getTargets')).targetInfos.map(t => ({ id: t.targetId, type: t.type, url: t.url }));
    const iconRoot = path.join(profile, 'Default/Web Applications');
    async function collect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await collect(file);
        else if (entry.name === '512.png' || entry.name === '192.png') {
          const relative = path.relative(iconRoot, file);
          const name = 'chrome-stored-' + relative.replaceAll(path.sep, '-').replaceAll(' ', '-');
          await copyFile(file, path.join(output, name));
          (report.installation.storedIcons ||= []).push({ profilePath: relative, evidence: name });
        }
      }
    }
    await collect(iconRoot);
    const launcher = await context.newPage();
    await launcher.goto('chrome://apps');
    const appName = launcher.getByText(manifest.name, { exact: true }).or(launcher.getByText('Shifa', { exact: true }));
    if (await appName.count()) {
      await appName.first().waitFor();
      await launcher.screenshot({ path: path.join(output, 'desktop-chrome-app-launcher.png') });
      report.installation.desktopLauncherScreenshot = 'desktop-chrome-app-launcher.png';
    }
    if (report.installation.displayModeStandalone !== true) report.installation.standaloneWindowNotVerified = 'The installed app target was not exposed as a standalone Playwright page; installation and stored bitmaps were checked separately.';
  } catch (error) { report.installation.environmentLimitation = error.message; }
} catch (error) { report.errors.push(error.message); process.exitCode = 1; }
finally {
  if (installed) {
    await cdp.send('PWA.uninstall', { manifestId: origin + '/' }).then(() => { report.installation.testAppRemoved = true; }).catch(error => { report.installation.cleanupError = error.message; });
  }
  await context.close();
  await writeFile(path.join(output, 'browser-pwa-report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ assets: report.assets.length, manifestErrors: report.manifestErrors, installation: report.installation, errors: report.errors }, null, 2));
