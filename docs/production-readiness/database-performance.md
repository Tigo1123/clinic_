# Database performance audit

## Evidence and boundaries

Prisma/PostgreSQL source inspection only; schema has 41 models and repository has 26 migrations. `npx prisma validate` passed. No connection to Neon/Render/staging, EXPLAIN/ANALYZE, table cardinality or production connection count was performed. Therefore index selectivity and query plans remain unknown. The existence of indexes is not evidence that current production predicates use them.

## Query risks

- **Unbounded admin billing analytics (`GET /api/billing/analytics`).** Loads every Payment and Refund with `findMany()`, every Doctor including all appointments, and every dispensed PrescribedDrug including Drug, then aggregates in Node. This work grows with lifetime data, consumes DB bandwidth and Node heap, and can monopolize event loop during aggregation.
- **Unbounded queues.** `GET /api/appointments/pending` returns all pending appointments with full patient and doctor relations. Doctor queue queries a full day with full patient relation. High patient volume increases row/payload size and may raise sensitive-data exposure. Neither endpoint applies cursor/page limit in inspected code.
- **Patient history.** Appointments, prescriptions, medical records and lab results use `findMany` ordered by date without explicit take/cursor; patient-specific but lifetime-unbounded.
- **Admin listings.** Admin doctors and auth users appear unbounded in inspected route code. Search routes are bounded and pharmacy formulary is paginated. Review other records queues for consistent hard limits.
- **Large row projections.** Some relations use full `include` rather than `select`, transferring fields not needed in UI. The appointments queues include complete Patient. Analytics pulls fields far beyond sums/counts that could be computed in SQL or a bounded aggregate.
- **Auth query rate.** Each protected request reads the active user/authVersion from PostgreSQL. Good for immediate revocation, but doubles DB work around busy clinical requests and contributes login/queue burst load.
- **Hot writes.** Appointment booking performs transactional slot checks/locking and relies on uniqueness, appropriate for correctness but susceptible to contention on popular time slots. Payment/refund paths contain retry/locking logic; idempotency under client retry needs dedicated fault test.
- **Indexes.** Existing indexes support date, doctor and patient appointment lookups, clinical histories, inventory and billing joins. Recent `20261022100000_patient_workflow_query_indexes` adds six patient-history indexes. Queue sort status/date and analytics aggregation still need actual plan/cardinality review. Avoid adding speculative indexes without `EXPLAIN (ANALYZE, BUFFERS)` on safe staging data and write-cost evaluation.

## Pool and concurrency estimate

One Prisma singleton per Node process is present. No explicit Prisma `connection_limit` / `pool_timeout` policy was verified in repo config. Effective Prisma v5 pool defaults and Neon connection mode depend on the runtime URL/engine and deploy environment; production URL, pooler and database limits were not inspected. A separate `pg.Client` direct listener is created per backend process for PostgreSQL LISTEN/NOTIFY. Readiness depends on this service. At 100 concurrent active requests, queue/analytics bursts and repeated auth lookups make pool wait a likely bottleneck if several replicas use direct URLs. At 500/1000, connections, unbounded query memory, Node heap and DB CPU are likely constraints; these are estimates, not load evidence.

Before traffic: document separate migration/runtime/listener roles; use Neon pooled runtime URL with measured connection limits where compatible, session-capable direct listener connection, explicit pool timeout, bounded request concurrency and DB statement timeout. Verify the production runtime role cannot create/drop/alter schema. Capture pool saturation and query histograms. Test 10/50/100 then stop on threshold breach.

## Pass 2 staging-database evidence — 22 October 2026

All 27 Prisma migrations replayed on empty disposable local PostgreSQL 18.6, including the shared rate-limit table. Migration status was clean and schema diff returned no difference. The database had 43 public tables, 106 indexes and 421 constraints. Synthetic fixture scale and the 12 representative `EXPLAIN ANALYZE` plans are in `database-query-plan-results.md`.

The most notable local plan was billing payments aggregation: sequential scan of 12,000 rows at 7.301 ms, warm local. Reception queue plan used the date/time index but considered roughly 10,200 candidates before bounded top-50 output; lab queue hashed/scanned orders, items and patients. These are not provider latency or concurrent-load measurements. No index was added from one warm sample.

The isolated runtime role lacked superuser/role/database creation and schema CREATE privileges; listener had no table DML; migrator owned the schema. Local server connection limit was 100, runtime login limit 40 and listener limit 5. No Neon pooler was available; rehearsal used direct local connections. Provider-specific pool utilization, CPU, query latency and grant verification remain required.

## Pass 3 managed database status

No managed staging database target was configured, so no provider connection, role/grant probe, migration, EXPLAIN, pool test or connection telemetry was run. Pass 2’s direct loopback PostgreSQL measurements (including local role limits) must not be interpreted as managed pooler behavior. Managed runtime/migrator/listener grants, connection cap, pool transaction semantics, DB CPU/query latency and lock behavior remain unknown. The existing production config has Neon-specific target checks; any non-Neon staging support needs a separately reviewed staging-only allowlist without relaxing production checks. See [managed-database-role-verification.md](managed-database-role-verification.md).
