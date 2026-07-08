## 2024-07-08 - Fix Missing Theme CSS Variables in Focus Ring Offset

**Learning:** When using Tailwind's `focus-visible:ring-offset-[var(--name)]`, referencing non-existent CSS variables (like `--bg-leaf` or `--bg-void` which might exist in custom theme layers but not in the global stylesheet scope or represent deprecated names) causes the offset color to fall back gracefully but results in poor keyboard accessibility contrast on interactive elements.
**Action:** Always verify the existence of CSS variables in `globals.css` (e.g. `--bg-primary`, `--bg-secondary`, `--bg-card`) before using them in `ring-offset-[]` utility classes to ensure reliable focus ring indicators.
