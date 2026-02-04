# Sentinel's Journal

## 2026-02-03 - Unrestricted File Upload
**Vulnerability:** File upload functionality relied on `file.getContentType()` for classification but lacked validation, allowing upload of potentially malicious files (e.g., .jsp, .html).
**Learning:** Classification logic (e.g., assigning an icon or type) is not security validation. Always validate inputs against a strict allowlist.
**Prevention:** Implemented a strict file extension allowlist in `MediaServiceImpl` to reject any file type not explicitly permitted.
