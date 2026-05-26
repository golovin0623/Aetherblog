// Package anchoring 是 Atlas 标注稳定锚定算法的实现位置。
//
// Phase 0 占位包，Phase 1 引入实际算法：
//   - W3C 多选择器 (TextQuote + TextPosition + 载体专属) 解析与构建
//   - Hypothes.is 风格 robust anchoring：位置 → 上下文模糊匹配 (diff-match-patch
//     的 Bitap) → Myers diff 距离阈值 → 向量相似度兜底
//   - Y.RelativePosition 编解码（D1=Tiptap 才上）
//
// 红线：当前 Atlas 不存在锚定算法实现，所有 anchor_state/score 仍为默认 1.0。
package anchoring
