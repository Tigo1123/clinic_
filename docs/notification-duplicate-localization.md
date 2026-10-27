# Notification Duplicate and Localization Fix

## Confirmed duplicate

An ACTIVE prescription containing a free-text medication created two durable Pharmacy notifications in the same transaction:

- `PRESCRIPTION_READY` from the Prescription insert trigger, keyed `Prescription:<prescriptionId>:<transactionId>`.
- `MEDICATION_REVIEW_REQUIRED` from the pending PrescribedDrug insert trigger, keyed `RX_REVIEW:<prescriptionId>`.

Because these were separate durable rows with different event keys, the existing `(userId,eventKey)` uniqueness and client ID-based merge could not suppress the semantic duplicate. This was a database trigger overlap, not duplicate Socket.IO delivery or a frontend append defect.

The migration defers the generic Prescription insert notice until commit. It emits that notice for ordinary formulary prescriptions, but skips it if a pending custom-medication review row exists. The specialized review event remains the sole Pharmacy notice for that prescription. Status updates retain their own transaction-scoped event keys.

## Arabic and English rendering

Known types continue to return bilingual fields. Unknown/legacy records now receive a safe generic Arabic title and message rather than reusing legacy English text. The dropdown chooses the localized fields at render time and uses localized fixed fallbacks; it does not display English compatibility `title`/`message` fields in Arabic mode. Switching locale rerenders the same notification record.

## Verification

- The focused notification backend test asserts one row, one socket delivery with the same durable ID, the event key/type/entity, and no generic duplicate for a custom prescription.
- The browser regression verifies one Pharmacy database row, one visible item, and an unread count increase of one for that action.
- Unknown/legacy DTO and Arabic UI tests verify no English fallback leak and correct English/Arabic rendering.
- The additive migration replays successfully with the existing migration chain. No Prisma model change is required.
- Authenticated socket handling, role rooms, revocation checks, and notification payload privacy are unchanged.
