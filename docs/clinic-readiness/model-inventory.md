# Prisma model and relationship inventory

Repository schema: **40 models**. This is the intended repository structure, not proof of deployed Neon schema.

Scalar fields, defaults, indexes, and full relation annotations are recorded in `repository-inventory.json`.

| Model | Relations declared in Prisma |
|---|---|
| User | `mfaConfiguration` → MfaConfiguration (optional); `mfaRecoveryCodes` → MfaRecoveryCode (many); `mfaChallenges` → MfaChallenge (many); `doctor` → Doctor (optional); `patient` → Patient (optional); `externalIdentities` → UserExternalIdentity (many); `verificationChallenges` → VerificationChallenge (many); `issuedClaimCodes` → PatientClaimCode (many); `pendingPatientRegistration` → PatientRegistration (optional); `processedRefunds` → Refund (many); `stockMovements` → StockMovement (many) |
| State | `patients` → Patient (many) |
| Doctor | `user` → User (required); `specialty` → Specialty (optional); `appointments` → Appointment (many); `medicalRecords` → MedicalRecord (many); `prescriptions` → Prescription (many); `labOrders` → LabOrder (many); `schedules` → DoctorSchedule (many); `scheduleExceptions` → DoctorScheduleException (many) |
| DoctorSchedule | `doctor` → Doctor (required); `periods` → DoctorSchedulePeriod (many) |
| DoctorSchedulePeriod | `schedule` → DoctorSchedule (required); `breaks` → DoctorScheduleBreak (many) |
| DoctorScheduleBreak | `period` → DoctorSchedulePeriod (required) |
| DoctorScheduleException | `doctor` → Doctor (required); `periods` → DoctorScheduleExceptionPeriod (many) |
| DoctorScheduleExceptionPeriod | `exception` → DoctorScheduleException (required) |
| Specialty | `doctors` → Doctor (many) |
| Patient | `addressState` → State (required); `appointments` → Appointment (many); `medicalRecords` → MedicalRecord (many); `consents` → Consent (many); `prescriptions` → Prescription (many); `labOrders` → LabOrder (many); `invoices` → Invoice (many); `insuranceClaims` → InsuranceClaim (many); `user` → User (optional); `claimCodes` → PatientClaimCode (many) |
| Appointment | `patient` → Patient (required); `doctor` → Doctor (required); `medicalRecord` → MedicalRecord (optional); `emergencyOverride` → EmergencyOverride (optional); `invoices` → Invoice (many) |
| EmergencyOverride | `appointment` → Appointment (required) |
| MedicalRecord | `patient` → Patient (required); `doctor` → Doctor (required); `appointment` → Appointment (required); `prescriptions` → Prescription (many); `labOrders` → LabOrder (many) |
| Consent | `patient` → Patient (required) |
| Prescription | `medicalRecord` → MedicalRecord (required); `patient` → Patient (required); `doctor` → Doctor (required); `prescribedDrugs` → PrescribedDrug (many); `invoices` → Invoice (many) |
| DrugFormulary | `prescribedDrugs` → PrescribedDrug (many); `inventoryBatches` → InventoryBatch (many); `stockMovements` → StockMovement (many) |
| PrescribedDrug | `prescription` → Prescription (required); `drug` → DrugFormulary (optional) |
| InventoryBatch | `drug` → DrugFormulary (required); `stockMovements` → StockMovement (many) |
| StockMovement | `drug` → DrugFormulary (required); `inventoryBatch` → InventoryBatch (required); `actor` → User (optional) |
| ClinicalService | `labOrderItems` → LabOrderItem (many) |
| LabOrder | `medicalRecord` → MedicalRecord (required); `patient` → Patient (required); `doctor` → Doctor (required); `items` → LabOrderItem (many); `invoices` → Invoice (many) |
| UserExternalIdentity | `user` → User (required) |
| PendingExternalAuth | No Prisma relation (scalar identifiers only where applicable) |
| VerificationChallenge | `user` → User (required) |
| MfaConfiguration | `user` → User (required) |
| MfaRecoveryCode | `user` → User (required) |
| MfaChallenge | `user` → User (required) |
| PatientClaimCode | `patient` → Patient (required); `createdBy` → User (required) |
| PatientRegistration | `user` → User (required) |
| LabOrderItem | `labOrder` → LabOrder (required); `service` → ClinicalService (optional) |
| Invoice | `patient` → Patient (required); `appointment` → Appointment (optional); `labOrder` → LabOrder (optional); `prescription` → Prescription (optional); `insuranceClaim` → InsuranceClaim (optional); `items` → InvoiceItem (many); `payments` → Payment (many); `paymentOperations` → PaymentOperation (many); `refunds` → Refund (many) |
| InvoiceItem | `invoice` → Invoice (required) |
| Payment | `invoice` → Invoice (required); `paymentOperation` → PaymentOperation (optional) |
| PaymentOperation | `invoice` → Invoice (required); `payments` → Payment (many) |
| Refund | `invoice` → Invoice (required); `operator` → User (required) |
| InsuranceCompany | `claims` → InsuranceClaim (many) |
| InsuranceClaim | `insuranceCompany` → InsuranceCompany (required); `patient` → Patient (required); `invoice` → Invoice (optional) |
| NotificationLog | No Prisma relation (scalar identifiers only where applicable) |
| TenantAuditLog | No Prisma relation (scalar identifiers only where applicable) |
| Notification | No Prisma relation (scalar identifiers only where applicable) |

