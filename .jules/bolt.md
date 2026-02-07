## 2026-02-02 - [Broken Index & Composite Optimization]
**Learning:** Discovered `VisitRecord` used a property name (`createdAt`) in `@Index` instead of the column name (`created_at`), likely causing missing indexes. Also, analytics queries heavily filter on `is_bot`, making a simple timestamp index insufficient.
**Action:** Always verify `@Index` column names match database columns (not Java fields). Prefer composite indexes (Equality first, then Range) like `(is_bot, created_at)` for analytics tables with status flags.

## 2026-02-03 - [Fixing JPA Index Column Mismatches]
**Learning:** Discovered that JPA `@Index` annotations in `Post` and `Comment` entities were using Java field names (e.g., `publishedAt`) instead of database column names (e.g., `published_at`). This silently fails to create the intended indexes, leading to potential performance issues on critical sort/filter queries.
**Action:** When defining `@Index`, always verify that `columnList` matches the exact name defined in `@Column(name="...")`. Do not assume snake_case mapping happens automatically for index definitions if the entity field name is camelCase. Always verify against the `@Column` annotation.

## 2026-02-04 - [Global Batch Fetching]
**Learning:** Spring Data JPA's `default_batch_fetch_size` property is an effective "set and forget" solution for N+1 problems in ToMany relationships (like tags) and ToOne relationships (like category) when pagination is involved. It avoids the complexity and memory risks of `JOIN FETCH` with `Pageable`.
**Action:** Always enable `hibernate.default_batch_fetch_size` (e.g., 100) in `application.yml` for JPA projects to prevent silent N+1 performance degradation.

## 2026-02-05 - [React Event Handler Re-renders]
**Learning:** Attaching `onMouseMove` handlers that update component state (`useState`) triggers a full component re-render on every pixel of mouse movement. This causes significant main-thread blocking, especially in lists/grids.
**Action:** For high-frequency interactions like spotlight effects, use `useRef` to directly manipulate the DOM (e.g., `ref.current.style.background = ...`) to bypass the React render cycle entirely. Use `useState` only for low-frequency state changes (like `onMouseEnter`/`onMouseLeave`).
