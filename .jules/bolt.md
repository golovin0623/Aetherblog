## 2025-01-20 - Framer Motion Counter Optimization
**Learning:** React state-based animations for rapid number counters (like `useSpring` + `useTransform`) cause significant layout thrashing and lag.
**Action:** Use Framer Motion's `animate` function combined with a DOM node ref (`node.textContent = ...`) to bypass the React render cycle for high-frequency value updates.
## 2025-01-20 - Editor Scroll Performance Optimization
**Learning:** Measuring the DOM (e.g., `view.coordsAtPos()`) synchronously inside high-frequency event listeners like `scroll` causes significant layout thrashing.
**Action:** Always throttle these operations using `requestAnimationFrame` to ensure DOM reads are aligned with the browser's render cycle, avoiding unnecessary synchronous style recalculations.
