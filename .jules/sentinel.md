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

## 2026-02-09 - Broken Access Control on Admin API
**Vulnerability:** Admin endpoints (`/v1/admin/**`) were accessible to any authenticated user (e.g. self-registered users) because `SecurityConfig` only checked `.authenticated()` without role validation.
**Learning:** Spring Security's `authenticated()` is insufficient for privileged routes; it only verifies identity, not authorization. Default "User" roles must not inherit Admin privileges.
**Prevention:** Explicitly restrict sensitive path patterns (like `/v1/admin/**`) to specific roles (e.g., `.hasRole("ADMIN")`) in the security filter chain.

## 2026-02-11 - IP Spoofing via X-Forwarded-For
**Vulnerability:** The application trusted the first IP in the `X-Forwarded-For` header for client IP resolution, allowing attackers to bypass IP-based rate limiting by injecting a spoofed IP.
**Learning:** `X-Forwarded-For` is a client-controlled header unless strictly managed by a trusted proxy chain. Taking the first IP is dangerous if the proxy appends to the header.
**Prevention:** Modified `IpUtils` to prioritize `X-Real-IP` (set by the trusted Nginx gateway) over `X-Forwarded-For`. Always rely on trusted headers from the immediate upstream proxy.

## 2026-02-14 - Inconsistent Security Implementation
**Vulnerability:** The `AuthController` manually implemented insecure IP resolution logic (`getClientIp`) instead of using the secure central utility `IpUtils`, re-introducing an IP spoofing vulnerability fixed elsewhere.
**Learning:** Security fixes in shared utilities (like `IpUtils`) are useless if consuming code re-implements the logic (incorrectly). "Not Invented Here" syndrome in security functions leads to regression.
**Prevention:** Audit codebase for redundant implementations of security critical functions (like IP resolution, sanitization) and enforce usage of the central, vetted utility.

## 2026-02-15 - Rate Limiting Race Condition
**Vulnerability:** The Redis rate limiter implementation used separate `incr` and `expire` commands, creating a race condition where a key could be incremented but fail to set an expiration, leading to permanent lockout or resource exhaustion.
**Learning:** Non-atomic operations in distributed systems (like Redis) can leave data in inconsistent states. "Check-then-Act" or "Act-then-Act" patterns are vulnerable.
**Prevention:** Use atomic operations like Lua scripts (`eval`) in Redis to ensure that rate limit counters are always created with an expiration in a single transaction.

## 2026-02-22 - Inconsistent Security Implementation in Public Comments
**Vulnerability:** `PublicCommentController` manually implemented insecure IP resolution (`getClientIp`), ignoring the secure `IpUtils` and re-introducing IP spoofing vulnerability.
**Learning:** Even with secure utilities available and previous fixes applied to `AuthController`, developers often copy-paste insecure patterns or miss updating all instances. Continuous auditing is required.
**Prevention:** Enforce usage of `IpUtils` across the entire codebase via static analysis or rigorous code reviews.

## 2026-02-25 - Unrestricted CSP on Uploaded Content
**Vulnerability:** Static resources served from `/uploads/**` inherited the global Content Security Policy, which allowed `unsafe-inline` scripts. This could enable Stored XSS via malicious file uploads (e.g., PDF, HTML if allowed).
**Learning:** Global security policies are often too permissive for user-generated content. A single CSP header cannot fit all use cases (app UI vs. untrusted uploads).
**Prevention:** Implemented a dedicated, high-priority `SecurityFilterChain` for `/uploads/**` that enforces a strict `sandbox` CSP, neutralizing scripts in served content.
