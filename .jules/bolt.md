## 2026-02-02 - [Broken Index & Composite Optimization]
**Learning:** Discovered `VisitRecord` used a property name (`createdAt`) in `@Index` instead of the column name (`created_at`), likely causing missing indexes. Also, analytics queries heavily filter on `is_bot`, making a simple timestamp index insufficient.
**Action:** Always verify `@Index` column names match database columns (not Java fields). Prefer composite indexes (Equality first, then Range) like `(is_bot, created_at)` for analytics tables with status flags.

## 2026-02-03 - [Fixing JPA Index Column Mismatches]
**Learning:** Discovered that JPA `@Index` annotations in `Post` and `Comment` entities were using Java field names (e.g., `publishedAt`) instead of database column names (e.g., `published_at`). This silently fails to create the intended indexes, leading to potential performance issues on critical sort/filter queries.
**Action:** When defining `@Index`, always verify that `columnList` matches the exact name defined in `@Column(name="...")`. Do not assume snake_case mapping happens automatically for index definitions if the entity field name is camelCase. Always verify against the `@Column` annotation.
