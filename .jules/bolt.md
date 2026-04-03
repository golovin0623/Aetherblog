## 2025-01-20 - Framer Motion Counter Optimization
**Learning:** React state-based animations for rapid number counters (like `useSpring` + `useTransform`) cause significant layout thrashing and lag.
**Action:** Use Framer Motion's `animate` function combined with a DOM node ref (`node.textContent = ...`) to bypass the React render cycle for high-frequency value updates.
