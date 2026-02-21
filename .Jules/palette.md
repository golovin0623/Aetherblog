## 2025-05-21 - Section Header Accessibility
**Learning:** Collapsible sections using `div` elements with `onClick` handlers are inaccessible to keyboard users and screen readers.
**Action:** Always use `<button type="button">` for toggle headers, and include `aria-expanded` (state) and `aria-controls` (content ID) attributes to communicate the interaction model.

## 2025-05-22 - Interaction Focus Management
**Learning:** When dynamically showing a form (e.g. reply), scrolling into view is not enough; explicit focus is required, especially for keyboard users or when the form was already open but context changed.
**Action:** Use `ref.current.focus({ preventScroll: true })` after expansion/reveal animations complete to ensure user is ready to type immediately.

## 2026-02-18 - Form Validation Focus
**Learning:** Generic error messages like "Please fill all fields" are frustrating. Focusing the first invalid field immediately upon submission failure provides direct, actionable guidance.
**Action:** Use `useRef` to focus the specific invalid input field when manual validation fails, guiding the user to the exact point of error.

## 2026-06-08 - Keyboard Shortcuts
**Learning:** Adding common global shortcuts (like `Cmd+K` for search) instantly elevates the perception of a "pro" application.
**Action:** When implementing global search or command palettes, always include `Cmd+K` and `/` shortcuts, and ensure they are discoverable via tooltips or hints.

## 2026-02-19 - Semantic Navigation Links in Menus
**Learning:** Mobile menus often misuse `<button>` for navigation links, which breaks accessibility features like "open in new tab" and hurts SEO.
**Action:** Replace `<button onClick={navigate}>` with `next/link` components for semantic `<a>` tags while preserving UI state logic (like closing the menu) via `onClick`.
