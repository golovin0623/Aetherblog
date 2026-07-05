## 2025-07-05 - Missing ESCAPE clause for ILIKE queries
**Vulnerability:** Wildcard injection in ILIKE queries where dbutil.EscapeLike was used without the explicit ESCAPE clause.
**Learning:** PostgreSQL 17+ or specific configurations might require an explicit ESCAPE clause for custom escape sequences (like backslash) to work reliably with dbutil.EscapeLike, otherwise the escaping is ineffective and allows wildcard injection.
**Prevention:** Always append `ESCAPE '` to ILIKE queries when using dbutil.EscapeLike.
