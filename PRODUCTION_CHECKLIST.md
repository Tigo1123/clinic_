# Production deployment checklist

- [ ] Staging matches database engine, proxy, volumes, and verification behavior
- [ ] Independent JWT and medical-encryption secrets generated and stored securely
- [ ] Production SQLite and upload volumes are persistent, encrypted, writable, and monitored
- [ ] `CORS_ALLOWED_ORIGINS` contains only exact HTTPS frontend origins
- [ ] Email verification SMTP tested with an approved staging inbox
- [ ] SMS-dependent product expectations disabled or accepted (SMS is not production-ready)
- [ ] Database and uploads backed up together; isolated restore drill passes
- [ ] `prisma migrate deploy` succeeds against a backup-restorable staging copy
- [ ] HTTPS certificate, HSTS, proxy headers, 10 MB upload limit, and WebSocket upgrade verified
- [ ] `/api/health/live` and `/api/health/ready` pass without sensitive output
- [ ] SIGTERM shutdown and container restart complete cleanly
- [ ] Backend tests, frontend lint/build, Prisma validation/status, and dependency review pass
- [ ] Patient/staff login, doctor listing, availability, booking, reception visibility pass
- [ ] Socket connection, admin analytics, and attachment authorization pass
- [ ] Audit events and JSON request IDs are visible without clinical content or credentials
- [ ] Availability, errors, disk, SMTP, certificate, and backup heartbeat alerts are active
- [ ] Previous images, environment version, database backup, and upload backup are retained