## Migration inventory

24 existing migrations were inspected; the 25th is the new, unapplied index migration. SQL-only checks, partial indexes and triggers are not fully represented in the Prisma model JSON.

| Migration | SHA-256 |
|---|---|
| 20260814182612_postgresql_baseline | `fdf7acea2a3c87a207b6b94a36b8501f170a024b92523ebcb57e81efdbafe3d1` |
| 20260815085729_custom_prescribed_medications | `255be79798a2977cc0ac3f9507b6bc888b2fbb1a654e80a7eb78a266491c5e5a` |
| 20260816072906_add_custom_lab_tests | `c40377c4af1977cc95d44b2d504ed66cf41d086abed5e2dceb36407823621eda` |
| 20260816180946_add_patient_blood_type | `d7b6c083e3cb4e0c36fe35c1fe5539e90626a4b2eec1c7c86b7058e4c9170892` |
| 20260818184717_consultation_payment_gate | `1a35003fd166a1b8f732b8f82c9485cebca43e292d8d148031e0e34103f350ef` |
| 20260819080000_link_lab_orders_to_invoices | `5ce2cf82a6600a85474080f22c6ca8cd9192fbff100b61a9ec5e20a05f872205` |
| 20260819092727_pharmacy_billing_foundation | `6ec10b4f0e803c62f05f41c9198ea75bbd9b61cc8b63ddb8209dc3418eee622e` |
| 20260819160937_pharmacy_medication_review | `c85dd82de9a8ba7136e626b570112ce1f52960d30e34a2af8d1be77ce8f113fa` |
| 20260820120000_lab_test_review | `4b79db12aab457660b2c213a2666dacfd25e9e68bf679337e6bc4a277219574b` |
| 20260821120000_staff_mfa_foundation | `cd3c04bae42945b0d269eafa9670ea62f517a8d1333348a1c96b0905f28ecdfc` |
| 20260822110000_access_token_generation | `0ec51c79702e713457c5d76e84690008654e7eb8f12a3a51123e941828593afa` |
| 20260823100000_socket_auth_revocation | `a99d8bba493ca9437569ad4aa637aac47895b437a1e49738440f935e0e7d35c5` |
| 20260823110000_pricing_management | `a8684b53f7db7f49b873b06bd7087a0efa0616b2331c5a2778dbfa9db49cd93b` |
| 20260823120000_lab_result_optimistic_concurrency | `0da7856cb865c114f0aa92e3d8c3534b8b8871938bcd765691c16ff88717caa7` |
| 20260825090000_medicine_management_phase1 | `c7384727e03e08ffe585d15d0961215b20c1e7c9ce879016af896c0db02a11b6` |
| 20260828100000_patient_file_number_foundation | `9c93bbd93fea32b8623f7403be659047829206446af98314a5bc82b55be0030b` |
| 20260914000000_verification_generation | `f3ac62477e0ac8c6cb420b7c5f4ac86e1c19d2c97690655716235042ca2ab951` |
| 20260914010000_offline_patient_activation | `d7258bb982e5edcf41353c0c991e2bdc6e06e323514a09636d3e2f5999cab56e` |
| 20260914100000_password_lifecycle | `5ab701e9cc47b883c630d1969e3d0ecab72d73fd897b5895cc4f205091067063` |
| 20260915000000_patient_identity_specialty_foundation | `af9a9e844f0224b61f465a29b3b315ca08998077f80f250efd53b960fa10a9eb` |
| 20260916000000_normalized_doctor_scheduling_foundation | `d89b3f4fdcceff0f8a0f49200ccd52f3b713fd53cf4a360dfdc8a1740860278b` |
| 20260916000000_specialty_safe_deletion | `b247db950b7858e7dfb5b48887952cc6d14d892d75ccfddc48d784a59b7337be` |
| 20260916120000_external_identity_foundation | `177d5340e1c852b1239f13ebd959c6c4437020da8acd25a0ce0fdf207abb2042` |
| 20260916213000_pending_external_auth_capability | `718e3f29f7fb5399b85ec03e39cf2c5311e8a22445927cad52e16ff2b680edc6` |
| 20261022100000_patient_workflow_query_indexes | `e22824191a81a9ea356c05fd33bb04b78426beace5bd0e2c7159eedf04319824` |
