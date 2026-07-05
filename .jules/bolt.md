## 2024-05-24 - PostgreSQL Existence Check Optimization
**Learning:** Checking for row existence using `SELECT COUNT(*)` in PostgreSQL forces the database to perform a full index scan (or table scan) to count all matching rows, even though we only care if *one* exists.
**Action:** Always use `SELECT EXISTS(SELECT 1 ...)` for existence checks to allow the database engine to short-circuit and return immediately upon finding the first match.
