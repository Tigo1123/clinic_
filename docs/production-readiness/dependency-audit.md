# Dependency audit

Ran `npm audit --json` for backend and frontend lockfiles (read-only); no `npm audit fix` was run. Audit snapshot date: 22 October 2026. Findings are advisory metadata against locked packages; evaluate again at release because feeds and lockfiles change.

| Workspace | Critical | High | Moderate | Low | Finding / path | Proposed action and runtime relevance |
|---|---:|---:|---:|---:|---|---|
| Frontend | 0 | 2 | 0 | 0 | `source-map-js@1.2.1` GHSA-68fv-2mgg-jv7q; Vite 8.1.4 (five GHSA advisories, <=8.1.5), via launch-editor/dev server | Audit indicates fixes available, likely patch-level within Vite 8/source-map-js; update lockfile intentionally, rebuild/test. Vite is build/dev tooling and static production image does not run Vite, but CI/dev server are exposed to crafted local tooling inputs. |
| Backend | 0 | 3 | 0 | 0 | `braces@3.0.3` GHSA-vfj7-8cjw-p6xm via `chokidar@3.6.0` / `nodemon@3.1.14` | Findings are in development watcher chain. Docker build uses production install (`npm ci --omit=dev` per backend Dockerfile), so these packages are not expected in runtime image. npm's suggested aggregate nodemon fix is a SemVer-major downgrade and not an acceptable blind fix; update safe transitive dependency or nodemon version/override and verify. |

Sources: [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [Vite command injection advisory](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [Vite custom middleware advisory](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The remaining Vite advisories are listed by npm's report; inspect them at remediation time.

`npm audit` exits nonzero because of High advisories. No known runtime backend dependency was identified in this audit report as High, but this does not replace image scanning or a fresh audit at release. Lockfiles and install reproducibility should be checked in the remediation PR; do not force major upgrades without tests.
