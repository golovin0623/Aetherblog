## 2025-02-03 - Form Accessibility Pattern
**Learning:** The existing admin login forms lacked explicit label associations (htmlFor/id) and accessible toggle states for passwords, making them difficult for screen reader users.
**Action:** Always verify form inputs have matching 'id' and 'htmlFor' attributes, and ensure icon-only toggle buttons use dynamic 'aria-label' to communicate state changes.
