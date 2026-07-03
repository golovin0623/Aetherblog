// Package anchoring — markdown → plaintext 近似器
//
// PR #724 review fix (Codex P1, markdown_carrier.go:112): 标注是从前端 MarkdownPreview
// 渲染后的 root.textContent 抽取的（去掉了 `#`、`**`、链接 URL 等 markdown syntax）；
// 但服务端 MigrateAnnotations 之前用 note.Content（**raw markdown**）作为锚定文本空间，
// 两个空间不对齐 → 标注 prefix/suffix 偏移漂移 → 错误 orphan 或定位到错重复子串。
//
// 本文件提供一个**近似**的 markdown→plaintext 转换，让服务端在重对齐前把 markdown
// 化简成与 react-markdown 默认渲染后 textContent 基本一致的字符串。
//
// 不追求完美（完美需要在 Go 端跑完整 markdown AST），而是覆盖标注锚定 5 个高频场景:
//   1. ATX 标头（#、##、...）
//   2. 强调（*、_、**、__）
//   3. 内联代码（`code`）
//   4. 链接/图片 [text](URL) / ![alt](URL) → 保留文字/alt
//   5. 块引用前缀 (`> `)
//   6. 列出标记 (- / * / 1.)
//   7. 围栏代码块 (````lang ... ```) → 保留内容行
//   8. HTML 标签 <tag attr="..."> → strip
//   9. horizontal rule (--- / ***) → 空行
//
// **不处理**: 表格 (|...|)、setext header (===)、HTML entity decode、嵌套 emphasis 复杂场景。
// 这些 edge case 在 anchoring 时会被 W3C TextQuoteSelector 的 prefix/suffix 配合
// diff-match-patch 容忍 —— 我们只需要 80% 一致。

package anchoring

import "regexp"

var (
	reHeader        = regexp.MustCompile(`(?m)^#{1,6}\s+`)
	reBoldItalic    = regexp.MustCompile(`(\*\*|__|\*|_)([^*_\n]+?)(\*\*|__|\*|_)`)
	reInlineCode    = regexp.MustCompile("`+([^`\\n]+?)`+")
	reImage         = regexp.MustCompile(`!\[([^\]]*?)\]\([^)]*?\)`)
	reLink          = regexp.MustCompile(`\[([^\]]+?)\]\([^)]*?\)`)
	reAutoLink      = regexp.MustCompile(`<(https?://[^>]+)>`)
	reBlockquote    = regexp.MustCompile(`(?m)^>\s?`)
	reListMarker    = regexp.MustCompile(`(?m)^(\s*)(?:[-*+]|\d+\.)\s+`)
	reHr            = regexp.MustCompile(`(?m)^\s*(?:-{3,}|\*{3,}|_{3,})\s*$`)
	reHTMLTag       = regexp.MustCompile(`<[^>]+>`)
	reFencedCode    = regexp.MustCompile("(?ms)```[^\\n]*\\n(.*?)```")
)

// MarkdownToPlaintext 把 markdown 源近似转为 react-markdown 渲染后的可视文本。
// 用于 MigrateAnnotations 让其锚定空间与前端创建标注时的空间对齐。
func MarkdownToPlaintext(md string) string {
	out := md

	// 1) 围栏代码块：保留代码内容
	out = reFencedCode.ReplaceAllStringFunc(out, func(s string) string {
		m := reFencedCode.FindStringSubmatch(s)
		if len(m) >= 2 {
			return m[1]
		}
		return ""
	})

	// 2）HTML标签
	out = reHTMLTag.ReplaceAllString(out, "")

	// 3) 自动链接 <https://...> → URL（react-markdown 默认显示 URL 文本）
	out = reAutoLink.ReplaceAllString(out, "$1")

	// 4) 图片 ![alt](url) → alt
	out = reImage.ReplaceAllString(out, "$1")

	// 5) 链接 [text](url) → text
	out = reLink.ReplaceAllString(out, "$1")

	// 6) 内联代码 `x` → x
	out = reInlineCode.ReplaceAllString(out, "$1")

	// 7) 加粗/斜体
	out = reBoldItalic.ReplaceAllString(out, "$2")

	// 8) 列表 marker
	out = reListMarker.ReplaceAllString(out, "$1")

	// 9) 块引用 prefix
	out = reBlockquote.ReplaceAllString(out, "")

	// 10) ATX 头`#`
	out = reHeader.ReplaceAllString(out, "")

	// 11) hr → 空行
	out = reHr.ReplaceAllString(out, "")

	return out
}
