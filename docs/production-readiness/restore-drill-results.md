# Restore drill results

Environment: local loopback PostgreSQL 18.6; synthetic-only `shifa_stage` source and separate disposable `shifa_restore` target. No production backups were accessed.

- Custom-format `pg_dump`: **247 ms**, **1,267,491 bytes**.
- `pg_restore` to separate database: **605 ms** (after correcting the local passfile to include the target database; no password was emitted in output).
- Reconciliation: all sampled synthetic table counts and deterministic row checksums matched; payment/refund decimal sums and selected appointment created-time bounds matched; all 27 migration names/checksums/statuses matched; 421 constraints, zero unvalidated, no comparison mismatches.
- Restored-clone `prisma migrate status`: up to date. Schema diff: no difference detected.
- Application start/readiness: local test-mode backend using the restored synthetic clone returned `/api/health/ready` HTTP 200 in **951 ms**. The endpoint performed database and socket-listener readiness checks; no operational row was written by this smoke.
- Critical clinical workflow after restore was not replayed through HTTP; corresponding integration coverage passed against the isolated test database, not this restored clone.

| Synthetic table | Rows in source and restored clone |
|---|---:|
| User | 25 |
| Doctor | 20 |
| Patient | 5,000 |
| Appointment | 20,000 |
| MedicalRecord | 8,000 |
| Prescription / PrescribedDrug | 8,000 / 8,000 |
| DrugFormulary | 100 |
| ClinicalService | 1 |
| LabOrder / LabOrderItem | 2,000 / 2,000 |
| Invoice / InvoiceItem | 15,000 / 15,000 |
| Payment | 12,000 |
| Refund | 1,500 |
| InventoryBatch | 200 |
| State / PaymentMethod / Specialty | 18 / 4 / 5 |

Every listed table's deterministic synthetic-row checksum matched between source and restore. Payment aggregate matched at SDG 266,996,000.00 and USD 177,997.33; refund aggregate matched at SDG 1,492,500.00 and USD 994.95. The minimum/maximum selected appointment `createdAt` values also matched (2024-01-01T06:15:00Z and 2024-07-27T14:00:00Z).

This proves a same-host logical snapshot restore only. It does **not** measure provider PITR, off-site recovery, failure detection, DNS/config restoration, upload/object recovery, or human incident time. Therefore measured provider RTO and RPO remain **unknown**. Snapshot point data loss was zero relative to the captured dump; this is not a failure-time RPO. Prior target RPO ≤15 minutes and RTO ≤4 hours remain unverified targets, not promises.

Next drill: use a distinct staging account/project, time from declared incident to successful authenticated synthetic workflow, record last acknowledged write versus recovered point, include runtime configuration/files and edge routing, and retain evidence. Never restore over production in a rehearsal.
