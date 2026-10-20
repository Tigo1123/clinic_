# Shifa frontend

This React application is the bilingual web client for Shifa, the Healthcare Facility Management
System. The configured institution names are served by the backend public configuration endpoint.
Set `FACILITY_NAME_AR` and `FACILITY_NAME_EN` in the deployment environment to brand the interface;
when either is unset, that language uses the Shifa product name.

Run `npm test`, `npm run lint`, and `npm run build` from this directory for local verification.
