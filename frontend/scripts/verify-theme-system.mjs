import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const origin = 'http://localhost:5173';
const cdpPort = 9222;
const cdpOrigin = `http://127.0.0.1:${cdpPort}`;
const screenshotsDir = path.resolve(process.cwd(), 'qa-theme-evidence');
fs.mkdirSync(screenshotsDir, { recursive: true });

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }
      } else {
        this.events.push(message);
      }
    };
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.socket.close();
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForChrome(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${cdpOrigin}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      // Wait and retry
    }
    await delay(200);
  }
  throw new Error('Timed out waiting for Chrome CDP');
}

async function createSession(urlPath, width = 1440, height = 900) {
  const target = await (await fetch(`${cdpOrigin}/json/new?${encodeURIComponent(`${origin}${urlPath}`)}`, { method: 'PUT' })).json();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('DOM.enable'),
    cdp.send('CSS.enable'),
    cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 })
  ]);
  await cdp.send('Page.navigate', { url: `${origin}${urlPath}` });
  await delay(600);

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed');
    }
    return result.result.value;
  };

  const waitForSelector = async (selector, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const exists = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        if (exists) return true;
      } catch {}
      await delay(150);
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  };

  const waitForImage = async (selector, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const loaded = await evaluate(`(()=>{
          const img = document.querySelector(${JSON.stringify(selector)});
          return Boolean(img && img.complete && img.naturalWidth > 0);
        })()`);
        if (loaded) return true;
      } catch {}
      await delay(150);
    }
    return false;
  };

  const screenshot = async (name) => {
    await delay(400);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(screenshotsDir, `${name}.png`);
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    console.log(`[Screenshot] Saved: ${filePath}`);
    return filePath;
  };

  const close = async () => {
    cdp.close();
    try {
      await fetch(`${cdpOrigin}/json/close/${target.id}`);
    } catch {}
  };

  return { cdp, evaluate, waitForSelector, waitForImage, screenshot, close, target };
}

