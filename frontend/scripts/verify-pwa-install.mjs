// Controlled UI/state matrix. The separate native probe uses a real browser offer.
// QA_PLAYWRIGHT_MODULE and QA_AXE_PATH may point outside the project.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.env.QA_OUTPUT || path.join(root, 'docs/pwa-install-evidence');
const origin = process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5199';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const pw = await import(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const axe = await readFile(process.env.QA_AXE_PATH || '/tmp/shifa-brand-qa/node_modules/axe-core/axe.min.js', 'utf8');
const profiles = [
  { name: 'chromium', engine: 'chromium', mode: 'prompt' },
  { name: 'android-chromium', engine: 'chromium', mode: 'prompt', device: 'Pixel 7' },
  { name: 'samsung-capability', engine: 'chromium', mode: 'prompt', device: 'Pixel 7', userAgent: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36' },
  { name: 'firefox-unsupported', engine: 'firefox', mode: 'hidden' },
  { name: 'webkit-unsupported', engine: 'webkit', mode: 'hidden' },
  { name: 'ios-webkit', engine: 'webkit', mode: 'ios', device: 'iPhone 13' },
  { name: 'ipad-desktop-webkit', engine: 'webkit', mode: 'ios', platform: 'MacIntel', touchPoints: 5, widths: [768] },
  { name: 'standalone', engine: 'chromium', mode: 'hidden', standalone: true },
  { name: 'ios-standalone', engine: 'webkit', mode: 'hidden', device: 'iPhone 13', navigatorStandalone: true, widths: [390] }
].filter(p => !process.env.QA_PROFILES || process.env.QA_PROFILES.split(',').includes(p.name));
const routes = [
  { name: 'public', url: '/', ready: '.public-header' },
  { name: 'patient-login', url: '/patient-login', ready: '#patient-auth-title' },
  { name: 'patient-layout', url: '/patient/appointments', ready: '.patient-header' },
  { name: 'registration', url: '/register', ready: '#patient-auth-title' },
  { name: 'password-recovery', url: '/forgot-password', ready: '#patient-auth-title' }
].filter((route, index) => process.env.QA_ROUTES ? process.env.QA_ROUTES.split(',').includes(route.name) : index < 3);
const report = { generatedAt: new Date().toISOString(), fixture: 'Prompt/choice/display-mode fixtures exercise real production UI; no real installation is claimed by this matrix. Samsung is a capability/UA fixture. iOS uses emulated WebKit, not a physical device.', browsers: {}, matrix: [], interactions: [], accessibility: [], screenshots: [], errors: [] };
await mkdir(output, { recursive: true });
const browsers = new Map();

async function inspect(page, expectedButton) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await page.evaluate(() => {
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const header = document.querySelector('.public-header, .patient-auth-topbar, .patient-header');
    const button = header?.querySelector('.pwa-install-button');
    const logo = header?.querySelector('.shifa-logo-responsive');
    button?.focus({ preventScroll: true, focusVisible: true });
    const focus = button ? { style: getComputedStyle(button).outlineStyle, width: getComputedStyle(button).outlineWidth } : null;
    button?.blur();
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, header: header ? rect(header) : null, lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme,
      button: button ? { ...rect(button), label: button.getAttribute('aria-label'), text: button.textContent.trim(), disabled: button.disabled, busy: button.getAttribute('aria-busy'), focus } : null,
      logo: logo ? rect(logo) : null,
      controls: [...(header?.querySelectorAll('a,button') || [])].filter(visible).map(e => ({ ...rect(e), label: e.getAttribute('aria-label') || e.textContent.trim(), install: e === button })) };
  });
  assert.ok(layout.scrollWidth <= layout.width + 1, `Horizontal page overflow ${JSON.stringify(layout)}`);
  assert.equal(Boolean(layout.button), expectedButton);
  assert.ok(layout.logo?.width >= 40 && layout.logo?.height >= 40, `Logo squeezed ${JSON.stringify(layout.logo)}`);
  if (expectedButton) {
    const b = layout.button;
    assert.ok(b.width >= 44 && b.height >= 44, '44px touch target');
    assert.equal(b.focus.style, 'solid', 'Keyboard focus is visibly outlined');
    assert.ok(Number.parseFloat(b.focus.width) >= 3, 'Keyboard focus ring is at least 3px wide');
    assert.ok(b.x >= -1 && b.x + b.width <= layout.width + 1, 'Install control inside viewport');
    for (const c of layout.controls.filter(c => !c.install)) {
      const overlapX = Math.min(b.x+b.width,c.x+c.width)-Math.max(b.x,c.x);
      const overlapY = Math.min(b.y+b.height,c.y+c.height)-Math.max(b.y,c.y);
      assert.ok(overlapX <= 1 || overlapY <= 1, `Install control overlaps ${c.label}: ${JSON.stringify(layout)}`);
    }
    const l = layout.logo;
    assert.ok(Math.min(b.x+b.width,l.x+l.width)-Math.max(b.x,l.x) <= 1, 'Install action does not overlap the logo');
    assert.ok(layout.dir === 'rtl' ? b.x < l.x : b.x >= l.x + l.width, 'RTL/LTR order beside logo');
  }
  return layout;
}

