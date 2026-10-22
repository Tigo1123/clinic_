# Existing Render data: migration preflight

The older Render database may contain the clinic's authoritative doctors, medicines, services and operational history. Neon must not be treated as an empty installation. No source connection, export, import or production write has been performed by this continuation.

The configuration migration is additive: existing service IDs remain unchanged with nullable codes; existing doctor hours, medicine identities, prices and financial rows are not rewritten. Do not assign new UUIDs, generate replacement catalog entries, rerun the general seed, or infer that similarly named records are the same entity.

Before proposing a transfer:

1. Identify the intended source and destination privately. Obtain read-only access to both, verify database/schema identities, and compare migration names/checksums and SQL-only constraints/triggers. Do not expose connection strings or patient rows in reports.
2. Inventory aggregate counts, key/FK coverage, duplicate identities/codes, historical payment/refund codes and catalog prices/statuses. Check legacy schedules and account/profile status inconsistencies without changing them. Unsupported payment codes require a reviewed mapping proposal; never rewrite financial history automatically.
3. Establish whether either database has independent newer records. If both do, stop before import and prepare an explicit conflict/identity reconciliation plan. Never overwrite destination rows based on names or matching timestamps alone.
4. Obtain an approved protected backup/export and restore it into an isolated local PostgreSQL database. Treat real patient data as confidential; restrict access, encryption and retention. The existing automated fixture suite accepts only the dedicated local test database and does not itself authorize restoring real records there.
5. Rehearse the exact pending migrations against that isolated restoration. Compare IDs, relationships, row counts and canonical row snapshots before/after, including doctors/hours, specialties, medicines/batches/ledger, service/lab catalogs, appointments, records, invoices, payments and refunds. Verify unchanged historical money and invoice descriptions. Local synthetic tests supplement this rehearsal; they cannot establish source compatibility.
6. Prepare the exact transfer mechanism, table ordering, conflict handling, downtime/cutover boundary, backup/recovery evidence and post-transfer checks. Keep legacy nullable service codes until clinic-approved configuration assigns them. Review existing schedules rather than erasing or replacing them.
7. Submit a separate approval packet naming source, destination, exact migrations and inserts/updates, preservation proof, rollback and cutover plan. Stop before any Neon migration or data write. The current schema packet does not authorize a Render transfer.

No executable import is provided because source schema, contents and authority have not been verified. The next step is a read-only source/destination inventory after access and targets are established, followed by the isolated rehearsal and explicit write approval.
