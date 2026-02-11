## 2025-05-21 - Section Header Accessibility
**Learning:** Collapsible sections using `div` elements with `onClick` handlers are inaccessible to keyboard users and screen readers.
**Action:** Always use `<button type="button">` for toggle headers, and include `aria-expanded` (state) and `aria-controls` (content ID) attributes to communicate the interaction model.
