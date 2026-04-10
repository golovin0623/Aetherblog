## 2025-02-12 - Pagination Focus Accessibility
**Learning:** Pagination controls (like previous/next buttons and page numbers) often rely entirely on hover states or `transition-colors` for interaction feedback, completely neglecting keyboard users who need clear `focus-visible` indicators.
**Action:** When implementing or reviewing pagination components, always ensure every interactive element includes comprehensive `focus-visible` utility classes (e.g., `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`). Additionally, explicitly use theme-aware background offset variables (like `var(--bg-primary)`) to ensure the focus ring contrasts correctly against dark and light modes.

## 2025-02-12 - Custom Carousel Navigation Accessibility
**Learning:** Custom interactive controls (like carousel arrows and pagination dots) often completely omit keyboard `focus-visible` styles and are frequently left with English default strings during development in non-English applications.
**Action:** When creating custom navigation controls, always add robust keyboard focus indicators (e.g., `focus-visible:ring-offset-1 focus-visible:ring-[var(--color-primary)]`), ensure `aria-label` attributes are localized to the site's primary language, and provide helpful `title` tooltips for sighted users.
