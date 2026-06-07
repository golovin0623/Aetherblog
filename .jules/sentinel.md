## 2024-05-31 - URL Encoded Path Traversal Bypass via `EscapedPath`

**Vulnerability:**
The `ProxyProviders` and `ProxyProfiles` functions in Echo API proxy handlers (`apps/server-go/internal/handler/ai_handler.go` and `search_handler.go`) used `c.Request().URL.EscapedPath()` combined with `strings.TrimPrefix()` to extract wildcard path parameters. This was designed to prevent Echo's automatic URL-decoding (`c.Param("*")`) from altering raw API routes and allowing bypassing of validation. However, this approach creates an inconsistency where `TrimPrefix` on an escaped string may misalign with the routing prefix or bypass traversal checks. Echo explicitly decodes `c.Param()` for parameter normalization but retains raw URL query bindings differently.

**Learning:**
According to codebase memory constraints: "In Go/Echo reverse proxy handlers (like `AiHandler.ProxyProviders`), using `path.Clean()` or manually extracting sub-paths via `c.Request().URL.EscapedPath()` combined with `strings.TrimPrefix()` are anti-patterns that can lead to routing inconsistencies or WAF bypasses. Instead, use `c.Param("*")` (which preserves encoding in Echo 4.x)." In Echo 4.x, the wildcard path parameter correctly holds the path while maintaining necessary routing safety that is decoupled from manual string suffix/prefix manipulation that is prone to edge-case bugs and traversal loopholes.

**Prevention:**
Always use `c.Param("*")` to extract wildcard sub-paths in Echo 4 reverse proxy setups. Since `c.Param("*")` omits the leading slash, conditionally prepend it (`if param != "" { subPath = "/" + param }`) and validate against traversal sequences, avoiding manual `EscapedPath` combined with `TrimPrefix` text operations that bypass routing security guarantees.
