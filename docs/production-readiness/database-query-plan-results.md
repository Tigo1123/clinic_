# Database query-plan results

Environment: PostgreSQL 18.6, local synthetic-only `shifa_stage/public`. Ran `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for representative high-risk query shapes after fixture seeding. This is one warm local sample per query with shared reads at zero, not staging latency percentiles or cold-I/O evidence.

| Query shape | Actual execution | Plan evidence | Interpretation |
|---|---:|---|---|
| Billing payment aggregate | 7.301 ms | Sequential scan of 12,000 Payments | Most visible local cost; aggregate scans the fixture. Benchmark larger/date-bounded datasets before adding an index. |
| Billing refund aggregate | 0.916 ms | Sequential scan of 1,500 Refunds | Small table; no index decision justified. |
| Doctor queue | 1.446 ms | Partial active appointment index plus Patient primary-key lookup | Expected index use at 20k appointments. |
| Reception queue | 1.946 ms | Appointment date/time index; incremental sort; planner candidate set 10,200, bounded result 50 | Filter/order selectivity and row estimates deserve larger realistic staging test. |
| Patient history | 0.049 ms | `MedicalRecord_patientId_visitDate_idx` | Index used for patient/time lookup. |
| Admin user list | 0.062 ms | Sequential scan of 25 users | Too few rows to infer scale behavior. |
| Appointment list | 0.092 ms | Appointment date/time index and incremental sort | Small local cost. |
| Slot lookup | 0.047 ms | Partial active appointment index | Index used for active slot lookup. |
| Lab queue | 3.002 ms | Hash joins/scans of 1,000 LabOrder, 2,000 LabOrderItem and 5,000 Patient rows | Work grows with catalog/order cardinality; needs production-shaped filter and load measurements. |
| Formulary | 0.100 ms | Sequential scan of 100 DrugFormulary rows | Small reference list. |
| Patient invoice list | 0.090 ms | Invoice patient/date index | Index used. |
| Patient prescription history | 0.050 ms | Prescription patient/date index | Index used. |

No index was added: a single warm local plan is insufficient evidence of production benefit. No sort spill appeared in these plan outputs; no concurrent load, cold cache, production-like storage latency or provider CPU telemetry was available. Billing aggregation remains a likely DB work hotspot because it scans matching payments; use bounded time ranges/appropriate aggregate strategy only after profiling representative clinic history. Query script: `tests/production-readiness/run-query-plans.mjs`; raw result was kept outside the repository under `/tmp`.
