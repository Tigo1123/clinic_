# Clinic Pilot Account Register

Passwords, OTPs, MFA secrets and recovery codes must never be stored in this document.

Use approved placeholders until the clinic pilot owner assigns account identifiers through the secure account-management process. Do not add access tokens, reset links, database information, or patient information.

| Role | Display Name | Username/Email | Purpose | MFA Required? | Status | Owner | Notes |
|---|---|---|---|---|---|---|---|
| ADMIN | `[Pilot Admin]` | `[assigned separately]` | Pilot administration and staff support | Yes | `[Planned/Active/Inactive]` | `[Named owner]` | Use only for Admin tasks. |
| RECEPTIONIST | `[Pilot Reception]` | `[assigned separately]` | Registration, appointments, check-in, and billing | Per clinic policy | `[Planned/Active/Inactive]` | `[Named owner]` | Do not share across shifts. |
| DOCTOR | `[Pilot Doctor]` | `[assigned separately]` | Assigned consultations and prescriptions | Per clinic policy | `[Planned/Active/Inactive]` | `[Named owner]` | Link only to the intended doctor profile. |
| LAB_TECH | `[Pilot Laboratory]` | `[assigned separately]` | Laboratory processing and result release | Per clinic policy | `[Planned/Active/Inactive]` | `[Named owner]` | Laboratory workflow only. |
| PHARMACIST | `[Pilot Pharmacy]` | `[assigned separately]` | Formulary review, inventory, and dispensing | Per clinic policy | `[Planned/Active/Inactive]` | `[Named owner]` | Pharmacy workflow only. |
| PATIENT | `[Fictional Test Patient]` | `[assigned separately]` | Controlled self-service demonstration | Per clinic policy | `[Planned/Active/Inactive]` | `[Pilot test owner]` | Must not represent a real patient. |

## Register rules

- Assign one accountable owner per staff account.
- Deactivate accounts that are no longer needed.
- Record only the minimum operational identifier needed to identify the account.
- Transfer credentials only through the clinic's approved secure channel, never through this document.
- Report unfamiliar account changes immediately.
