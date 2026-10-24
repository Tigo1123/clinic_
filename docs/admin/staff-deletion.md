# Staff account deletion

`DELETE /api/auth/users/:id` accepts a UUID and requires an active administrator.
It returns 204 when the account is removed from the directory. No schema migration is required.

Deletion is an irreversible tombstone, not a physical User-row deletion. Several existing history columns (`Invoice.createdBy`, `Payment.receivedBy`, `PaymentOperation.receivedBy`, `EmergencyOverride.authorizedById`, audit logs and notifications) contain scalar user IDs without foreign keys. An authorized request may already be in flight when deletion commits. Keeping the original UUID prevents that attribution from becoming orphaned. No clinical, financial or audit rows are cascade-deleted.

The service locks account administration and relevant User/Doctor rows, checks history, replaces username/password, clears email/phone and authentication artifacts, marks the account DELETED, disables an unused Doctor profile, increments authVersion and writes an administrator deletion audit in one transaction. The existing PostgreSQL authVersion notification and Socket.IO revocation mechanism invalidate active sessions. Deleted accounts are excluded from the staff directory and cannot be re-enabled or reset. Their old username may be used for a new, distinct account; old tokens still refer to the deleted UUID and remain invalid.

History blocks deletion with STAFF_HAS_HISTORY. Checks cover patient links/registration, issued claim codes, stock movements, refunds, invoice/payment ownership, emergency authorization, notifications, audit actor/target IDs, and doctor appointments, records, prescriptions, lab orders, recurring schedules, exceptions and legacy working hours. The frontend offers Disable Account for history-blocked active accounts. Authentication-only artifacts (MFA, verification challenges and external login links) are cleared only for an otherwise eligible deletion.

Self-deletion, the oldest administrator (ordered by createdAt then id), and the last active administrator are protected. Administrator status changes share the deletion lock and cannot disable the last active administrator. Unexpected deletion failures return a safe STAFF_DELETE_FAILED code and roll back all changes.