async function run() {
  console.log('--- Launching Chrome Headless ---');
  const userDataDir = fs.mkdtempSync('/tmp/chrome-theme-qa-');
  const chromeProcess = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage'
  ], { stdio: 'ignore' });

  const results = [];

  try {
    await waitForChrome();
    console.log('--- Chrome CDP Ready ---');

    // =========================================================================
    // 1. PUBLIC LANDING PAGE (/) - Desktop 1440x900
    // =========================================================================
    console.log('\n--- 1. Testing Landing Page (/) ---');
    const s1 = await createSession('/', 1440, 900);
    await s1.waitForSelector('.public-site');

    // Set storage to light and reload so React mounts with light theme
    await s1.evaluate(`(()=>{
      localStorage.setItem('alshifa_theme', 'light');
      localStorage.setItem('cms_theme', 'light');
    })()`);
    await s1.cdp.send('Page.reload');
    await delay(800);
    await s1.waitForSelector('.public-site');
    await s1.waitForSelector('.public-theme-toggle');

    let landingTheme = await s1.evaluate(`document.documentElement.getAttribute('data-theme')`);
    console.log(`Landing Initial Theme (Light): ${landingTheme}`);
    results.push({ test: 'Landing renders in Light theme', pass: landingTheme === 'light' });

    let bodyBgLight = await s1.evaluate(`getComputedStyle(document.querySelector('.public-site')).backgroundColor`);
    console.log(`Landing Light Background: ${bodyBgLight}`);
    await s1.screenshot('01-landing-light-1440');

    // Click theme toggle on Landing to switch to Dark Mode
    await s1.evaluate(`document.querySelector('.public-theme-toggle').click()`);
    await delay(400);

    landingTheme = await s1.evaluate(`document.documentElement.getAttribute('data-theme')`);
    let storedTheme = await s1.evaluate(`localStorage.getItem('alshifa_theme')`);
    let legacyStored = await s1.evaluate(`localStorage.getItem('cms_theme')`);
    console.log(`Landing after toggle -> Theme: ${landingTheme}, Stored: ${storedTheme}, Legacy: ${legacyStored}`);
    results.push({ test: 'Landing toggle switches to Dark theme and persists to storage', pass: landingTheme === 'dark' && storedTheme === 'dark' && legacyStored === 'dark' });

    let landingDarkBg = await s1.evaluate(`getComputedStyle(document.querySelector('.public-site')).backgroundColor`);
    console.log(`Landing Dark Background: ${landingDarkBg}`);
    results.push({ test: 'Landing dark background is medical navy (#0b131e)', pass: landingDarkBg.includes('11, 19, 30') || landingDarkBg.includes('#0b131e') });
    await s1.screenshot('02-landing-dark-1440');
    await s1.close();

    // =========================================================================
    // 2. PATIENT LOGIN (/patient-login) - Persistence & Dark Styling
    // =========================================================================
    console.log('\n--- 2. Testing Patient Login (/patient-login) ---');
    // Open in dark mode (from persisted localStorage)
    const s2 = await createSession('/patient-login', 1440, 900);
    await s2.waitForSelector('.patient-auth-shell');
    await s2.waitForSelector('.theme-toggle-btn');

    let patientLoginTheme = await s2.evaluate(`document.documentElement.getAttribute('data-theme')`);
    console.log(`Patient Login Theme (persisted): ${patientLoginTheme}`);
    results.push({ test: 'Patient Login inherits dark theme across navigation', pass: patientLoginTheme === 'dark' });

    let patientAuthBg = await s2.evaluate(`getComputedStyle(document.querySelector('.patient-auth-shell')).backgroundColor`);
    let patientInputBg = await s2.evaluate(`getComputedStyle(document.querySelector('.patient-auth-identifier')).backgroundColor`);
    let patientInputColor = await s2.evaluate(`getComputedStyle(document.querySelector('.patient-auth-identifier')).color`);
    console.log(`Patient Login Dark Background: ${patientAuthBg}`);
    console.log(`Patient Login Input Background: ${patientInputBg}, Color: ${patientInputColor}`);
    results.push({ test: 'Patient Login shell has dark theme styling', pass: patientAuthBg.includes('11, 19, 30') });
    results.push({ test: 'Patient Login input has dark theme styling', pass: patientInputBg.includes('19, 31, 45') });

    const artLoaded = await s2.waitForImage('.patient-auth-illustration');
    console.log('Patient Login 3D art status loaded:', artLoaded);
    results.push({ test: 'Patient Login 3D artwork loaded and rendered', pass: artLoaded });

    await s2.screenshot('03-patient-login-dark-1440');

    // Test page refresh persistence
    console.log('Testing page reload persistence...');
    await s2.cdp.send('Page.reload');
    await delay(1000);
    await s2.waitForSelector('.patient-auth-shell');
    let themeAfterReload = await s2.evaluate(`document.documentElement.getAttribute('data-theme')`);
    console.log(`Patient Login Theme after reload: ${themeAfterReload}`);
    results.push({ test: 'Patient Login preserves dark theme on page reload without flash', pass: themeAfterReload === 'dark' });

    // Toggle to light mode on Patient Login
    await s2.evaluate(`document.querySelector('.theme-toggle-btn').click()`);
    await delay(300);
    let patientLoginLight = await s2.evaluate(`document.documentElement.getAttribute('data-theme')`);
    console.log(`Patient Login toggled to light: ${patientLoginLight}`);
    results.push({ test: 'Patient Login toggles to light mode', pass: patientLoginLight === 'light' });
    await s2.screenshot('04-patient-login-light-1440');

    // Toggle back to dark
    await s2.evaluate(`document.querySelector('.theme-toggle-btn').click()`);
    await delay(300);
    await s2.close();

    // =========================================================================
    // 3. PATIENT REGISTER (/register) - 7-Step Onboarding
    // =========================================================================
    console.log('\n--- 3. Testing Patient Register (/register) ---');
    const s3 = await createSession('/register', 1440, 900);
    await s3.waitForSelector('.patient-auth-shell--register');
    await s3.waitForSelector('.theme-toggle-btn');

    let registerTheme = await s3.evaluate(`document.documentElement.getAttribute('data-theme')`);
    console.log(`Register Theme: ${registerTheme}`);
    results.push({ test: 'Register inherits dark theme', pass: registerTheme === 'dark' });

    let registerCardBg = await s3.evaluate(`getComputedStyle(document.querySelector('.patient-auth-shell')).backgroundColor`);
    console.log(`Register Dark Shell Background: ${registerCardBg}`);
    results.push({ test: 'Register dark shell background applied', pass: registerCardBg.includes('11, 19, 30') });

    const registerArt = await s3.waitForImage('.patient-auth-illustration--register');
    console.log('Register 3D art status loaded:', registerArt);
    results.push({ test: 'Register 3D artwork loaded and rendered', pass: registerArt });

    await s3.screenshot('05-register-dark-1440');

    // Toggle to light and back
    await s3.evaluate(`document.querySelector('.theme-toggle-btn').click()`);
    await delay(300);
    let registerLight = await s3.evaluate(`document.documentElement.getAttribute('data-theme')`);
    console.log(`Register toggled to light: ${registerLight}`);
    results.push({ test: 'Register toggles to light mode', pass: registerLight === 'light' });
    await s3.screenshot('06-register-light-1440');

    await s3.evaluate(`document.querySelector('.theme-toggle-btn').click()`);
    await delay(300);
    await s3.close();

    // =========================================================================
    // 4. STAFF LOGIN (/staff) - Theme, Toggle, and Password Eye/EyeOff
    // =========================================================================
    console.log('\n--- 4. Testing Staff Login (/staff) ---');
    const s4 = await createSession('/staff', 1440, 900);
    await s4.waitForSelector('.patient-auth-shell--staff');
    await s4.waitForSelector('.staff-theme-toggle-btn');
    await s4.waitForSelector('#staff-password');

    let staffTheme = await s4.evaluate(`document.documentElement.getAttribute('data-theme')`);
    console.log(`Staff Login Theme: ${staffTheme}`);
    results.push({ test: 'Staff Login inherits dark theme', pass: staffTheme === 'dark' });

    const staffArt = await s4.waitForImage('.patient-auth-illustration--staff');
    console.log('Staff 3D art status loaded:', staffArt);
    results.push({ test: 'Staff 3D artwork loaded and rendered', pass: staffArt });

    // Test Password Field & Eye/EyeOff toggle
    console.log('Testing Staff Password Eye/EyeOff toggle & alignment...');
    await s4.evaluate(`(()=>{
      const pwdInput = document.getElementById('staff-password');
      if (pwdInput) {
        pwdInput.value = 'SecretStaff123!';
        pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await delay(200);

    let pwdTypeInitial = await s4.evaluate(`document.getElementById('staff-password').type`);
    console.log(`Password input type initial: ${pwdTypeInitial}`);
    results.push({ test: 'Password input initial type is password', pass: pwdTypeInitial === 'password' });

    const geom = await s4.evaluate(`(()=>{
      const input = document.getElementById('staff-password');
      const toggle = document.querySelector('.patient-field__password-toggle');
      if (!input || !toggle) return null;
      const ir = input.getBoundingClientRect();
      const tr = toggle.getBoundingClientRect();
      const dir = document.documentElement.dir || 'ltr';
      const computedInput = getComputedStyle(input);
      return {
        dir,
        input: { top: ir.top, bottom: ir.bottom, height: ir.height, left: ir.left, right: ir.right, width: ir.width },
        toggle: { top: tr.top, bottom: tr.bottom, height: tr.height, left: tr.left, right: tr.right, width: tr.width },
        centerDiffY: (tr.top + tr.height/2) - (ir.top + ir.height/2),
        paddingInlineEnd: computedInput.paddingInlineEnd,
        paddingLeft: computedInput.paddingLeft,
        paddingRight: computedInput.paddingRight,
        inputDir: input.getAttribute('dir')
      };
    })()`);
    console.log('Staff Password Field Geometry:', JSON.stringify(geom, null, 2));

    const isCenteredVertically = Math.abs(geom.centerDiffY) < 2;
    console.log(`Toggle vertically centered: ${isCenteredVertically} (diff: ${geom.centerDiffY}px)`);
    results.push({ test: 'Staff password toggle vertically centered within field', pass: isCenteredVertically });

    const isInsideInput = geom.toggle.left >= geom.input.left && geom.toggle.right <= geom.input.right;
    console.log(`Toggle inside input bounds: ${isInsideInput}`);
    results.push({ test: 'Staff password toggle inside input bounds', pass: isInsideInput });

    results.push({ test: 'Staff password does not force dir="ltr"', pass: geom.inputDir === null });

    // Click toggle to show password
    await s4.evaluate(`document.querySelector('.patient-field__password-toggle').click()`);
    await delay(200);
    let pwdTypeAfterClick = await s4.evaluate(`document.getElementById('staff-password').type`);
    console.log(`Password input type after click: ${pwdTypeAfterClick}`);
    results.push({ test: 'Staff password toggle shows plain text', pass: pwdTypeAfterClick === 'text' });

    // Click toggle to hide password
    await s4.evaluate(`document.querySelector('.patient-field__password-toggle').click()`);
    await delay(200);
    let pwdTypeAfterSecondClick = await s4.evaluate(`document.getElementById('staff-password').type`);
    console.log(`Password input type after second click: ${pwdTypeAfterSecondClick}`);
    results.push({ test: 'Staff password toggle hides password back', pass: pwdTypeAfterSecondClick === 'password' });

    await s4.screenshot('07-staff-login-dark-1440');

    // Test Staff theme toggle button
    await s4.evaluate(`document.querySelector('.staff-theme-toggle-btn').click()`);
    await delay(300);
    let staffLightTheme = await s4.evaluate(`document.documentElement.getAttribute('data-theme')`);
    console.log(`Staff Login switched to light: ${staffLightTheme}`);
    results.push({ test: 'Staff theme toggle switches to light', pass: staffLightTheme === 'light' });
    await s4.screenshot('08-staff-login-light-1440');

    // Switch back to dark
    await s4.evaluate(`document.querySelector('.staff-theme-toggle-btn').click()`);
    await delay(300);
    await s4.close();

    // =========================================================================
    // 5. MOBILE VIEWPORTS (509x615, 390x844, 320x568)
    // =========================================================================
    console.log('\n--- 5. Mobile Responsive Verification ---');

    // 5.1 Patient Login @ 509x615
    const s5_1 = await createSession('/patient-login', 509, 615);
    await s5_1.waitForSelector('.patient-button');

    const mobile509Pl = await s5_1.evaluate(`(()=>{
      const btn = document.querySelector('.patient-button');
      const art = document.querySelector('.patient-auth-illustration');
      const btnRect = btn?.getBoundingClientRect();
      const artRect = art?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        artHeight: artRect?.height,
        btnBottom: btnRect?.bottom,
        btnVisible: btnRect ? btnRect.bottom <= 615 : false,
        btnTop: btnRect?.top,
        clearance: 615 - (btnRect?.bottom || 0)
      };
    })()`);
    console.log('Patient Login @ 509x615 metrics:', mobile509Pl);
    results.push({ test: 'Patient Login @ 509x615 has no horizontal overflow', pass: mobile509Pl.scrollWidth <= mobile509Pl.clientWidth });
    results.push({ test: 'Patient Login @ 509x615 CTA button is fully visible', pass: mobile509Pl.btnVisible });
    await s5_1.screenshot('09-patient-login-dark-509x615');

    // Toggle to light at 509x615
    await s5_1.evaluate(`document.querySelector('.theme-toggle-btn').click()`);
    await delay(300);
    await s5_1.screenshot('10-patient-login-light-509x615');
    await s5_1.evaluate(`document.querySelector('.theme-toggle-btn').click()`);
    await delay(300);
    await s5_1.close();

    // 5.2 Register @ 509x615
    const s5_2 = await createSession('/register', 509, 615);
    await s5_2.waitForSelector('.patient-button');
    const mobile509Reg = await s5_2.evaluate(`(()=>{
      const btn = document.querySelector('.patient-button');
      const btnRect = btn?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        btnVisible: btnRect ? btnRect.bottom <= 615 : false,
        clearance: 615 - (btnRect?.bottom || 0)
      };
    })()`);
    console.log('Register @ 509x615 metrics:', mobile509Reg);
    results.push({ test: 'Register @ 509x615 has no horizontal overflow', pass: mobile509Reg.scrollWidth <= mobile509Reg.clientWidth });
    results.push({ test: 'Register @ 509x615 Next CTA is visible', pass: mobile509Reg.btnVisible });
    await s5_2.screenshot('11-register-dark-509x615');
    await s5_2.close();

    // 5.3 Staff Login @ 509x615
    const s5_3 = await createSession('/staff', 509, 615);
    await s5_3.waitForSelector('.patient-button');
    const mobile509Staff = await s5_3.evaluate(`(()=>{
      const btn = document.querySelector('.patient-button');
      const btnRect = btn?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        btnVisible: btnRect ? btnRect.bottom <= 615 : false
      };
    })()`);
    console.log('Staff @ 509x615 metrics:', mobile509Staff);
    results.push({ test: 'Staff @ 509x615 has no horizontal overflow', pass: mobile509Staff.scrollWidth <= mobile509Staff.clientWidth });
    results.push({ test: 'Staff @ 509x615 Sign In CTA is visible', pass: mobile509Staff.btnVisible });
    await s5_3.screenshot('12-staff-dark-509x615');
    await s5_3.close();

    // 5.4 Mobile Landing @ 390x844 (Mobile menu drawer with theme toggle)
    const s5_4 = await createSession('/', 390, 844);
    await s5_4.waitForSelector('.public-menu-toggle');

    // Open mobile menu
    await s5_4.evaluate(`document.querySelector('.public-menu-toggle').click()`);
    await delay(400);

    const mobileDrawerThemeToggle = await s5_4.evaluate(`(()=>{
      const btn = document.querySelector('.public-mobile-theme-toggle');
      return btn ? { visible: btn.offsetParent !== null, label: btn.getAttribute('aria-label') } : null;
    })()`);
    console.log('Mobile menu drawer theme toggle:', mobileDrawerThemeToggle);
    results.push({ test: 'Mobile menu drawer includes theme toggle', pass: Boolean(mobileDrawerThemeToggle && mobileDrawerThemeToggle.visible) });
    await s5_4.screenshot('13-landing-mobile-drawer-dark-390');
    await s5_4.close();

    // 5.5 Ultra compact 320x568
    const s5_5 = await createSession('/patient-login', 320, 568);
    await s5_5.waitForSelector('.patient-auth-shell');
    const mobile320 = await s5_5.evaluate(`(()=>{
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      };
    })()`);
    console.log('Patient Login @ 320x568 overflow check:', mobile320);
    results.push({ test: 'Patient Login @ 320x568 has no horizontal overflow', pass: mobile320.scrollWidth <= mobile320.clientWidth });
    await s5_5.screenshot('14-patient-login-dark-320x568');
    await s5_5.close();

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n=========================================');
    console.log('       TEST VERIFICATION SUMMARY         ');
    console.log('=========================================');
    let allPassed = true;
    for (const r of results) {
      console.log(`${r.pass ? '✓ PASS' : '✗ FAIL'}: ${r.test}`);
      if (!r.pass) allPassed = false;
    }

    console.log(`\nAll tests passed: ${allPassed}`);
    chromeProcess.kill('SIGTERM');
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('Test run error:', err);
    chromeProcess.kill('SIGTERM');
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    process.exit(1);
  }
}

run();
