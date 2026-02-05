# Sentinel's Journal

## 2026-02-03 - Unrestricted File Upload
**Vulnerability:** File upload functionality relied on `file.getContentType()` for classification but lacked validation, allowing upload of potentially malicious files (e.g., .jsp, .html).
**Learning:** Classification logic (e.g., assigning an icon or type) is not security validation. Always validate inputs against a strict allowlist.
**Prevention:** Implemented a strict file extension allowlist in `MediaServiceImpl` to reject any file type not explicitly permitted.

## 2026-10-18 - Hardcoded Secrets in Source Code
**Vulnerability:** The `JwtService` and `JwtConfig` classes contained a hardcoded fallback JWT secret key directly in the Java source code, which would be silently used if the external configuration was missing.
**Learning:** Providing "convenient" default values for critical secrets in code creates a "Security Theater" where the application appears configurable but has a baked-in backdoor. It prevents "Fail Secure" behavior.
**Prevention:** Never provide default values for secrets in code. Force the application to fail startup if critical security configuration is missing.

## 2026-02-05 - Stored XSS via SVG Uploads
**Vulnerability:** The application allowed `svg` and `xml` file uploads without sanitization. SVG files can contain embedded JavaScript (`<script>`) which executes when viewed in a browser, leading to Stored XSS.
**Learning:** Standard image allowlists often include SVG, but SVG is an XML-based format that supports scripting. Treating it as a "safe image" without processing is dangerous.
**Prevention:** Removed `svg` and `xml` from `ALLOWED_EXTENSIONS` and `ALLOWED_IMAGE_TYPES`. For future SVG support, implement server-side sanitization (e.g., stripping scripts) or serve with `Content-Disposition: attachment`.
