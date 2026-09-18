# Staging demo staff

Run `node scripts/seed-staging-demo-staff.js` from `backend` as a standalone
administrative command. It does not invoke the general seed, load `.env`, migrate
the database, or use `DATABASE_URL`. Apply the existing migrations separately first.

Required environment variables:

- `DEPLOYMENT_ENV=staging`
- `DEMO_SEED_ENABLED=true`
- `DEMO_STAFF_DATABASE_URL`: explicitly verified staging PostgreSQL URL
- `DEMO_STAFF_CONFIRM_DATABASE`: exact database name in that URL
- `DEMO_STAFF_PASSWORD`: supplied through a secret manager or hidden prompt;
  existing password policy applies, with a 72-byte bcrypt limit

`NODE_ENV`, `DEPLOYMENT_ENV`, `APP_ENV`, and `ENVIRONMENT` must not identify
production. Production-looking database hosts/names are also refused. These
checks cannot detect a production database mislabeled as staging: verify the
host, port, database, and database role before running. Use staging-only credentials.
If staging runs with `NODE_ENV=production`, run this separate administrative process
with `NODE_ENV=staging`; do not change the application runtime configuration.
`CLINIC_TIME_ZONE` should match the staging application (default Africa/Khartoum).

Example Bash invocation after securely exporting the verified database URL and
confirmation name (neither is taken from the application's environment file):

```bash
cd backend
read -r -s -p 'Demo staff password: ' DEMO_STAFF_PASSWORD
printf '\n'
export DEMO_STAFF_PASSWORD
NODE_ENV=staging DEPLOYMENT_ENV=staging DEMO_SEED_ENABLED=true \
  node scripts/seed-staging-demo-staff.js
unset DEMO_STAFF_PASSWORD
```

The command prepares 13 active users: reception.demo, lab.demo, pharmacy.demo,
doctor.ortho1/2, doctor.dentist1/2, doctor.internal1/2, doctor.surgery1/2, and
doctor.neuro1/2, all at `cms.local`. Ten one-to-one Doctor profiles use the five
original specialties and the schedules listed in `staging-demo-staff.js`.
Schedules begin on the clinic-local execution date, have no end date, use
30-minute slots, and contain 21 weekday periods. New profiles use a nominal
100 SDG consultation fee; existing fees are preserved. Set appropriate demo
pricing through the existing administration API if needed.

Reruns reuse IDs and schedules, refresh demo passwords, clear forced password
change, and advance the authentication generation to invalidate old sessions.
Production password policy and login code are unchanged. Existing MFA enrollment
causes refusal; it is never disabled. Existing specialty labels are preserved.
Inactive/ambiguous specialties, conflicting account roles or doctor identities,
and nonmatching existing schedules cause an atomic rollback. Resolve such
conflicts through normal administration before retrying; the script never deletes
data. Existing exceptions and clinical records remain unchanged. Exceptions and
existing bookings can reduce available slots.

Success logs contain counts only, covering created or reused rows. Database
errors are intentionally sanitized to avoid disclosing credentials or hashes.
No admin account, patient, appointment, or clinical record is seeded by this command.

Validation (disposable localhost PostgreSQL 16 database only):

```bash
TEST_DATABASE_URL='postgresql://USER@127.0.0.1:PORT/clinic_demo_test' \
  npm test -- test/staging-demo-staff.test.js test/admin-doctor-management.test.js \
  test/admin-scheduling.test.js test/scheduling.test.js \
  test/seed-security.test.js test/password-policy.test.js
```

The test runner applies migrations and general test fixtures to a unique test
schema. Test passwords are generated in memory and never logged.

Five additional active specialties are created or reused without adding doctors:
PED — Pediatrics (الأطفال), OBG — Obstetrics & Gynecology (النساء والتوليد),
ENT — ENT (الأنف والأذن والحنجرة), DERM — Dermatology (الجلدية),
and OPH — Ophthalmology (العيون). Total: 10 specialties and 10 doctors.
These additions run only through this explicitly gated staging demo command.

## Safe specialty deletion

Admin specialty management supports DELETE `/api/specialties/:id`. Only new,
never-used specialties can be permanently deleted. Migration
`20260916000000_specialty_safe_deletion` conservatively protects all pre-existing
specialties because their full assignment history was not recorded. Database
triggers permanently protect new specialties once assigned, including legacy
name matches. Changing a doctor’s specialty does not clear protection.
Protected entries return 409 with guidance to deactivate instead; activation
and deactivation remain available. No clinical records or schedules are deleted.
