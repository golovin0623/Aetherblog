package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/golovin0623/aetherblog-server/internal/pkg/qatree"
)

// QA 流水线抽象。OCR/版面/PDF 栅格化引擎可插拔；默认 MockPipeline（确定性、无外部
// 系统依赖、对齐「pluggable, mock first」）。HTTPPipeline 调用 ai-service /api/v1/ai/qa/*。
//
// 阶段间中间产物（pages/blocks/ocr）以 json.RawMessage 不透明透传，便于 http 模式直接
// 转发、mock 模式序列化内部结构；仅 Canonical Tree / 质检 / Patch 为强类型边界。契约 §8。

// QAPage 是预处理产出的页。
type QAPage struct {
	PageNo   int    `json:"pageNo"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	ImageURL string `json:"imageUrl"`
}

// QASegBlock 是版面拆分产出的块（字段名与 ai-service SegmentBlock 对齐）。
type QASegBlock struct {
	PageNo        int          `json:"pageNo"`
	BBox          *qatree.BBox `json:"bbox"`
	BlockType     string       `json:"blockType"`
	OrderIndex    int          `json:"orderIndex"`
	SourceCropURL string       `json:"sourceCropUrl,omitempty"`
	ParentRef     string       `json:"parentRef,omitempty"`
	LocalRef      string       `json:"localRef"`
	FieldPath     string       `json:"fieldPath,omitempty"`
	// OCR 合并后回填（structure 阶段用）。
	Text       string  `json:"text,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
}

// QAOCRResult 是单块 OCR 结果。
type QAOCRResult struct {
	Ref        string  `json:"ref"`
	Text       string  `json:"text"`
	Confidence float64 `json:"confidence"`
}

