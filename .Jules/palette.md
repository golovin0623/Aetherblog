## 2025-05-21 - Section Header Accessibility
**Learning:** Collapsible sections using `div` elements with `onClick` handlers are inaccessible to keyboard users and screen readers.
**Action:** Always use `<button type="button">` for toggle headers, and include `aria-expanded` (state) and `aria-controls` (content ID) attributes to communicate the interaction model.

## 2025-05-22 - Interaction Focus Management
**Learning:** When dynamically showing a form (e.g. reply), scrolling into view is not enough; explicit focus is required, especially for keyboard users or when the form was already open but context changed.
**Action:** Use `ref.current.focus({ preventScroll: true })` after expansion/reveal animations complete to ensure user is ready to type immediately.
