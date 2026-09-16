# Sudan state reference data

`sudan-states.json` is the state-only manifest for the guarded reference bootstrap command. It contains no clinical-service changes.

For a verified staging database, use the existing `npm run bootstrap:reference` command with its required `REFERENCE_BOOTSTRAP_*` environment guards. Run a dry run first, then a write only after confirming the expected staging database name. The bootstrap creates only missing canonical Sudan State IDs 1–18, is idempotent, and refuses conflicting rows. It does not delete or overwrite reference data.

This is an explicit operator action; it is not part of normal application startup and does not affect production automatically.
