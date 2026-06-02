package service

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

const recallCorpusOriginal = `# Atlas R1 Corpus

Aether Atlas 把标注和知识点分开：标注只是出处，知识点才是用户综合后的判断。
关系自身也需要证据，否则图谱会退化为无来源的断言。
Typed relation 必须是 supports, refutes, specializes, generalizes, precedes, causes, similar_to, cites, instance_of 之一。

## Local First

CRDT 🔒 本地优先让私有知识可以离线编辑，再通过受控同步进入多端视图。
Reader 重新打开时必须把 W3C TextQuoteSelector 和 TextPositionSelector 一起用于重定位。

## AetherHub

AetherHub 回答只能引用用户选择或系统召回的 KP，并在答案里保留 [KP #id] 与 evidence 标记。
AI 建议必须先进入 Inbox，用户接受后才可以写入知识图谱。
`

var recallAnchorTexts = []string{
	"标注只是出处，知识点才是用户综合后的判断",
	"关系自身也需要证据，否则图谱会退化为无来源的断言",
	"supports, refutes, specializes, generalizes",
	"CRDT 🔒 本地优先让私有知识可以离线编辑",
	"W3C TextQuoteSelector 和 TextPositionSelector 一起用于重定位",
	"用户接受后才可以写入知识图谱",
}

const pdfRecallPageBreak = "\n\f\n"

const pdfRecallCorpusOriginal = "PDF Reader 把页面文本层作为锚定空间，页面坐标只作为跳回原文的辅助信息。" +
	pdfRecallPageBreak +
	"页码和矩形只负责跳回视口；TextQuoteSelector 负责跨版本召回。" +
	pdfRecallPageBreak +
	"OCR 修正可能改变空格和标点，因此 prefix 与滑窗匹配必须保留。" +
	pdfRecallPageBreak +
	"关系证据必须能跳回 PDF 页面的原位置，方便用户审计关系为什么成立。" +
	pdfRecallPageBreak +
	"删除的段落应该进入 orphan 状态，而不是伪装成低置信度命中。"

var pdfRecallAnchorTexts = []string{
	"PDF Reader 把页面文本层作为锚定空间",
	"页面坐标只作为跳回原文的辅助信息",
	"TextQuoteSelector 负责跨版本召回",
	"OCR 修正可能改变空格和标点",
	"关系证据必须能跳回 PDF 页面的原位置",
	"删除的段落应该进入 orphan 状态",
}

func TestRelocateMarkdownRecallCorpus(t *testing.T) {
	type recallCase struct {
		name       string
		text       string
		anchorable []string
		orphan     []string
	}
	tests := []recallCase{
		{
			name:       "prepend-intro",
			text:       "> 版本迁移：新增导言不会破坏旧标注。\n\n" + recallCorpusOriginal,
			anchorable: recallAnchorTexts,
		},
		{
			name:       "append-section-and-minor-copyedit",
			text:       strings.Replace(recallCorpusOriginal, "无来源的断言", "缺来源的断言", 1) + "\n## Review\n\n新增复习段落不会改变既有锚点。",
			anchorable: recallAnchorTexts,
		},
		{
			name: "heading-rename-and-paragraph-insert",
			text: strings.Replace(
				strings.Replace(recallCorpusOriginal, "## Local First", "## Local-first Notes", 1),
				"Reader 重新打开时必须",
				"新增一段上下文。\n\nReader 重新打开时必须",
				1,
			),
			anchorable: recallAnchorTexts,
		},
		{
			name: "intentional-orphan",
			text: strings.Replace(
				recallCorpusOriginal,
				"AI 建议必须先进入 Inbox，用户接受后才可以写入知识图谱。",
				"AI 建议被删除后应该进入 orphan 状态。",
				1,
			),
			anchorable: recallAnchorTexts[:5],
			orphan:     []string{"用户接受后才可以写入知识图谱"},
		},
	}

	total := 0
	recalled := 0
	for _, tt := range tests {
		for _, exact := range tt.anchorable {
			state, score := relocate(tt.text, selectorsForRecallAnchor(t, recallCorpusOriginal, exact))
			total++
			if state == "anchored" || state == "soft_anchored" {
				recalled++
				continue
			}
			t.Fatalf("%s failed to recall %q: state=%s score=%.3f", tt.name, exact, state, score)
		}
		for _, exact := range tt.orphan {
			state, score := relocate(tt.text, selectorsForRecallAnchor(t, recallCorpusOriginal, exact))
			if state != "orphan" {
				t.Fatalf("%s expected orphan for %q, got state=%s score=%.3f", tt.name, exact, state, score)
			}
		}
	}

	recall := float64(recalled) / float64(total)
	if recall < 0.9 {
		t.Fatalf("recall = %.2f, want >= 0.90", recall)
	}
}

