# Sudan state reference data

`sudan-states.json` is the state-only manifest for the guarded reference bootstrap command. It contains no clinical-service changes.

For a verified staging database, use the existing `npm run bootstrap:reference` command with its required `REFERENCE_BOOTSTRAP_*` environment guards. Run a dry run first, then a write only after confirming the expected staging database name. The bootstrap creates only missing canonical Sudan State IDs 1–18, is idempotent, and refuses conflicting rows. It does not delete or overwrite reference data.

This is an explicit operator action; it is not part of normal application startup and does not affect production automatically.

## Reviewed Neon specialty vocabulary (approval pending)

`production-specialties.sql` prepares the five existing repository specialty definitions independently of the general seed. It is not executed by startup or by the state bootstrap. It inserts only missing codes with fresh UUIDs; exact existing matches retain their IDs, labels, active flags and timestamps. Code/label conflicts or normalized-name collisions abort its transaction. The table lock serializes conflicting writes. No doctor, medicine, service, price, stock or operational record is created.

The [Neon release packet](../../docs/clinic-readiness/neon-production-release/approval-packet.md) contains the exact SQL, nine proposed reference rows (five specialties plus four payment methods in the migration), verified target, local tests and rollback. Execution requires explicit approval. The 18 canonical states already exist and need no initialization. Unsupported category/unit/dosage-form tables must not be invented as part of this bootstrap.

## Live Neon recovery

The canonical IDs and bilingual labels are `REFERENCE_BOOTSTRAP_STATES` in
`src/services/referenceBootstrap.js`. They match `prisma/seed.js` and the frontend
`SUDANESE_STATES` selection. ID 1 is Khartoum and is the registration default.
The JSON manifest selects **no ClinicalService changes**; the state rows come
from the canonical backend constant, not from the manifest filename.

Migrations create the State table without inserting its rows. Deployment and
ordinary server startup do not initialize these reference rows. Do not use
`npm run db:seed` to repair a live database: it also creates demo staff, doctors,
specialties, services, and medicine fixtures and is guarded against production.

From `backend/`, provide these values through the operator's environment or secret
manager without printing connection strings:

```text
REFERENCE_BOOTSTRAP_ENABLED=true
REFERENCE_BOOTSTRAP_ENVIRONMENT=production
REFERENCE_BOOTSTRAP_EXPECTED_DATABASE=<verified target database name>
REFERENCE_BOOTSTRAP_DATABASE_URL=<verified target connection secret>
REFERENCE_BOOTSTRAP_MANIFEST=reference-data/sudan-states.json
REFERENCE_BOOTSTRAP_PRODUCTION_CONFIRM=I_ACKNOWLEDGE_REFERENCE_DATA_PRODUCTION_WRITE
REFERENCE_BOOTSTRAP_DRY_RUN=true
```

Use the actual deployment environment if it is staging. The production phrase
enables the guard; it does not replace human approval for a live write.

1. Run `npm run bootstrap:reference` in dry-run mode. Review the database target,
   all missing state IDs and labels, and zero state/service conflicts. An empty
   State table should propose exactly 18 inserts, IDs 1–18, and zero services.
2. Obtain approval for those exact inserts before changing write mode.
3. Only after approval, set `REFERENCE_BOOTSTRAP_DRY_RUN=false` for that invocation
   and run the same command. It rechecks conflicts inside an advisory-locked
   transaction and inserts only missing rows. It never updates or deletes states
   and never changes user or patient records. Repeating it is a no-op once complete.
4. Return to dry-run mode and verify 18 existing canonical states, zero missing,
   zero conflicts, and default ID 1 present (or the configured DEFAULT_STATE_ID).
   A custom default outside the approved IDs needs separate configuration review.
5. Run local registration/onboarding integration suites on a disposable database.
   A live registration smoke test creates identity/patient data and requires
   separate explicit approval; do not create accounts as part of this repair.

The database-independent regression can run before any write approval:
`node --test test/state-reference-contract.test.js`. It verifies frontend payload
IDs, bilingual labels, default-state availability after bootstrap, repeatability,
partial initialization, conflict refusal, and a read-only dry run using an
in-memory substitute. Existing `reference-bootstrap.test.js` covers real database
transactions and rollback on an isolated local test database.
