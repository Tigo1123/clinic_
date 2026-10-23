# Managed staging edge security verification

Status: **Not performed — no staging HTTPS endpoint is configured.** No production endpoint was probed. Repository configuration review and local browser tests do not prove deployed response behavior.

| Check | Required evidence | Result |
|---|---|---|
| HTTPS certificate/redirect | Actual staging request, certificate chain/hostname and HTTP redirect | Not measured |
| HSTS | Actual HTTPS response from the declared edge owner; no localhost policy | Not measured |
| CSP | Actual policy header and browser console/report evidence | Not measured |
| X-Content-Type-Options | Actual response header | Not measured |
| Referrer-Policy | Actual response header | Not measured |
| Frame protection | CSP `frame-ancestors` or equivalent actual header | Not measured |
| CORS | Preflight and allowed/disallowed origin actual responses | Not measured |
| Compression | Actual `Content-Encoding` for eligible text assets | Not measured |
| Hashed static assets | Long-lived immutable cache header, content-hashed path | Not measured |
| HTML shell | Revalidation/no unsafe immutable cache | Not measured |
| Auth/PHI APIs | Authenticated representative responses carry private/no-store policy and bypass shared cache | Not measured |

After staging provisioning, capture redacted response headers for the frontend shell, one hashed asset, health/readiness, login response, patient history, doctor queue, billing response and an error response. Do not save bearer tokens or response bodies containing medical data. Test CDN cache status on repeat requests and prove no authenticated response is served to a second identity. HSTS must have exactly one owner (edge or Node) and must only be enabled on the staging HTTPS hostname during validation. Record TLS protocol/cipher and certificate expiry using standard safe tooling. No values are inferred from nginx configuration alone.