func TestRelocatePDFTextLayerRecallCorpus(t *testing.T) {
	type recallCase struct {
		name       string
		text       string
		anchorable []string
		orphan     []string
	}
	tests := []recallCase{
		{
			name:       "cover-page-insert",
			text:       "封面\n\nAether Atlas PDF 版本迁移测试。" + pdfRecallPageBreak + pdfRecallCorpusOriginal,
			anchorable: pdfRecallAnchorTexts,
		},
		{
			name:       "ocr-punctuation-copyedit",
			text:       strings.Replace(pdfRecallCorpusOriginal, "OCR 修正可能改变空格和标点", "OCR 修正可能改变空格、标点", 1),
			anchorable: pdfRecallAnchorTexts,
		},
		{
			name: "page-note-insert",
			text: strings.Replace(
				pdfRecallCorpusOriginal,
				"关系证据必须能跳回 PDF 页面的原位置",
				"页脚说明：本页来自重新导出的 PDF。\n关系证据必须能跳回 PDF 页面的原位置",
				1,
			),
			anchorable: pdfRecallAnchorTexts,
		},
		{
			name: "intentional-orphan",
			text: strings.Replace(
				pdfRecallCorpusOriginal,
				"删除的段落应该进入 orphan 状态，而不是伪装成低置信度命中。",
				"该页内容被作者重写，旧段落已经不存在。",
				1,
			),
			anchorable: pdfRecallAnchorTexts[:5],
			orphan:     []string{"删除的段落应该进入 orphan 状态"},
		},
	}

	total := 0
	recalled := 0
	for _, tt := range tests {
		for _, exact := range tt.anchorable {
			state, score := relocate(tt.text, selectorsForPDFRecallAnchor(t, pdfRecallCorpusOriginal, exact))
			total++
			if state == "anchored" || state == "soft_anchored" {
				recalled++
				continue
			}
			t.Fatalf("%s failed to recall %q: state=%s score=%.3f", tt.name, exact, state, score)
		}
		for _, exact := range tt.orphan {
			state, score := relocate(tt.text, selectorsForPDFRecallAnchor(t, pdfRecallCorpusOriginal, exact))
			if state != "orphan" {
				t.Fatalf("%s expected orphan for %q, got state=%s score=%.3f", tt.name, exact, state, score)
			}
		}
	}

	recall := float64(recalled) / float64(total)
	if recall < 0.9 {
		t.Fatalf("recall = %.2f, want >= 0.90", recall)
	}
}

func selectorsForRecallAnchor(t *testing.T, text string, exact string) []byte {
	return selectorsForRecallAnchorWithTail(t, text, exact, map[string]any{
		"type":  "CssSelector",
		"value": "[data-atlas-reader]",
	})
}

func selectorsForPDFRecallAnchor(t *testing.T, text string, exact string) []byte {
	startByte := strings.Index(text, exact)
	if startByte < 0 {
		t.Fatalf("anchor text not found: %s", exact)
	}
	page := 1 + strings.Count(text[:startByte], pdfRecallPageBreak)
	return selectorsForRecallAnchorWithTail(t, text, exact, map[string]any{
		"type":       "FragmentSelector",
		"conformsTo": "https://aetherblog.local/atlas/pdf-text-layer",
		"value":      "page=" + strconv.Itoa(page) + "&rect=0,0,100,12",
		"page":       page,
		"rects": []map[string]any{
			{"x": 0, "y": 0, "width": 100, "height": 12},
		},
	})
}

func selectorsForRecallAnchorWithTail(t *testing.T, text string, exact string, tail map[string]any) []byte {
	t.Helper()
	startByte := strings.Index(text, exact)
	if startByte < 0 {
		t.Fatalf("anchor text not found: %s", exact)
	}
	endByte := startByte + len(exact)
	prefix := text[:startByte]
	targetPrefixRunes := []rune(prefix)
	if len(targetPrefixRunes) > 30 {
		targetPrefixRunes = targetPrefixRunes[len(targetPrefixRunes)-30:]
	}
	suffixRunes := []rune(text[endByte:])
	if len(suffixRunes) > 30 {
		suffixRunes = suffixRunes[:30]
	}

	selectors := []map[string]any{
		{
			"type":   "TextQuoteSelector",
			"exact":  exact,
			"prefix": string(targetPrefixRunes),
			"suffix": string(suffixRunes),
		},
		{
			"type":  "TextPositionSelector",
			"start": utf16Units(text[:startByte]),
			"end":   utf16Units(text[:endByte]),
		},
		tail,
	}
	raw, err := json.Marshal(selectors)
	if err != nil {
		t.Fatalf("marshal selectors: %v", err)
	}
	return raw
}

func utf16Units(s string) int {
	total := 0
	for _, r := range s {
		if r > 0xFFFF {
			total += 2
		} else {
			total++
		}
	}
	return total
}