// QAQualityIssue 是质检问题。
type QAQualityIssue struct {
	StableKey string `json:"stableKey"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	Severity  string `json:"severity"`
}

// QAAnnotationInput 是喂给 Agent 的只读标注上下文。
type QAAnnotationInput struct {
	StableKey     string `json:"stableKey"`
	Type          string `json:"type"`
	OriginalText  string `json:"originalText"`
	CorrectedText string `json:"correctedText"`
	Note          string `json:"note"`
}

// QAPipeline 是 QA 流水线引擎接口，每方法对应一个可观测/可重试阶段。
type QAPipeline interface {
	Preprocess(ctx context.Context, documentID int64, fileURL, fileType string, pageCount int) (pages json.RawMessage, n int, err error)
	Segment(ctx context.Context, pages json.RawMessage, granularity string) (blocks json.RawMessage, err error)
	OCR(ctx context.Context, blocks json.RawMessage) (ocr json.RawMessage, err error)
	Structure(ctx context.Context, blocks, ocr json.RawMessage, granularity string) (roots []*qatree.Node, err error)
	QualityCheck(ctx context.Context, roots []*qatree.Node) (issues []QAQualityIssue, err error)
	AgentFix(ctx context.Context, roots []*qatree.Node, annotations []QAAnnotationInput) (patch qatree.Patch, model string, err error)
}

// NewQAPipeline 根据 mode 返回流水线实现。mode!="http" 或缺 client 时返回确定性 MockPipeline。
func NewQAPipeline(mode string, aiClient *AIClient, internalToken string) QAPipeline {
	if mode == "http" && aiClient != nil {
		return &HTTPPipeline{client: aiClient, internalToken: internalToken}
	}
	return &MockPipeline{}
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// ------------------------------------------------------------------
// MockPipeline —— 确定性内置实现（mock-first）。
// 在首个 STEM 注入已知错字（导树→导数）驱动全链路演示。
// ------------------------------------------------------------------

// MockPipeline 是确定性内置流水线实现。
type MockPipeline struct{}

const mockTypoStem = "求 f(x)=x^2 的导树" // 故意 OCR 错字（树）
const mockFixedStem = "求 f(x)=x^2 的导数"

func (m *MockPipeline) Preprocess(_ context.Context, _ int64, fileURL, fileType string, pageCount int) (json.RawMessage, int, error) {
	n := pageCount
	if n <= 0 {
		if fileType == "PDF" {
			n = 2
		} else {
			n = 1
		}
	}
	pages := make([]QAPage, 0, n)
	for i := 1; i <= n; i++ {
		pages = append(pages, QAPage{PageNo: i, Width: 1000, Height: 1400, ImageURL: fileURL})
	}
	return mustJSON(pages), n, nil
}

func (m *MockPipeline) Segment(_ context.Context, pagesRaw json.RawMessage, granularity string) (json.RawMessage, error) {
	var pages []QAPage
	if err := json.Unmarshal(pagesRaw, &pages); err != nil {
		return nil, fmt.Errorf("segment: 解析 pages: %w", err)
	}
	allowed := qatree.AllowedBlockTypes(granularity)
	var blocks []QASegBlock
	for _, p := range pages {
		pageRef := fmt.Sprintf("p%d", p.PageNo)
		blocks = append(blocks, QASegBlock{
			LocalRef: pageRef, PageNo: p.PageNo, BlockType: qatree.BlockPage,
			BBox: &qatree.BBox{X: 0, Y: 0, W: 1, H: 1}, OrderIndex: 0, SourceCropURL: cropURL(p.ImageURL, pageRef),
		})
		if !allowed[qatree.BlockBlock] {
			continue
		}
		for b := 1; b <= 2; b++ {
			blockRef := fmt.Sprintf("%s-b%d", pageRef, b)
			blocks = append(blocks, QASegBlock{
				LocalRef: blockRef, ParentRef: pageRef, PageNo: p.PageNo, BlockType: qatree.BlockBlock,
				BBox: gridBox(b-1, 2), OrderIndex: b - 1, SourceCropURL: cropURL(p.ImageURL, blockRef),
			})
			if !allowed[qatree.BlockQuestion] {
				continue
			}
			qRef := blockRef + "-q1"
			qIdx := (p.PageNo-1)*2 + (b - 1)
			blocks = append(blocks, QASegBlock{
				LocalRef: qRef, ParentRef: blockRef, PageNo: p.PageNo, BlockType: qatree.BlockQuestion,
				BBox: gridBox(b-1, 2), OrderIndex: 0, SourceCropURL: cropURL(p.ImageURL, qRef),
				FieldPath: fmt.Sprintf("questions[%d]", qIdx),
			})
			children := []struct{ suffix, btype, field string }{
				{"stem", qatree.BlockStem, "stem"},
				{"optA", qatree.BlockOption, "options[0]"},
				{"optB", qatree.BlockOption, "options[1]"},
				{"answer", qatree.BlockAnswer, "answer"},
				{"analysis", qatree.BlockAnalysis, "analysis"},
			}
			for ci, ch := range children {
				ref := qRef + "." + ch.suffix
				blocks = append(blocks, QASegBlock{
					LocalRef: ref, ParentRef: qRef, PageNo: p.PageNo, BlockType: ch.btype,
					BBox: gridBox(ci, len(children)), OrderIndex: ci, SourceCropURL: cropURL(p.ImageURL, ref),
					FieldPath: fmt.Sprintf("questions[%d].%s", qIdx, ch.field),
				})
			}
			if allowed[qatree.BlockFormula] {
				fRef := qRef + ".stem.formula"
				blocks = append(blocks, QASegBlock{
					LocalRef: fRef, ParentRef: qRef + ".stem", PageNo: p.PageNo, BlockType: qatree.BlockFormula,
					BBox: gridBox(0, 2), OrderIndex: 0, SourceCropURL: cropURL(p.ImageURL, fRef),
					FieldPath: fmt.Sprintf("questions[%d].stem.formula", qIdx),
				})
			}
			if allowed[qatree.BlockTableCell] {
				tRef := qRef + ".analysis.cell"
				blocks = append(blocks, QASegBlock{
					LocalRef: tRef, ParentRef: qRef + ".analysis", PageNo: p.PageNo, BlockType: qatree.BlockTableCell,
					BBox: gridBox(1, 2), OrderIndex: 0, SourceCropURL: cropURL(p.ImageURL, tRef),
					FieldPath: fmt.Sprintf("questions[%d].analysis.cell", qIdx),
				})
			}
		}
	}
	return mustJSON(blocks), nil
}

func (m *MockPipeline) OCR(_ context.Context, blocksRaw json.RawMessage) (json.RawMessage, error) {
	var blocks []QASegBlock
	if err := json.Unmarshal(blocksRaw, &blocks); err != nil {
		return nil, fmt.Errorf("ocr: 解析 blocks: %w", err)
	}
	results := make([]QAOCRResult, 0, len(blocks))
	stemSeen := false
	for _, b := range blocks {
		text := mockTextFor(b.BlockType, b.LocalRef)
		conf := 0.97
		if b.BlockType == qatree.BlockStem && !stemSeen {
			text = mockTypoStem
			conf = 0.82
			stemSeen = true
		}
		results = append(results, QAOCRResult{Ref: b.LocalRef, Text: text, Confidence: conf})
	}
	return mustJSON(results), nil
}

func (m *MockPipeline) Structure(_ context.Context, blocksRaw, ocrRaw json.RawMessage, _ string) ([]*qatree.Node, error) {
	var blocks []QASegBlock
	if err := json.Unmarshal(blocksRaw, &blocks); err != nil {
		return nil, fmt.Errorf("structure: 解析 blocks: %w", err)
	}
	var ocr []QAOCRResult
	if len(ocrRaw) > 0 {
		_ = json.Unmarshal(ocrRaw, &ocr)
	}
	ocrByRef := map[string]QAOCRResult{}
	for _, r := range ocr {
		ocrByRef[r.Ref] = r
	}
	nodeByRef := map[string]*qatree.Node{}
	var roots []*qatree.Node
	for _, b := range blocks {
		o := ocrByRef[b.LocalRef]
		n := &qatree.Node{
			StableKey: b.LocalRef, BlockType: b.BlockType, PageNo: b.PageNo, BBox: b.BBox,
			Text: o.Text, Confidence: orDefault(o.Confidence, 1.0), SourceCropURL: b.SourceCropURL,
			OrderIndex: b.OrderIndex, FieldPath: b.FieldPath,
		}
		nodeByRef[b.LocalRef] = n
		if b.ParentRef == "" {
			roots = append(roots, n)
		} else if parent, ok := nodeByRef[b.ParentRef]; ok {
			parent.Children = append(parent.Children, n)
		} else {
			roots = append(roots, n)
		}
	}
	return roots, nil
}

func (m *MockPipeline) QualityCheck(_ context.Context, roots []*qatree.Node) ([]QAQualityIssue, error) {
	var issues []QAQualityIssue
	for _, fn := range qatree.Flatten(roots) {
		n := fn.Node
		if n.Text == mockTypoStem {
			issues = append(issues, QAQualityIssue{StableKey: n.StableKey, Type: "TYPO", Severity: "warn",
				Message: "疑似错字：'导树' 应为 '导数'"})
			continue
		}
		if n.Confidence > 0 && n.Confidence < 0.9 && n.Text != "" {
			issues = append(issues, QAQualityIssue{StableKey: n.StableKey, Type: "LOW_CONFIDENCE", Severity: "info",
				Message: fmt.Sprintf("OCR 置信度偏低 (%.2f)", n.Confidence)})
		}
	}
	return issues, nil
}

func (m *MockPipeline) AgentFix(_ context.Context, roots []*qatree.Node, annotations []QAAnnotationInput) (qatree.Patch, string, error) {
	idx := qatree.Index(roots)
	var ops []qatree.PatchOp
	for _, a := range annotations {
		if a.CorrectedText == "" {
			continue
		}
		old := a.OriginalText
		if old == "" {
			if n := idx[a.StableKey]; n != nil {
				old = n.Text
			}
		}
		ops = append(ops, qatree.PatchOp{
			Op: qatree.OpReplaceText, StableKey: a.StableKey, FieldPath: "text",
			OldValue: old, NewValue: a.CorrectedText,
			Reason: "依据人工标注修复(" + a.Type + ")", Confidence: 0.95,
		})
	}
	if len(ops) == 0 {
		for _, fn := range qatree.Flatten(roots) {
			if fn.Node.Text == mockTypoStem {
				ops = append(ops, qatree.PatchOp{
					Op: qatree.OpReplaceText, StableKey: fn.Node.StableKey, FieldPath: "text",
					OldValue: mockTypoStem, NewValue: mockFixedStem,
					Reason: "自动修复 OCR 错字", Confidence: 0.9,
				})
			}
		}
	}
	return qatree.Patch{Summary: fmt.Sprintf("提议修复 %d 处", len(ops)), Operations: ops}, "mock-agent", nil
}

func mockTextFor(blockType, ref string) string {
	switch blockType {
	case qatree.BlockPage:
		// COARSE 粒度下 PAGE 是叶子，会被当作 RAW 题目，须有非空文本。
		return "页面 " + ref + " 的整页文本（mock）"
	case qatree.BlockBlock:
		// STANDARD 粒度下 BLOCK 是叶子，同理须有非空文本。
		return "版面块 " + ref + " 的文本（mock）"
	case qatree.BlockStem:
		return "下列说法正确的是（" + ref + "）"
	case qatree.BlockOption:
		return "选项 " + ref
	case qatree.BlockAnswer:
		return "A"
	case qatree.BlockAnalysis:
		return "解析：依据定义可得。"
	case qatree.BlockFormula:
		return "f'(x)=2x"
	case qatree.BlockTableCell:
		return "单元格"
	default:
		return ""
	}
}

func cropURL(base, ref string) string { return fmt.Sprintf("%s#crop=%s", base, ref) }

func gridBox(i, total int) *qatree.BBox {
	if total <= 0 {
		total = 1
	}
	h := 1.0 / float64(total)
	return &qatree.BBox{X: 0.05, Y: float64(i) * h, W: 0.9, H: h * 0.9}
}

func orDefault(v, def float64) float64 {
	if v == 0 {
		return def
	}
	return v
}

// ------------------------------------------------------------------
// HTTPPipeline —— 调用 ai-service /api/v1/ai/qa/*（X-Internal-Service 鉴权）。
// ------------------------------------------------------------------

// HTTPPipeline 通过 AIClient 调用 ai-service 的 QA 端点。
type HTTPPipeline struct {
	client        *AIClient
	internalToken string
}

// aiEnvelope 对齐 ai-service ApiResponse 外壳。
type aiEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
}

func (p *HTTPPipeline) call(ctx context.Context, path string, reqBody any) (json.RawMessage, error) {
	body := mustJSON(reqBody)
	rc, status, err := p.client.DoSync(ctx, "POST", path, bytes.NewReader(body), map[string]string{
		"X-Internal-Service": p.internalToken,
	})
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	raw, _ := io.ReadAll(rc)
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("ai-service %s 返回 %d: %s", path, status, string(raw))
	}
	var env aiEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("ai-service %s 响应解析失败: %w", path, err)
	}
	if !env.Success && env.Code != 0 && env.Code != 200 {
		return nil, fmt.Errorf("ai-service %s 业务失败: %s", path, env.Message)
	}
	return env.Data, nil
}

func (p *HTTPPipeline) Preprocess(ctx context.Context, documentID int64, fileURL, fileType string, _ int) (json.RawMessage, int, error) {
	data, err := p.call(ctx, "/api/v1/ai/qa/preprocess", map[string]any{
		"documentId": fmt.Sprintf("%d", documentID), "fileUrl": fileURL, "fileType": fileType,
	})
	if err != nil {
		return nil, 0, err
	}
	var d struct {
		Pages []QAPage `json:"pages"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, 0, err
	}
	return mustJSON(d.Pages), len(d.Pages), nil
}

