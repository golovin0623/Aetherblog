## 2026-02-02 - [Broken Index & Composite Optimization]
**Learning:** Discovered `VisitRecord` used a property name (`createdAt`) in `@Index` instead of the column name (`created_at`), likely causing missing indexes. Also, analytics queries heavily filter on `is_bot`, making a simple timestamp index insufficient.
**Action:** Always verify `@Index` column names match database columns (not Java fields). Prefer composite indexes (Equality first, then Range) like `(is_bot, created_at)` for analytics tables with status flags.
