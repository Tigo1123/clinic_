# Managed staging booking contention results

Status: **Not run.** No staging API/database or disposable synthetic slot set is available. No production booking or mutation was attempted.

| Measure | Result |
|---|---|
| Concurrent attempts | N/A |
| Unique confirmed booking per constrained slot | N/A |
| Conflict responses | N/A |
| Duplicate/retry behavior | N/A |
| Error count and p95 latency | N/A |
| Integrity reconciliation | N/A |

Once isolated staging exists, create a small deterministic set of synthetic patients and intentionally constrained synthetic slots. Synchronize requests across separate backend instances. Reconcile appointment rows and slot constraints after each run, verify exactly one valid booking per limited slot, and retry only with the same idempotency semantics as the application supports. Stop on unexpected duplicate confirmation, state corruption, or external side effect. No such evidence is claimed here.
