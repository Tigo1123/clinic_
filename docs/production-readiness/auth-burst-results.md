# Managed staging authentication burst results

Status: **Not run.** No isolated managed staging deployment or disposable synthetic credentials were available. No production authentication endpoint or account was used.

| Burst | Result | Latency/errors | DB/pool/CPU | Shared limiter |
|---:|---|---|---|---|
| 50 | Not run | N/A | N/A | N/A |
| 100 | Not run | N/A | N/A | N/A |
| 250 | Not run | N/A | N/A | N/A |

Pass 2 locally verified atomic PostgreSQL rate-limit bucket state across independent Node workers, worker restart and expiry. It did not exercise full HTTP login/OTP/password-reset/MFA/admin-reset/registration routes through two backend instances. No live bcrypt CPU, event-loop, DB pool, failure behavior, or role-specific MFA lifecycle evidence is available. After staging exists, use disposable identities, safe verification/email sinks, two instances and correlated telemetry; verify both success and throttled responses without weakening existing controls. Do not use real staff credentials or send real messages.
