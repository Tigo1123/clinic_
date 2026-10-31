The PWA icon assets have been recomposed directly from the approved shifa-mark-light.png symbol. No drawing, new symbol, shape redesign, tint, global opacity reduction, or application CSS changes were introduced. All full logos, the shared mark, favicons, Apple touch icon, and reference PNGs retain their starting checksums.

The old PNG pixel data exactly matches a LANCZOS resize of the 145×145 shifa-pwa-light-source.png after RGB conversion. That source already contains a small, offset colored mark inside a rounded off-white tile. Scaling the whole tile carried its embedded padding, low-resolution softness and down/right offset into the PWA assets. The old exports are alpha=255 everywhere, so this was not a CSS/PNG opacity-fading problem. The earlier manifest provided only any-purpose icons; Android can add its own inset/background for those icons, further reducing apparent symbol size. The faintness seen on the phone cannot be attributed to an OS-specific rendering path without that device; the bitmap composition issues are directly measured here.

New exports use the existing 180×210 approved mark rather than upscaling the small precomposed tile. They are composited on solid #FFFFFF, with only near-white matte residue (at most 8/255 away from white) discarded around the raster boundary. The approved symbol colors and shape are retained, with ordinary uniform raster scaling. Both size choices give even non-background pixel bounds so that opposite padding is exactly equal. All four PNGs are fully opaque (alpha 255 at every pixel).

Bounds use half-open coordinates [left, top, right, bottom). The old symbol is identified by chroma >30 to exclude its neutral baked tile. New bounds below are literal non-white RGB pixels; the full JSON includes both definitions for both versions. The old raw non-white bounds cover almost the whole canvas because of its neutral tile.

| Asset | Old visible symbol bounds | Old center offset (x,y) | New non-white bounds | New center offset |
|---|---|---|---|---|
| pwa-192x192.png | [54, 40, 154, 167] (100×127) | [8.0, 7.5] px | [34, 18, 158, 174] (124×156) | [0.0, 0.0] px |
| pwa-512x512.png | [145, 108, 410, 446] (265×338) | [21.5, 21.0] px | [93, 52, 419, 460] (326×408) | [0.0, 0.0] px |

The regular 192px export has 18px above/below and 34px left/right; the regular 512px export has 52px above/below and 93px left/right. The regular mark grows from 100×127 to 124×156 at 192px, and from 265×338 to 326×408 at 512px. See [all old/new metrics](before-after-bounds.json).

Separate maskable assets provide an opaque white background without a pre-baked outer border, shadow, or rounded tile. The Android launcher applies its own circle, rounded square, squircle or other mask. The entire non-white symbol, including its edge pixels, stays inside the standardized 40%-radius circle. A rectangular 10% inset alone would not guarantee that the tall symbol's corners survive every adaptive mask.

| Maskable export | Actual non-white bounds | Equal horizontal padding | Equal vertical padding | Farthest pixel center radius |
|---|---|---:|---:|---:|
| pwa-maskable-192x192.png | [47, 35, 145, 157] | 47px | 35px | 39.427% |
| pwa-maskable-512x512.png | [126, 93, 386, 419] | 126px | 93px | 39.473% |

The browser's independent canvas check also includes the farthest pixel corner, which remains below the 40% radius. Maskable marks deliberately have more padding than the regular/splash compositions. Declaring the larger regular exports as any maskable would falsely promise that their content survives the minimum adaptive safe area, so the two purposes remain separate.

The manifest now references four PNGs: existing pwa-192x192.png and pwa-512x512.png with purpose any, plus pwa-maskable-192x192.png and pwa-maskable-512x512.png with purpose maskable. background_color changes from #F8FAFC to #FFFFFF to match the actual white splash/icon canvas. theme_color, app identity, start URL, scope, display mode, names and favicon references remain unchanged. No service-worker, page-layout, theme-CSS, favicon or full-logo changes were made.

Verification passed: deterministic export --check; actual PNG opacity/bounds checks; all four source/build/HTTP checksums; browser image decoding; manifest dimensions/purposes and zero Chrome manifest errors. Three targeted frontend test files passed (branding config, brand assets and shared logo runtime), production build passed, lint passed with 11 existing warnings in unchanged files, and diff checks passed. Existing Vite large-chunk warnings remain. See [geometry checks](geometry-check.json), [tests](tests.log), [build](build.log), [lint](lint.log) and [diff checks](diff-check.log).

Chrome was installed in an isolated /tmp profile with isolated XDG directories. The test PWA installed, launched in standalone mode, appeared in the actual desktop Chrome app launcher, and was then uninstalled. Chrome stored both regular and maskable 192/512px icons; all five stored/trusted bitmaps are pixel-identical to the matching exports. See [browser/PWA report](browser-pwa-report.json), [installed bitmap checks](installed-icon-pixel-check.json), [desktop launcher screenshot](desktop-chrome-app-launcher.png) and [standalone app screenshot](desktop-installed-app.png). No personal browser profile was used.

The [composition/mask/splash preview](composition-and-masks.png) and [safe-zone overlay](mask-safe-zone-overlay.png) show the new assets on white, at small launcher sizes, and under circle, rounded-square, squircle and minimum-safe-area masks. The interactive source is [preview.html](preview.html), served by the browser verifier through its local evidence route. These are clearly labelled browser composition previews, not Android screen captures.

Android device confirmation is still pending. The user confirmed installation through Google Chrome; the Android version is unknown, and this environment has no connected Android device, adb or emulator. Desktop device emulation cannot verify the native Android splash or launcher. After deployment, use a fresh Chrome PWA install on the phone (to avoid an already-installed/cached WebAPK icon), check the home-screen mark and cold-start splash on white, and confirm the launcher mask and optical centering. The patch is safe to commit within the asset/manifest scope; native Android visual sign-off remains a release check. Nothing was staged, committed, pushed, or deployed.

Exact changed files: [changed-files.txt](changed-files.txt). Protected-file hashes: [protected-asset-integrity.json](protected-asset-integrity.json). Existing unrelated QA artifacts were left untouched.

Standards and browser guidance:

- [W3C manifest safe zone](https://www.w3.org/TR/appmanifest/#icon-masks-and-safe-zone): centered circle with radius 40%, opaque maskable export guidance.
- [Chrome/web.dev maskable icons](https://web.dev/articles/maskable-icon): separate any and maskable assets avoid unnecessary padding in general-purpose icons.
- [Chrome manifest and device verification](https://developer.chrome.com/docs/devtools/progressive-web-apps): DevTools safe-area inspection and why desktop emulation does not reproduce native Android installation.
- [Chrome splash requirements](https://developer.chrome.com/docs/lighthouse/pwa/splash-screen): manifest name, background/theme colors and a valid 512px PNG.

Re-export or verify without application changes:

```bash
python3 frontend/scripts/export-shifa-pwa-icons.py
python3 frontend/scripts/export-shifa-pwa-icons.py --check
```

Pillow is required for the deterministic offline export. The local production preview uses port 5198. With externally installed Playwright and Chrome available, run from frontend/:

```bash
QA_HEADED=1 \
QA_PLAYWRIGHT_MODULE=/tmp/shifa-brand-qa/node_modules/playwright/index.mjs \
node scripts/verify-shifa-pwa-icons.mjs
```

The test installs and removes only the local PWA in its disposable Chrome profile. No project package manifest or lockfile was changed.