func (p *HTTPPipeline) Segment(ctx context.Context, pages json.RawMessage, granularity string) (json.RawMessage, error) {
	data, err := p.call(ctx, "/api/v1/ai/qa/segment", map[string]any{
		"pages": pages, "granularity": granularity,
	})
	if err != nil {
		return nil, err
	}
	var d struct {
		Blocks json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, err
	}
	return d.Blocks, nil
}

func (p *HTTPPipeline) OCR(ctx context.Context, blocks json.RawMessage) (json.RawMessage, error) {
	data, err := p.call(ctx, "/api/v1/ai/qa/ocr", map[string]any{"blocks": blocks})
	if err != nil {
		return nil, err
	}
	var d struct {
		Results json.RawMessage `json:"results"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, err
	}
	return d.Results, nil
}

func (p *HTTPPipeline) Structure(ctx context.Context, blocksRaw, ocrRaw json.RawMessage, granularity string) ([]*qatree.Node, error) {
	// 把 OCR 文本合并回 blocks（按 ref==localRef），再调 structure。
	var blocks []map[string]any
	if err := json.Unmarshal(blocksRaw, &blocks); err != nil {
		return nil, err
	}
	var ocr []QAOCRResult
	if len(ocrRaw) > 0 {
		_ = json.Unmarshal(ocrRaw, &ocr)
	}
	ocrByRef := map[string]QAOCRResult{}
	for _, r := range ocr {
		ocrByRef[r.Ref] = r
	}
	for _, b := range blocks {
		if ref, ok := b["localRef"].(string); ok {
			if r, ok := ocrByRef[ref]; ok {
				b["text"] = r.Text
				b["confidence"] = r.Confidence
			}
		}
	}
	data, err := p.call(ctx, "/api/v1/ai/qa/structure", map[string]any{
		"blocks": blocks, "granularity": granularity,
	})
	if err != nil {
		return nil, err
	}
	var d struct {
		Tree []*qatree.Node `json:"tree"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, err
	}
	return d.Tree, nil
}

func (p *HTTPPipeline) QualityCheck(ctx context.Context, roots []*qatree.Node) ([]QAQualityIssue, error) {
	data, err := p.call(ctx, "/api/v1/ai/qa/quality-check", map[string]any{"tree": roots})
	if err != nil {
		return nil, err
	}
	var d struct {
		Issues []QAQualityIssue `json:"issues"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, err
	}
	return d.Issues, nil
}

func (p *HTTPPipeline) AgentFix(ctx context.Context, roots []*qatree.Node, annotations []QAAnnotationInput) (qatree.Patch, string, error) {
	data, err := p.call(ctx, "/api/v1/ai/qa/agent-fix", map[string]any{
		"tree": roots, "annotations": annotations, "crops": []any{}, "ocr": []any{},
	})
	if err != nil {
		return qatree.Patch{}, "", err
	}
	var d struct {
		Patch qatree.Patch `json:"patch"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return qatree.Patch{}, "", err
	}
	return d.Patch, "ai-agent", nil
}
