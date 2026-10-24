# Sudan registration address repair

## Confirmed failure and model

A synthetic request to `https://clinic-staging-api.onrender.com/api/patient-auth/register` on 24 October 2026 submitted numeric `addressStateId: 10` and returned HTTP 422 with `error.code: INVALID_ADDRESS_STATE`. No pending account was created. In the deployed registration code this code is raised when `State.findUnique({ id: addressStateId })` returns no row. The repository Google completion path has the same lookup. The original Google 422 response body was not supplied; the normal-flow reproduction independently confirms the deployed reference lookup failure for ID 10.

Northern is a valid application state, canonical ID **10**. The frontend's static list offered it even when the deployed database did not contain it. Repository data is not missing Northern. Schema migration alone creates the State table; the established reference bootstrap populates it. The database's remaining state rows cannot be audited here without staging access; the check below reports all missing/conflicting canonical records.

The current application has **only a Sudanese State of Residence** (`State.id` integer; `Patient.addressStateId` foreign key). There is no address-country, locality, administrative-area or state-child table. The country selector in Contact controls phone dialing/normalization. It is not an address country and changing it must not silently change residence. No locality hierarchy, parent IDs, slugs or translated-label lookup has been introduced.

## Canonical dataset

The bootstrap, legacy seed and reception dataset contract tests require the same 18 IDs and bilingual labels. Northern's common names “Northern State / الولاية الشمالية” refer to the canonical Northern / الشمالية record; display text is not submitted as identity.

| ID | English | Arabic |
|---|---|---|
| 1 | Khartoum | الخرطوم |
| 2 | Gezira | الجزيرة |
| 3 | Red Sea | البحر الأحمر |
| 4 | Kassala | كسلا |
| 5 | Al Qadarif | القضارف |
| 6 | Sennar | سنار |
| 7 | Blue Nile | النيل الأزرق |
| 8 | White Nile | النيل الأبيض |
| 9 | River Nile | نهر النيل |
| 10 | Northern | الشمالية |
| 11 | West Kordofan | غرب كردفان |
| 12 | North Kordofan | شمال كردفان |
| 13 | South Kordofan | جنوب كردفان |
| 14 | North Darfur | شمال دارفور |
| 15 | West Darfur | غرب دارفور |
| 16 | South Darfur | جنوب دارفور |
| 17 | East Darfur | شرق دارفور |
| 18 | Central Darfur | وسط دارفور |

## Exact staging operator commands

Run from the repository root in the **staging service environment**, with its existing injected staging `DIRECT_URL` (preferred) and `DATABASE_URL`. Do not paste credentials into chat, command arguments or shell history. The reviewed build must contain this script; no deployment or staging database write was performed as part of this change.

For a staging service start that should repair references, deploy pending Prisma migrations, then start the API, use the combined package script:

```sh
npm --prefix backend run start:staging:repair-states
```

This runs the three checks/apply steps below and then `start:staging:migrate`, which applies pending migrations and starts the server. It therefore requires the staging migration role and the normal staging service environment; do not configure it as a production start command.

To repair and verify references without starting the server or applying migrations, run:

```sh
npm --prefix backend run repair:states:staging -- --check
npm --prefix backend run repair:states:staging -- --apply
npm --prefix backend run repair:states:staging -- --check
```

If the service shell starts in `backend/`, use `npm run repair:states:staging -- --check` (and `--apply`) instead.

The command is pinned to the staging Neon database already reviewed by the first-admin workflow: `ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech`, database `neondb`, schema `public`. Its pooler hostname is also accepted. It never selects a local `.env` fallback, accepts no target override, rejects production/unknown hosts, connection target overrides and alternate search paths, and enforces verified TLS. Run with the staging operator/reference-bootstrap database permissions; the command does not grant privileges.

`--check` is read-only and is the default. `--apply` reuses `runReferenceBootstrap` with a fixed state-only manifest: no clinical services, demonstration users or sample patients. It inserts only missing canonical State rows inside the existing advisory-locked transaction. It never updates/renumbers/deletes existing states, patients or unrelated records. Repeating it is a no-op once complete.

Conflicting IDs or duplicate canonical labels (including normalized whitespace/case/Unicode forms) abort before inserts. The report identifies the conflicts. Do not renumber patient addresses, overwrite labels, delete rows or run the demo seed to bypass a conflict. Reconcile the actual identity with the operator first. Additional nonconflicting reference rows remain unchanged.

The final check must show expected=18, all IDs 1–18 existing, missing=[], conflicts=[]. After the reviewed code is deployed, GET `/api/patient-auth/address-states` must report `complete: true`, with Northern ID 10 exactly once. Repeat Google and email registration with synthetic identities and verify the final Patient uses addressStateId 10. Staging repair execution and post-repair live Google completion remain operator steps because no staging database credentials or Google session were available here.

## Application guards

Registration now fetches actual backend state options instead of advertising static unavailable IDs. It clears a selection removed by a reload, disables submission while references are unavailable, and rechecks the ID immediately before either registration POST. The backend shares ID resolution across Google, normal registration and finalization, with safe ADDRESS_STATE_INVALID / ADDRESS_STATE_NOT_FOUND / ADDRESS_SELECTION_STALE codes. A transaction-level key-share lock protects Patient creation from concurrent state deletion. Legacy INVALID_ADDRESS_STATE responses remain localized for rollout compatibility.

COOP was audited separately. The staging API public response has `Cross-Origin-Opener-Policy: same-origin`; the observed staging frontend document response returned 200 without an explicit COOP/COEP header; the Google callback reached registration and the reproduced 422 is a database reference validation failure. The popup warning does not explain this 422. No security header or OAuth configuration was weakened, and unrelated popup behavior is not claimed to have been live-tested.
