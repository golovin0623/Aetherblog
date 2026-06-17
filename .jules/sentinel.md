## 2025-03-01 - Fix SQL Wildcard Injection
**Vulnerability:** Unescaped ILIKE queries in `qa_repo.go` where `title ILIKE "+ph("%"+kw+"%")"` allowed users to inject wildcards (`%` and `_`) leading to wildcard injection attacks that can cause expensive table scans (DoS risk).
**Learning:** Raw input strings concatenated directly with wildcards `%` before binding parameter can lead to injection vulnerabilities if the input string contains unescaped wildcards. The `ESCAPE '\'` clause should also be included explicitly to ensure consistent escaping semantics across different database engines and configurations.
**Prevention:** Always sanitize inputs with `dbutil.EscapeLike` before wrapping them in `%` wildcards for `LIKE` or `ILIKE` clauses, and explicitly append `ESCAPE '\'` to the query.
