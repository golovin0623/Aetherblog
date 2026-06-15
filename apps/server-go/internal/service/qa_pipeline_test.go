package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/pkg/qatree"
)

// TestMockPipelineEndToEnd 在不依赖数据库的前提下，串起整条流水线 + 修复闭环逻辑：
// 预处理→拆分→OCR→结构化→质检→Agent 修复→应用 Patch→Diff→发布转换。
func TestMockPipelineEndToEnd(t *testing.T) {
	p := &MockPipeline{}
	ctx := context.Background()

	// 1) 预处理：PDF 2 页。
	pages, n, err := p.Preprocess(ctx, 1, "/api/uploads/exam.pdf", "PDF", 0)
	if err != nil || n != 2 {
		t.Fatalf("preprocess: n=%d err=%v", n, err)
	}

	// 2) 拆分（精细）。
	blocks, err := p.Segment(ctx, pages, qatree.GranularityFine)
	if err != nil {
		t.Fatalf("segment: %v", err)
	}
	var segBlocks []QASegBlock
	if err := json.Unmarshal(blocks, &segBlocks); err != nil {
		t.Fatalf("unmarshal blocks: %v", err)
	}
	if len(segBlocks) == 0 {
		t.Fatal("拆分未产出任何块")
	}

	// 3) OCR。
	ocr, err := p.OCR(ctx, blocks)
	if err != nil {
		t.Fatalf("ocr: %v", err)
	}

	// 4) 结构化 → Canonical Tree。
	roots, err := p.Structure(ctx, blocks, ocr, qatree.GranularityFine)
	if err != nil {
		t.Fatalf("structure: %v", err)
	}
	idx := qatree.Index(roots)
	// 存在被注入错字的题干。
	var typoKey string
	for key, node := range idx {
		if node.Text == mockTypoStem {
			typoKey = key
		}
	}
	if typoKey == "" {
		t.Fatal("结构化树中未发现注入的错字题干")
	}

	// 5) 质检：至少一个 TYPO。
	issues, err := p.QualityCheck(ctx, roots)
	if err != nil {
		t.Fatalf("quality check: %v", err)
	}
	var hasTypo bool
	for _, iss := range issues {
		if iss.Type == "TYPO" {
			hasTypo = true
		}
	}
	if !hasTypo {
		t.Fatal("质检未发现 TYPO")
	}

	// 6) Agent 修复（无标注 → 回退自动修已知错字），只产 Patch。
	patch, model, err := p.AgentFix(ctx, roots, nil)
	if err != nil || len(patch.Operations) == 0 {
		t.Fatalf("agent fix: ops=%d err=%v", len(patch.Operations), err)
	}
	if model != "mock-agent" {
		t.Errorf("期望 mock-agent, 得到 %s", model)
	}

	// 7) 应用 Patch：错字被修复，无冲突。
	res := qatree.ApplyPatch(roots, patch)
	if len(res.Conflicts) != 0 {
		t.Fatalf("不应有冲突: %+v", res.Conflicts)
	}
	if qatree.Index(res.Tree)[typoKey].Text != mockFixedStem {
		t.Errorf("错字未被修复: %q", qatree.Index(res.Tree)[typoKey].Text)
	}

	// 8) Diff：CHAR 级，捕获改动。
	d := qatree.Diff(roots, res.Tree, 1, 2)
	if d.Level != qatree.DiffChar {
		t.Errorf("期望 CHAR 级别, 得到 %s", d.Level)
	}
	if len(d.Changes) == 0 {
		t.Error("Diff 应包含变更")
	}

	// 9) 发布转换：树 → 题目，带 source 溯源。
	questions := treeToQuestions(res.Tree, 2, nil)
	if len(questions) == 0 {
		t.Fatal("未解析出题目")
	}
	for _, q := range questions {
		if q.Stem == "" {
			t.Error("题干不应为空")
		}
		var src []string
		_ = json.Unmarshal(q.SourceBlockIDs, &src)
		if len(src) == 0 {
			t.Error("题目缺少 source_block_ids 溯源")
		}
	}
}

// TestGranularityShapesTree 验证不同粒度产出的最深 block 类型符合契约 §2。
func TestGranularityShapesTree(t *testing.T) {
	p := &MockPipeline{}
	ctx := context.Background()
	cases := map[string]string{
		qatree.GranularityCoarse:    qatree.BlockPage,
		qatree.GranularityStandard:  qatree.BlockBlock,
		qatree.GranularityFine:      qatree.BlockAnswer,
		qatree.GranularityUltraFine: qatree.BlockTableCell,
	}
	for gran, mustHave := range cases {
		pages, _, _ := p.Preprocess(ctx, 1, "/x.png", "IMAGE", 0)
		blocks, _ := p.Segment(ctx, pages, gran)
		ocr, _ := p.OCR(ctx, blocks)
		roots, _ := p.Structure(ctx, blocks, ocr, gran)
		found := false
		for _, fn := range qatree.Flatten(roots) {
			if fn.Node.BlockType == mustHave {
				found = true
			}
		}
		if !found {
			t.Errorf("粒度 %s 应包含 %s 块", gran, mustHave)
		}
		// 粗粒度不应出现题目级块。
		if gran == qatree.GranularityCoarse {
			for _, fn := range qatree.Flatten(roots) {
				if fn.Node.BlockType == qatree.BlockQuestion {
					t.Errorf("COARSE 不应出现 QUESTION 块")
				}
			}
		}
	}
}

// TestAgentFixUsesAnnotations 验证 Agent 依据标注的 correctedText 产出 replace_text。
func TestAgentFixUsesAnnotations(t *testing.T) {
	p := &MockPipeline{}
	roots := []*qatree.Node{{StableKey: "k1", BlockType: qatree.BlockStem, Text: "旧文本"}}
	anns := []QAAnnotationInput{{StableKey: "k1", Type: "TYPO", CorrectedText: "新文本"}}
	patch, _, err := p.AgentFix(context.Background(), roots, anns)
	if err != nil {
		t.Fatal(err)
	}
	if len(patch.Operations) != 1 || patch.Operations[0].NewValue != "新文本" {
		t.Fatalf("应基于标注产出 1 条 replace_text: %+v", patch.Operations)
	}
	res := qatree.ApplyPatch(roots, patch)
	if qatree.Index(res.Tree)["k1"].Text != "新文本" {
		t.Error("标注修复未生效")
	}
}
