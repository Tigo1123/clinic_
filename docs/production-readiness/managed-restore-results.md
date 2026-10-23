# Managed staging restore results

Status: **Managed restore drill not run.** No managed staging database or provider backup configuration is available. No production backups were accessed.

Pass 2 local-only evidence: a synthetic local custom-format snapshot (1,267,491 bytes) dumped in 247 ms and restored to a separate disposable local database in 605 ms; reconciliation and app readiness succeeded. This is not managed-provider RTO/RPO evidence.

| Measure | Managed result |
|---|---|
| Backup/snapshot start and completion | Not measured |
| Restore to separate disposable DB | Not run |
| Row-count/checksum/relationship reconciliation | Not run |
| Migration status and app readiness | Not run |
| Measured RTO | Unknown |
| Provider/failure-window RPO capability | Unknown |

After provisioning, record the staging backup policy, retention and point-in-time granularity. Populate only synthetic data, capture deterministic counts/checksums, restore to a separate staging database, verify migrations/auth/critical relationships and a read-only readiness check, then measure total recovery time. Report the snapshot point and observed data-loss window. Do not generalize staging settings to production unless the production plan matches them.
