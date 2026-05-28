## 2025-05-28 - Wildcard Injection in LIKE Queries
**Vulnerability:** User inputs were concatenated with `%` directly into LIKE/ILIKE parameter formats (e.g. `"%"+keyword+"%"`), permitting unexpected wildcards (`%` and `_`) that bypass pattern-matching intentions and can cause excessive database load.
**Learning:** Even when parameterized queries (e.g., passing `$1`) prevent traditional SQL injection, inputs acting as pattern strings for LIKE or ILIKE operators need to have the special wildcard characters escaped to maintain control over the search pattern.
**Prevention:** In Go applications, always utilize the available utility `dbutil.EscapeLike(keyword)` to sanitize the keyword string prior to prepending or appending the intended wildcard characters (`%`).