try {
  for (const profile of profiles) {
    if (!browsers.has(profile.engine)) {
      const browser = await pw[profile.engine].launch(profile.engine === 'chromium' ? { executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] } : {});
      browsers.set(profile.engine, browser); report.browsers[profile.engine] = browser.version();
    }
    const widths = process.env.QA_WIDTHS ? process.env.QA_WIDTHS.split(',').map(Number) : profile.widths || [390, 1440];
    for (const route of routes) for (const lang of ['en', 'ar']) for (const theme of ['light', 'dark']) for (const width of widths) {
      const id = `${profile.name}-${route.name}-${lang}-${theme}-${width}`;
      const gate = profile.mode === 'prompt' && route.name === 'public' && lang === 'en' && theme === 'light' && width === 1440;
      const context = await browsers.get(profile.engine).newContext({ ...(profile.device ? pw.devices[profile.device] : {}), ...(profile.userAgent ? { userAgent: profile.userAgent } : {}), viewport: { width, height: width < 600 ? 844 : 1000 }, colorScheme: theme, reducedMotion: 'reduce' });
      await context.addInitScript(({ profile, lang, theme, gate, patient }) => {
        localStorage.setItem('shifa_language', lang); localStorage.setItem('alshifa_theme', theme);
        if (patient) { sessionStorage.setItem('cms_patient_user', JSON.stringify({ id: 'install-ui-fixture', role: 'PATIENT', patientLinked: true })); sessionStorage.setItem('cms_patient_token', 'synthetic-token'); }
        if (profile.platform) Object.defineProperty(navigator, 'platform', { configurable: true, value: profile.platform });
        if (profile.touchPoints) Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: profile.touchPoints });
        if (profile.navigatorStandalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
        const nativeMedia = window.matchMedia.bind(window), display = new EventTarget();
        display.matches = Boolean(profile.standalone); display.media = '(display-mode: standalone)';
        window.matchMedia = query => query === display.media ? display : nativeMedia(query);
        window.__setStandalone = matches => { display.matches = matches; display.dispatchEvent(new Event('change')); };
        // Suppress unsolicited real browser offers only in this deterministic matrix.
        window.addEventListener('beforeinstallprompt', event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); } }, { capture: true });
        window.__promptCalls = 0; window.__gestureAtPrompt = [];
        window.__offerInstall = () => {
          const event = new Event('beforeinstallprompt', { cancelable: true });
          event.prompt = () => { window.__promptCalls++; window.__gestureAtPrompt.push(navigator.userActivation?.isActive); return Promise.resolve(); };
          event.userChoice = new Promise(resolve => { window.__resolveInstallChoice = outcome => resolve({ outcome }); });
          window.__lastOffer = event; window.dispatchEvent(event); return event.defaultPrevented;
        };
        if (gate) {
          const fetch = window.fetch;
          window.fetch = (...args) => String(args[0]).endsWith('/api/public-config')
            ? new Promise(resolve => { window.__releasePublicConfig = () => resolve(fetch(...args)); })
            : fetch(...args);
        }
      }, { profile, lang, theme, gate, patient: route.name === 'patient-layout' });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push({ id, type: 'runtime', message: error.message }));
      await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/public-config' ? { clinicTimeZone: 'Africa/Khartoum' } : [] }));
      await page.route('https://accounts.google.com/gsi/client**', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{id:{initialize(){},renderButton(container,options){const b=document.createElement('button');b.type='button';b.textContent=options.locale==='ar'?'المتابعة باستخدام Google':'Continue with Google';b.style.cssText='width:100%;min-height:44px;color:inherit;background:transparent;border:1px solid #71869b';container.append(b);}}}};` }));
      try {
        await page.goto(origin + route.url, { waitUntil: 'load' });
        if (gate) {
          await page.waitForFunction(() => typeof window.__releasePublicConfig === 'function');
          assert.equal(await page.evaluate(() => window.__offerInstall()), true, 'Offer captured before config/React mount');
          await page.evaluate(() => window.__releasePublicConfig());
        }
        await page.locator(route.ready).waitFor();
        await page.evaluate(() => document.fonts.ready);
        if (profile.name === 'chromium' && route.name === 'patient-login') {
          await page.goto(origin + '/staff');
          await page.locator('.staff-topbar-patient-link').waitFor();
          assert.equal(await page.locator('.pwa-install-button').count(), 0, 'Staff header has no install action');
          await page.locator('.staff-topbar-patient-link').click();
          await page.locator(route.ready).waitFor();
          assert.equal(new URL(page.url()).pathname, '/patient-login');
          report.interactions.push({ id, directPatientLogin: true, staffPatientPortalTransition: true, staffInstallActionAbsent: true });
        }
        if (profile.name === 'chromium' && route.name === 'public' && lang === 'en' && width === 320) {
          await page.evaluate(axe);
          const baseline = await page.evaluate(async () => {
            const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } });
            return { installControlPresent: Boolean(document.querySelector('.pwa-install-button')), violations: r.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })) };
          });
          report.interactions.push({ id, accessibilityBeforeInstallOffer: baseline });
        }
        let layoutBeforeOffer = null;
        if (profile.mode === 'prompt' && !gate) {
          layoutBeforeOffer = await inspect(page, false);
          assert.equal(await page.evaluate(() => window.__offerInstall()), true);
        }
        if (profile.mode !== 'hidden') await page.locator('.pwa-install-button').waitFor();
        const info = await inspect(page, profile.mode !== 'hidden');
        if (layoutBeforeOffer && info.button) {
          const sameRect = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 1);
          assert.equal(layoutBeforeOffer.header.height, info.header.height, `Header height changed when offer appeared: ${id}`);
          assert.ok(sameRect(layoutBeforeOffer.logo, info.logo), `Logo shifted when offer appeared: ${id}`);
          const beforeMenu = layoutBeforeOffer.controls.find(control => /menu|القائمة/i.test(control.label));
          const afterMenu = info.controls.find(control => /menu|القائمة/i.test(control.label));
          if (beforeMenu && afterMenu) assert.ok(sameRect(beforeMenu, afterMenu), `Menu shifted when offer appeared: ${id}`);
          report.interactions.push({ id, stableHeaderHeight: true, stableLogoPosition: true, stableMenuPosition: !beforeMenu || sameRect(beforeMenu, afterMenu) });
        }
        assert.equal(info.lang, lang); assert.equal(info.dir, lang === 'ar' ? 'rtl' : 'ltr'); assert.equal(info.theme, theme);
        assert.equal(await page.evaluate(() => window.__promptCalls), 0, 'No automatic prompt');
        report.matrix.push({ id, profile: profile.name, route: route.url, mode: profile.mode, earlyOffer: gate, status: 'pass', ...info });
        const shot = profile.name === 'chromium' && (
          (route.name === 'public' && width === 390 && ((lang === 'ar' && theme === 'light') || (lang === 'en' && theme === 'light') || (lang === 'ar' && theme === 'dark'))) ||
          (route.name === 'public' && lang === 'en' && theme === 'light' && width === 1440) ||
          (['patient-login', 'patient-layout'].includes(route.name) && width === 390 && theme === 'light') ||
          (route.name === 'patient-login' && lang === 'en' && theme === 'light' && width === 1440)
        );
        if (shot) { const name = `${id}.png`; await page.screenshot({ path: path.join(output,name), fullPage: false }); report.screenshots.push(name); }
        if (profile.name === 'chromium' && route.name === 'public' && lang === 'en' && theme === 'light' && width === 1440) {
          for (const w of [320,520,620,900,1050,1051,1100,1180,1200,1280]) { await page.setViewportSize({ width:w,height:900 }); await inspect(page,true); }
          await page.setViewportSize({ width,height:1000 });
          report.interactions.push({ id, breakpointWidths: [320,520,620,900,1050,1051,1100,1180,1200,1280] });
          const timeOrigin = await page.evaluate(() => performance.timeOrigin);
          await page.locator('.public-language').click();
          await page.waitForFunction(() => document.documentElement.lang === 'ar');
          assert.equal(await page.locator('.pwa-install-button').innerText(), 'حمل التطبيق');
          await page.locator('.public-theme-toggle').click();
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
          await page.locator('.public-language').click(); await page.locator('.public-theme-toggle').click();
          await page.locator('.public-header__patient').click(); await page.locator('#patient-auth-title').waitFor();
          assert.equal(await page.locator('.pwa-install-button').count(), 1, 'Deferred prompt survives SPA header changes');
          await page.locator('.patient-auth-brand').click(); await page.locator('.public-header').waitFor();
          assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'SPA transition kept the original event');
          report.interactions.push({id,liveLanguageThemeSwitch:true,deferredOfferSurvivesSpaNavigation:true});
        }
        if (['chromium', 'ios-webkit'].includes(profile.name)) {
          await page.evaluate(axe);
          const a11y = await page.evaluate(async () => {
            const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});
            return { violations:r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),passes:r.passes.length };
          });
          report.accessibility.push({ id, ...a11y });
        }
        if (profile.mode === 'prompt') {
          const button=page.locator('.pwa-install-button');
          await button.focus(); await page.keyboard.press('Enter');
          await page.waitForFunction(()=>window.__promptCalls===1);
          assert.equal(await button.isDisabled(),true);
          assert.equal(await button.getAttribute('aria-busy'),'true');
          await page.evaluate(()=>window.__resolveInstallChoice('dismissed'));
          await page.waitForFunction(()=>!document.querySelector('.pwa-install-button'));
          await page.evaluate(()=>window.dispatchEvent(window.__lastOffer));
          assert.equal(await button.count(),0,'One-shot event discarded after dismissal');
          await page.evaluate(()=>window.__offerInstall()); await button.waitFor();
          if (profile.device) await button.tap(); else await button.click();
          await page.evaluate(()=>window.__resolveInstallChoice('accepted'));
          await page.waitForFunction(()=>!document.querySelector('.pwa-install-button'));
          await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
          await page.evaluate(()=>window.__offerInstall()); assert.equal(await button.count(),0,'Installed app ignores new offers');
          assert.deepEqual(await page.evaluate(()=>window.__gestureAtPrompt),[true,true]);
          report.interactions.push({id,promptsFromUserGesture:2,dismissedOfferConsumed:true,freshOfferAccepted:true,appinstalledHidesImmediately:true});
        } else if (profile.mode === 'ios') {
          const button=page.locator('.pwa-install-button');
          assert.equal(await button.getAttribute('aria-haspopup'),'dialog');
          await button.focus(); await page.keyboard.press('Enter');
          const dialog=page.getByRole('dialog'); await dialog.waitFor();
          assert.match(await dialog.innerText(),lang==='ar'?/إضافة إلى الشاشة الرئيسية/:/Add to Home Screen/);
          assert.equal(await page.evaluate(()=>window.__promptCalls),0);
          await page.evaluate(axe);
          const dialogA11y = await page.evaluate(async () => {
            const r = await axe.run(document.querySelector('[role="dialog"]:not([hidden])'), { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } });
            return { violations: r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), passes: r.passes.length };
          });
          report.accessibility.push({ id: id + '-instructions', ...dialogA11y });
          if (shot) { const name=`${id}-instructions.png`;await page.screenshot({path:path.join(output,name),fullPage:false});report.screenshots.push(name); }
          await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
          assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true,'Hint traps keyboard focus');
          await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
          assert.equal(await button.evaluate(b=>document.activeElement===b),true,'Hint restores focus');
          await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
          assert.equal(await button.count(),0);
          report.interactions.push({id,iosInstructions:true,noNativePromptInvented:true,escapeAndFocusRestoration:true,appinstalledHidesImmediately:true});
        } else {
          await page.evaluate(()=>window.dispatchEvent(new Event('beforeinstallprompt',{cancelable:true})));
          assert.equal(await page.locator('.pwa-install-button').count(),0);
          if (profile.standalone || profile.navigatorStandalone) { await page.evaluate(()=>window.__offerInstall());assert.equal(await page.locator('.pwa-install-button').count(),0); }
          if (profile.standalone) {
            await page.evaluate(()=>window.__setStandalone(false));
            await page.evaluate(()=>window.__offerInstall()); await page.locator('.pwa-install-button').waitFor();
            await page.evaluate(()=>window.__setStandalone(true));
            assert.equal(await page.locator('.pwa-install-button').count(),0);
            await page.evaluate(()=>window.__setStandalone(false));
            assert.equal(await page.locator('.pwa-install-button').count(),0,'Display-mode change cleared the old offer');
          }
          report.interactions.push({id,unsupportedOrInstalledActionHidden:true});
        }
      } catch(error) {
        report.errors.push({id,type:'assertion',message:error.message});
        await page.screenshot({path:path.join(output,`${id}-failure.png`),fullPage:false}).catch(()=>{});
      } finally { await context.close(); }
      await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
      console.log(`${id}: ${report.errors.some(e=>e.id===id)?'FAIL':'checked'}`);
    }
  }
} finally { await Promise.all([...browsers.values()].map(b=>b.close())); }
report.summary={cases:report.matrix.length,errors:report.errors.length,accessibilityScans:report.accessibility.length,accessibilityViolations:report.accessibility.reduce((n,r)=>n+r.violations.length,0),screenshots:report.screenshots.length};
await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(report.summary);
if(report.errors.length||report.summary.accessibilityViolations)process.exitCode=1;
