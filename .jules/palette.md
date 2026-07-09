## 2025-03-05 - 替换原生 title 属性为 UI 库 Tooltip 组件
**Learning:** React/Next.js 侧边栏/悬浮组件中广泛使用的原生 `title` 属性存在默认延迟长、样式无法自定义、多平台表现不一致的问题，使用统一的 `<Tooltip>` 组件能显著提升响应速度与界面一致性。
**Action:** 在实现仅图标按钮时，避免直接依赖原生 `title`，优先使用 `@aetherblog/ui` 提供的 `<Tooltip>` 组件并正确设置 `aria-label`。同时确保移除包裹元素上的 `title` 属性，防止双重提示出现。
