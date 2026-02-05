## 2025-02-03 - Form Accessibility Pattern
**Learning:** The existing admin login forms lacked explicit label associations (htmlFor/id) and accessible toggle states for passwords, making them difficult for screen reader users.
**Action:** Always verify form inputs have matching 'id' and 'htmlFor' attributes, and ensure icon-only toggle buttons use dynamic 'aria-label' to communicate state changes.

## 2025-02-04 - Pagination Accessibility Pattern
**Learning:** The previous pagination component was div-based and lacked semantic structure and ARIA labels, making navigation impossible for screen readers.
**Action:** Always wrap pagination in a `<nav aria-label="Pagination">` and ensure page controls (prev/next/numbers) have clear `aria-label` and `aria-current` attributes.

## 2025-05-20 - Motion and Current State in Toggles
**Learning:** Custom view toggles with animations (like sliding pills) can be disorienting for users with motion sensitivity and invisible to screen readers without semantic roles.
**Action:** Always add `motion-reduce:transition-none` to animated UI elements and use `aria-current="page"` (or appropriate value) to indicate the active state in navigation-like toggles.
