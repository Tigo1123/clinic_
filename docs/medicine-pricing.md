# Medicine pricing and activation

## Authoritative fields and currency

Medicine selling prices are stored in `DrugFormulary.unitPriceSdg`, a nullable
PostgreSQL `DECIMAL(65,30)` exposed by Prisma as `Decimal`. The existing application
contract accepts positive, whole SDG amounts from 1 through 1,000,000,000. It does
not accept fractional SDG, numeric strings, blank strings, null, or missing prices
on a pricing update. Blank prices remain valid only for unconfigured medicines
created by Pharmacy; saving a blank pricing draft is rejected, not converted to zero.

Admin sends `{ priceSdg: 1000, status: "ACTIVE" }` to
`PATCH /api/admin/pricing/medicines/:id`. The route maps `priceSdg` to
`unitPriceSdg` and writes the supplied status in one audited transaction.
`GET /api/admin/pricing` retains Prisma's existing Decimal string serialization;
the update response and Pharmacy endpoints retain their existing JSON number
serialization. These represent the same bounded whole-SDG value.

`ClinicalService.baseFeeSdg` / `baseFeeUsd` belong to services, not medicines.
Invoice items retain historical `unitPriceSdg` / `unitPriceUsd` snapshots, and
invoice conversion uses the existing exchange-rate rules. There is no
`DrugFormulary.unitPriceUsd`. This fix changes no currency field, conversion,
schema, API contract, or historical invoice.

## Activation rule

Pharmacy creates medicines with `status = INACTIVE` and `unitPriceSdg = null`.
Admin must supply a valid positive whole-SDG price when activating a medicine.
The pricing endpoint rejects an activation with missing, empty, null, malformed,
negative, zero, fractional, or excessive price with HTTP 422. It does not derive
or silently rewrite `ACTIVE` from the price. Omitting `status` on a valid price
update preserves the existing status; the Admin UI sends both fields.

Pharmacy reads the stored status and price directly. Billing requires both
`ACTIVE` and a configured valid price; valid stock is a separate requirement for
dispensing. A price update, its audit entry, and existing pending-invoice
reevaluation remain in their original transaction. An audit failure rolls the
update back and returns an error.

## Defect and correction

The shared Admin pricing table read `event.target.value` inside deferred React
state updaters and spread a row draft captured by the earlier render. A controlled
select can be restored to its previous value before a queued updater runs. A
second queued edit can also overwrite the first edit using that captured draft.
The resulting payload can therefore retain `INACTIVE` even though the user chose
`ACTIVE`; the backend correctly persists the submitted value. A staging response
containing a saved price and `INACTIVE` alone does not establish what was sent.
The regression test reproduces the stale-value path before the fix.

The controls now capture event values immediately and merge each patch into the
latest row draft. Saves have a synchronous per-row guard and disabled controls
while pending. Success replaces the row with the persisted response and clears
its draft. Errors retain the edit, show an accessible alert, and do not show a
success message. No client-side activation or Pharmacy display workaround is used.

## Verification

- `backend/test/medicine-pricing.test.js` uses real authenticated routes and an
  isolated PostgreSQL schema. It checks Pharmacy creation, price/status writes,
  changed timestamps, refreshed Admin/Pharmacy reads, Decimal serialization,
  invalid inputs, role denial, audit rollback, and unchanged stock, prescriptions,
  and historical invoice snapshots.
- `frontend/test/adminPricing.runtime.test.js` exercises the actual pricing
  components, including deferred control events, queued edits, duplicate clicks,
  pending state, failure/retry, persisted responses, reload, and invalid prices.
- `frontend/scripts/verify-medicine-pricing.mjs` runs the actual Admin and Pharmacy
  components in Chrome in English and Arabic. Its API forwarding uses a real
  isolated backend; it does not fabricate successful pricing responses.

Run backend tests through the guarded test runner with `TEST_DATABASE_URL` pointing
to an isolated loopback database named `clinic_test` and `TEST_DATABASE_PORT` set
to its port. Use UTF-8 encoding. The focused command is
`npm test -- test/medicine-pricing.test.js test/medicine-management.test.js` from
`backend/`. Run frontend tests with `npm test` from `frontend/`.

For browser verification, start Vite at `http://127.0.0.1:5187`, Chrome with remote
debugging port 9337, and a backend connected only to an isolated test schema. Set
`CLINIC_PRICING_API` to that backend's loopback origin and
`CLINIC_PRICING_SESSIONS` to a private JSON file containing
`{ "admin": { "user": { "id": "...", "role": "ADMIN" }, "token": "..." },
"pharmacy": { "user": { "id": "...", "role": "PHARMACIST" }, "token": "..." } }`
for synthetic test users. Run `node scripts/verify-medicine-pricing.mjs` from
`frontend/`. The script creates synthetic medicines and writes a report under
`/tmp/clinic-medicine-pricing-browser`; never point it at an operating clinic.
