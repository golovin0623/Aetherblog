# Sentinel's Journal

## 2026-02-03 - Unrestricted File Upload
**Vulnerability:** File upload functionality relied on `file.getContentType()` for classification but lacked validation, allowing upload of potentially malicious files (e.g., .jsp, .html).
**Learning:** Classification logic (e.g., assigning an icon or type) is not security validation. Always validate inputs against a strict allowlist.
**Prevention:** Implemented a strict file extension allowlist in `MediaServiceImpl` to reject any file type not explicitly permitted.

## 2026-10-18 - Hardcoded Secrets in Source Code
**Vulnerability:** The `JwtService` and `JwtConfig` classes contained a hardcoded fallback JWT secret key directly in the Java source code, which would be silently used if the external configuration was missing.
**Learning:** Providing "convenient" default values for critical secrets in code creates a "Security Theater" where the application appears configurable but has a baked-in backdoor. It prevents "Fail Secure" behavior.
**Prevention:** Never provide default values for secrets in code. Force the application to fail startup if critical security configuration is missing.
