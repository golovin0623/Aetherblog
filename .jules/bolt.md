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

## 2026-02-06 - [Optimizing Scroll Event Listeners]
**Learning:** Storing scroll position in `useState` inside a scroll event handler causes the component to re-render on every scroll event (frame). If this state is a dependency of `useEffect`, it forces the event listener to be detached and re-attached constantly, causing significant performance degradation.
**Action:** Use `useRef` to track mutable values like `lastScrollY` in event handlers. Only update state (e.g., `setIsVisible`) when the visual state actually changes to minimize re-renders and keep `useEffect` dependencies stable.

## 2026-02-07 - [Throttling Scroll with requestAnimationFrame]
**Learning:** High-frequency event listeners like `scroll` can fire faster than the screen refresh rate (60fps+). Executing complex logic (especially DOM updates) directly in the event handler blocks the main thread and causes jank.
**Action:** Always wrap scroll/resize logic in `requestAnimationFrame` to throttle updates to the browser's paint cycle, and use `useRef` to store the animation frame ID for cancellation.

## 2026-02-14 - [Layout Thrashing in IntersectionObserver]
**Learning:** Using `getBoundingClientRect()` inside an `IntersectionObserver` callback (or scroll handler) forces a synchronous reflow for every visible element, causing significant layout thrashing. This negates the performance benefits of using `IntersectionObserver`.
**Action:** Avoid querying DOM layout properties (like `top`, `height`) inside high-frequency callbacks. Instead, rely on `IntersectionObserverEntry` properties (which are read-only and don't trigger reflow) or pre-calculated/ordered data structures (like the `headings` array) to determine state.

## 2024-03-01 - React Synthetic Events and requestAnimationFrame
**Learning:** In high-frequency events (like `onMouseMove`), when using `requestAnimationFrame` to debounce, the `React.MouseEvent` object properties might become unavailable or change reference within the closure.
**Action:** Always extract values like `clientX`, `clientY`, and `currentTarget` from the synthetic event synchronously, *before* entering the asynchronous `requestAnimationFrame` callback.

## 2026-02-14 - [React Event Handler Re-renders in Profile Card]
**Learning:** Similar to the spotlight effects in `ArticleCard` and `FeaturedPost`, the `AuthorProfileCard` component was using `useState` (`setMousePosition`) during `onMouseMove` to track the mouse for a spotlight gradient effect. This triggers a full component re-render on every pixel of mouse movement, causing main-thread blocking and jank.
**Action:** Replace `useState` with `useRef` to directly manipulate the DOM (`spotlightRef.current.style.background`) for high-frequency interactions like spotlight effects. Always wrap these DOM updates in `requestAnimationFrame` to throttle them to the browser's paint cycle.


## 2026-02-14 - [Layout Thrashing in requestAnimationFrame]
**Learning:** Using `getBoundingClientRect()` inside a `requestAnimationFrame` callback forces a synchronous layout recalculation right when the browser is trying to render a frame. This defeats the purpose of throttling with rAF and causes layout thrashing, especially during high-frequency events like `mousemove`.
**Action:** Extract all layout-reading DOM APIs (like `getBoundingClientRect()`, `offsetWidth`, `clientHeight`) outside of the `requestAnimationFrame` closure. Compute derived layout values synchronously in the event handler and pass them into the `requestAnimationFrame` callback.

## 2026-03-05 - [Caching Layout Reads for High-Frequency Events]
**Learning:** Calling `getBoundingClientRect()` even outside of `requestAnimationFrame`, but still within a high-frequency event handler like `mousemove`, still causes significant performance overhead and potential layout thrashing because it forces the browser to calculate layout on every mouse movement.
**Action:** For interactive effects (like spotlights) that depend on mouse position relative to a component, cache the component's document offset (`rect.left + window.scrollX`) using `useRef` during low-frequency events (like `mouseenter`). Then, in the high-frequency `mousemove` handler, simply use `e.pageX` / `e.pageY` minus the cached offset to calculate the relative position, entirely avoiding `getBoundingClientRect()` during the interaction.
