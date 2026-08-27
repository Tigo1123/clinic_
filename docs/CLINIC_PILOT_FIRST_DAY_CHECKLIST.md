# Clinic Pilot First-Day Checklist

Use this checklist with approved pilot accounts and fictional or authorized pilot data only.

## Before opening

- [ ] Backend health is reachable through the approved pilot address.
- [ ] Frontend loads through the approved pilot address.
- [ ] One approved account for each participating role can log in.
- [ ] Test email delivery succeeds without exposing message contents in support logs.
- [ ] Doctor schedules and required reference data are present.
- [ ] Required laboratory tests are present and active.
- [ ] Required medicines and valid, non-expired inventory batches are present.
- [ ] Approved service and medicine prices are present.
- [ ] Demo/test accounts and data are clearly separated from clinic pilot use.
- [ ] Staff know how to report a blocker without sharing credentials or private health information.

## During the pilot

- [ ] Monitor repeated or unexpected failed logins.
- [ ] Record workflow blockers and the affected role/status.
- [ ] Watch for duplicate appointments or unexpected queue entries.
- [ ] Monitor stock discrepancies, expired batches, and unexpected movements.
- [ ] Monitor laboratory orders that cannot progress or results that cannot be released/reviewed.
- [ ] Monitor invoice, payment, duplicate-operation, and overpayment issues.
- [ ] Collect usability feedback from reception, doctors, laboratory, pharmacy, billing, and patients where appropriate.
- [ ] Escalate unexpected access or cross-patient information immediately.

## End of day

- [ ] Confirm there is no unresolved blocking patient workflow.
- [ ] Reconcile at least one representative medicine's physical/test balance against system stock and movements.
- [ ] Reconcile representative invoices and payments against the day's approved pilot activity.
- [ ] Review application errors and failed operations without copying secrets or clinical payloads.
- [ ] Review staff feedback and group similar issues.
- [ ] Record incidents, owners, urgency, and next actions.
- [ ] Confirm shared workstations are logged out.

## End-of-day sign-off

```text
Date:
Pilot lead:
Blocking incidents open: Yes/No
Stock discrepancy found: Yes/No
Payment discrepancy found: Yes/No
Unexpected access reported: Yes/No
Follow-up owner:
Notes (non-sensitive only):
```
