# Clinic Pilot Account Register

Passwords, OTPs, MFA secrets and recovery codes must never be stored in this document.

Use approved placeholders until the clinic pilot owner assigns account identifiers through the secure account-management process. Do not add access tokens, reset links, database information, or patient information.

| Role | Display Name | Username/Email | Purpose | MFA Required? | Status | Owner | Notes |
|---|---|---|---|---|---|---|---|
| ADMIN | `Pilot Administrator` | `[assigned separately]` | Pilot administration and staff support | Yes | `[Planned/Active/Inactive]` | `[Named owner]` | Confirm MFA and Admin-only use before demo. |
| RECEPTIONIST | `Pilot Receptionist` | `[assigned separately]` | Registration, appointments, check-in, and billing | Recommended | `[Planned/Active/Inactive]` | `[Named owner]` | Confirm reception and billing access; do not share across shifts. |
| DOCTOR | `Dr. Demo General` | `[assigned separately]` | Assigned consultations and prescriptions | Recommended | `[Planned/Active/Inactive]` | `[Named owner]` | Confirm doctor profile, schedule, fee, and assignment. |
| LAB_TECH | `Pilot Laboratory Technician` | `[assigned separately]` | Laboratory processing and result release | Recommended | `[Planned/Active/Inactive]` | `[Named owner]` | Confirm laboratory queue and result actions. |
| PHARMACIST | `Pilot Pharmacist` | `[assigned separately]` | Formulary review, inventory, billing, and dispensing | Recommended | `[Planned/Active/Inactive]` | `[Named owner]` | Confirm pharmacy invoice, stock, and dispensing access. |
| PATIENT | `Demo Patient Alpha` | `[assigned separately]` | Controlled self-service demonstration | Not applicable | `[Planned/Active/Inactive]` | `[Pilot test owner]` | Must use normal patient registration and remain entirely fictional. |

## Register rules

- Assign one accountable owner per staff account.
- Deactivate accounts that are no longer needed.
- Record only the minimum operational identifier needed to identify the account.
- Transfer credentials only through the clinic's approved secure channel, never through this document.
- Report unfamiliar account changes immediately.
