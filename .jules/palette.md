
## 2024-05-15 - [TimelineTree accessibility]
**Learning:** Adding `aria-label` to icon-only buttons like toggle expansions, and ensuring interactive icons are wrapped in `<button type="button">` is essential for screen reader support and avoiding default form submits, especially in recursive components like TimelineTree.
**Action:** Always provide `aria-label` dynamically based on state when rendering toggle-able content.
