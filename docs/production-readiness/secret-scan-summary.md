# Secret scan summary

Read-only scan of current tracked files and Git history was performed for private-key headers, common cloud/Git/payment token formats and credential-bearing PostgreSQL URL patterns. Tool output and this report contain only paths/categories; no candidate value is reproduced. `.env` files are not tracked; tracked matches are limited to `.env.example`, deployment templates, Docker variable interpolation, tests with disposable/local fixtures, and historical vendored documentation/build code. These are pattern matches, not confirmed live credentials.

| Scope | Result | Severity / remediation |
|---|---|---|
| Current tree | No confirmed production secret found by these patterns. Candidate paths: `backend/.env.example`, `deploy/lan/env.example`, `docker-compose.yml`, tests/fixtures and helper scripts. | None confirmed. Review templates/fixtures for realistic values before release; keep actual secret files ignored and outside reports/artifacts. |
| Git history | Pattern matches in the same templates, tests, Docker Compose and historical vendored package docs/build output. No live credential was confirmed from path-only scan. | No rotation is indicated by this scan alone. If manual review or provider audit confirms a live value, revoke/rotate immediately and purge history under incident process. |
| Browser build | No env file values intentionally added. `VITE_*` values are public by design and must never contain secrets. | Recheck deployed asset output with automated secret scanner before each release. |

Limitations: a regular-expression scan cannot detect every secret encoding, low-entropy password, encrypted value, private certificate format or untracked local file. This was not a provider-side secret audit. Never use this result as evidence that credentials are uncompromised.
