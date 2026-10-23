# Frontend performance audit

## Build artifact inventory

`npm run build` completed successfully (Vite, 3,505 modules) and emitted a warning for chunks above 500 KB. `dist` contained 117 files. Asset-size script counts: 42 JS files, 1,693,498 raw bytes (~498,672 gzip estimate); 9 CSS files, 251,474 raw bytes (~48,742 gzip estimate). Gzip figures are script-generated and are not a promise about production HTTP encoding. Largest JS chunks: `index` 512,748 B raw (~144,553 gzip), `AdminDashboard` 492,285 (~140,167 gzip), `PasswordField` 224,139 (~72,758 gzip), then pharmacy ~71.7 KB and reception ~55.3 KB. Largest CSS: index ~58.1 KB, landing ~44.9 KB, login submission ~38.8 KB, App ~32.3 KB. No source maps were emitted. Built fonts included 30 WOFF2 files (~399 KB raw) and 30 WOFF fallbacks (~520 KB); WebP images total ~204 KB. Font CSS imports Cairo and Inter broadly; font subsets/weights are duplicated across formats.

Vite preview delivered compressed JS in browser capture (e.g. 512,748 decoded / 145,887 transferred for the index chunk). Production Nginx does not configure compression, so equivalent transfer size is not established for deployment. Static hashed asset immutable caching is also not configured in `frontend/nginx.conf`.

## Loading behavior and pain points

- Initial app entry is ~513 KB raw and password shared chunk ~224 KB raw. The browser showed 73 KB compressed for PasswordField chunk plus 146 KB for index on profile A, irrespective of patient-login intent; it is listed in Vite preload output. Patient login cold had 283 KB transferred; registration 312 KB; staff login 336 KB. Staff route on profile A included 35 requests. This is the main first-load cost.
- `AppRouter.jsx` eagerly imports patient auth and all patient workspace pages. Patient dashboards, appointment booking, medical records and related MUI/forms therefore share the initial route dependency graph more than necessary. Staff entry itself is lazy; Admin/doctor/lab/pharmacy/reception workspaces are separately lazy inside `App.jsx`. Landing page is lazy. Build output's large AdminDashboard chunk is not evidence it is downloaded on public initial route; route-level split is present for staff feature workspaces.
- MUI subpath imports appear generally used; no evidence of barrel-importing all MUI. Recharts and broad icon set are feature dependencies. `lucide-react` generated individual icon chunks, with several icons listed among public route resources. No bundle analyzer/source-map inspection was enabled; duplicated package copies were not conclusively measured.
- No service worker/PWA, offline mode, local API cache, or request deduplication layer was found. Patient pending appointment polling runs every 45 seconds. Sensitive API caching controls are not proven at the browser/edge layer.
- Nginx production configuration lacks explicit gzip/Brotli and hashed asset Cache-Control/Expires. No explicit preconnect to API or font origin (fonts are local). Global Cairo/Inter CSS imports load a large font family/subsets.

## Local browser measurement, profile A

390px viewport, 4x CPU, 2 Mbps down/750 Kbps up/100 ms RTT, production build served by Vite preview; cold clears HTTP cache, service worker bypassed, local/session storage cleared; warm repeats cached navigation. No API is configured. Evidence: [`browser-local-baseline.json`](evidence/browser-local-baseline.json).

| Route | Cold nav | Cold transfer / requests | FCP / LCP | Warm nav / transfer |
|---|---:|---:|---:|---:|
| `/` | 2.27 s | 663 KB / 36 | 1.85 / 1.85 s | 1.26 s / 5.5 KB |
| `/patient-login` | 2.02 s | 283 KB / 30 | not captured | 1.37 s / 93 KB |
| `/register` | 2.02 s | 312 KB / 30 | not captured | 1.21 s / 64 KB |
| `/staff` | 2.02 s | 336 KB / 35 | 1.54 / 1.54 s | 1.24 s / 5.5 KB |

The navigation capture does not mean server/API “dashboard usable” timing. `patient-login` and `register` paint observer returned no FCP/LCP entries; usable form controls were present. Root DOM was 788 nodes; auth pages 87–100 nodes. Root had two long tasks of 50 and 68ms under this CPU profile; patient login one 264ms task. No horizontal overflow or failed asset requests were recorded at 390px. Cold vs warm differences are substantial in bytes, but browser-cache repeat remains ~1.2–1.4s due navigation/runtime work and small revalidation/transfers.

## Web Vitals limits

Local profile A landing LCP was 1.85s; profile B staff login LCP was 6.73s (>2.5s target) after the form settled. Some auth-page LCP/FCP observers returned null despite visible controls, so those values are unavailable. TTFB from localhost Vite preview is not representative of a real edge/API. INP was not collected because the harness did not dispatch representative user interactions; CLS was not instrumented; TBT was not calculated. Long-task entries are available but are not interchangeable with TBT. No Core Web Vitals claim is made for authenticated routes, staging, or production.

**Interpretation:** cold profile A public login meets reasonable visual load targets, but is not a production network benchmark and staff lazy chunk degrades more sharply on weaker profiles. Optimize only after these baselines are accepted; prioritize route-level patient splitting, reduce initial MUI/icon/font work, configure compression and long-lived hashed asset caching, then compare equivalent production-edge tests.
