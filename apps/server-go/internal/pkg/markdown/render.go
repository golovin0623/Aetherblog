// Package markdown 提供服务端 Markdown → 净化 HTML 的一次性渲染能力，
// 服务于「拟真阅读」模块：在导入时把来源内容渲染成自包含的成书 HTML 落库缓存，
// 之后前台阅读器直接注入该 HTML，无需在客户端重新解析 Markdown 或做语法高亮。
//
// 渲染链路：goldmark（GFM 扩展 + 自动标题 ID + chroma 内联高亮）→ bluemonday 净化。
// chroma 使用内联 style（WithClasses(false)），因此产出 HTML 不依赖任何外部 CSS，
// 满足「转换后的格式文件，下次点开不用重新处理和渲染」的要求。
package markdown

import (
	"bytes"
	"strings"
	"unicode"

	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
)

// Heading 表示一条目录条目，用于阅读器侧边章节导航。
type Heading struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Level int    `json:"level"`
}

// Result 是一次渲染的完整产物。
type Result struct {
	HTML        string    // 已净化、自包含的成书 HTML
	TOC         []Heading // 章节目录（h1-h3）
	WordCount   int       // 估算字数（CJK 按字、拉丁按词）
	ReadingTime int       // 估算阅读分钟数（向上取整，最小 1）
}

var md = goldmark.New(
	goldmark.WithExtensions(
		extension.GFM, // 表格 / 删除线 / 任务列表 / 自动链接
		extension.Footnote,
		highlighting.NewHighlighting(
			highlighting.WithStyle("github"),
			highlighting.WithFormatOptions(
				// 内联 style，使产物 HTML 自包含，不依赖外部高亮 CSS。
				chromahtml.WithClasses(false),
			),
		),
	),
	goldmark.WithParserOptions(
		parser.WithAutoHeadingID(),
	),
	goldmark.WithRendererOptions(
		html.WithUnsafe(), // 允许原始 HTML 透传，随后交给 bluemonday 净化
	),
)

// policy 是面向用户生成内容的净化策略，额外放行：
//   - 全局 id / class（标题锚点、对齐）
//   - span / pre / code / div 上的 style（chroma 内联高亮）
//   - 任务列表的 checkbox
var policy = buildPolicy()

func buildPolicy() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()
	p.AllowAttrs("id").Globally()
	p.AllowAttrs("class").Globally()
	p.AllowAttrs("style").OnElements("span", "pre", "code", "div", "p", "table", "th", "td")
	// 放行 GFM 任务列表渲染出的复选框。
	p.AllowAttrs("type", "checked", "disabled").OnElements("input")
	// 图片懒加载相关属性。
	p.AllowAttrs("loading", "decoding").OnElements("img")
	p.AllowAttrs("align").OnElements("td", "th")
	// 允许 data-* 锚点属性。
	p.AllowDataAttributes()
	return p
}

// Render 把 Markdown 源渲染为净化后的成书 HTML，并附带目录与字数统计。
func Render(source string) (Result, error) {
	src := []byte(source)
	doc := md.Parser().Parse(text.NewReader(src))

	var buf bytes.Buffer
	if err := md.Renderer().Render(&buf, src, doc); err != nil {
		return Result{}, err
	}
	clean := policy.SanitizeBytes(buf.Bytes())

	toc := extractTOC(doc, src)
	words := countWords(source)
	rt := words / 400 // 约 400 字/分钟（中英文混合的折中估算）
	if rt < 1 {
		rt = 1
	}

	return Result{
		HTML:        string(clean),
		TOC:         toc,
		WordCount:   words,
		ReadingTime: rt,
	}, nil
}

// extractTOC 遍历 AST，收集 h1-h3 标题及其自动生成的锚点 ID。
func extractTOC(doc ast.Node, src []byte) []Heading {
	var out []Heading
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		h, ok := n.(*ast.Heading)
		if !ok || h.Level > 3 {
			return ast.WalkContinue, nil
		}
		idAttr, has := h.AttributeString("id")
		id := ""
		if has {
			id = attrToString(idAttr)
		}
		out = append(out, Heading{
			ID:    id,
			Text:  string(h.Text(src)),
			Level: h.Level,
		})
		return ast.WalkSkipChildren, nil
	})
	if out == nil {
		out = []Heading{}
	}
	return out
}

func attrToString(v any) string {
	switch t := v.(type) {
	case []byte:
		return string(t)
	case string:
		return t
	default:
		return ""
	}
}

// countWords 估算字数：每个 CJK 字符计 1，连续的拉丁/数字串计 1 个词。
func countWords(s string) int {
	count := 0
	inWord := false
	for _, r := range s {
		switch {
		case isCJK(r):
			count++
			inWord = false
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			if !inWord {
				count++
				inWord = true
			}
		default:
			inWord = false
		}
	}
	return count
}

func isCJK(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) || // CJK 统一表意文字
		(r >= 0x3400 && r <= 0x4DBF) || // 扩展 A
		(r >= 0x3040 && r <= 0x30FF) || // 日文假名
		(r >= 0xAC00 && r <= 0xD7AF) // 韩文音节
}

// Excerpt 从纯文本/Markdown 生成简短摘要，去除多数 Markdown 标记。
func Excerpt(s string, max int) string {
	replacer := strings.NewReplacer("#", "", "*", "", "`", "", ">", "", "_", "")
	t := strings.TrimSpace(replacer.Replace(s))
	t = strings.Join(strings.Fields(t), " ")
	runes := []rune(t)
	if len(runes) <= max {
		return t
	}
	return string(runes[:max]) + "…"
}
