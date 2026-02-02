# Sentinel's Journal

## 2026-02-02 - Secure Configuration Management
**Vulnerability:** Hardcoded secrets (DB password, JWT secret) were present as default values in the main `application.yml` file.
**Learning:** Spring Boot's property override mechanism allows clean separation of insecure dev defaults (`application-dev.yml`) from production config (`application.yml` + Env Vars). This ensures "Fail Secure" behavior in production (app fails to start if secrets are missing) while maintaining "Zero Config" convenience for local development.
**Prevention:** Always use placeholders (e.g., `${DB_PASSWORD}`) in the main `application.yml` and provide insecure defaults ONLY in a profile-specific file like `application-dev.yml`.
