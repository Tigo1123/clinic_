# Backup and recovery

## Current evidence

Repository has local Compose PostgreSQL volume and deployment recovery/backup scripts for LAN operation. The production database provider is Neon from prior release work, but this audit did not access Neon, its plan, PITR retention, backup schedule, restore points or credentials. No restore drill, application-file restore or disaster recovery exercise was run. A migration rollback is not generally equivalent to restore: many application migrations are forward-only; schema rollback can lose data.

## Proposed service objectives

- **Pilot target RPO:** at most 15 minutes of committed clinical/billing data. Confirm the selected managed database plan actually supports PITR at this granularity and document retention; otherwise revise the target or do not promise it.
- **Pilot target RTO:** 4 hours to restore service and verify access, including DNS/configuration, DB recovery and a minimal clinical workflow. This is a target, not a measured capability.
- Keep encrypted offsite configuration/export of deployment manifests, secrets references (not secret values), domain/DNS settings and migration release artifacts. Do not rely on a developer PC disk.
- Keep DB backups/PITR in provider-managed account plus separate access-controlled backup if policy/provider risk requires it. Protect backup credentials independently and test restores into an isolated account/project.

## Restore drill

Quarterly, restore to an isolated project, verify schema/migration history, counts and FK integrity, access controls, representative synthetic appointment/prescription/invoice workflow and encrypted file retrieval; measure elapsed restore time, data gap and human steps. Never restore over production during a drill. After emergency restore, rotate affected credentials only under incident policy and reconcile writes after recovery point.

## Migration rollback

Use a reviewed forward-fix for data-bearing migrations where possible. Before deployment capture provider-supported PITR point, freeze migration artifact/checksum and have named operator approve restore. Rehearse backward compatibility with old/new app versions. Destructive database restore requires a separate incident/change approval and reconciliation plan; no production rollback command is approved by this audit.

## Pass 2 local restore evidence

A disposable local logical snapshot was restored into a separate PostgreSQL database. Dump took 247 ms; restore took 605 ms for a 1,267,491-byte custom-format archive. Synthetic row checksums/counts, money aggregates, selected appointment timestamp bounds, all 27 migration checksums/statuses and 421 validated constraints reconciled; restored Prisma status was up to date and schema diff empty. See `restore-drill-results.md`.

This is not a provider PITR/offsite recovery measurement. Measured provider RTO and failure-time RPO remain unknown; prior ≤4-hour RTO and ≤15-minute RPO remain targets only. App HTTP startup/workflow after restore and configuration/object recovery were not verified.

## Pass 3 managed recovery status

No managed staging provider or backup configuration was available. No managed snapshot, PITR, restore-to-separate-database, row reconciliation, or application recovery was performed. Provider RTO/RPO remain unknown; the local 605 ms restore is not transferable. Before production decision, perform the synthetic managed restore drill in [managed-restore-results.md](managed-restore-results.md) and record observed recovery time and snapshot/data-loss window. Do not claim the documented ≤4-hour RTO / ≤15-minute RPO targets as achieved.
