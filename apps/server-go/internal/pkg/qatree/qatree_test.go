package qatree

import "testing"

func sampleTree() []*Node {
	return []*Node{
		{
			StableKey: "p1", BlockType: BlockPage, PageNo: 1, OrderIndex: 0,
			Children: []*Node{
				{StableKey: "p1-b1", BlockType: BlockBlock, PageNo: 1, OrderIndex: 0, Children: []*Node{
					{StableKey: "p1-b1-q1.stem", BlockType: BlockStem, Text: "求 f(x)=x^2 的导树", Confidence: 0.9, FieldPath: "questions[0].stem"},
					{StableKey: "p1-b1-q1.answer", BlockType: BlockAnswer, Text: "2x", FieldPath: "questions[0].answer"},
				}},
			},
		},
	}
}

func TestAllowedBlockTypes(t *testing.T) {
	if AllowedBlockTypes(GranularityCoarse)[BlockQuestion] {
		t.Error("COARSE 不应包含 QUESTION")
	}
	if !AllowedBlockTypes(GranularityCoarse)[BlockPage] {
		t.Error("COARSE 应包含 PAGE")
	}
	if !AllowedBlockTypes(GranularityUltraFine)[BlockTableCell] {
		t.Error("ULTRA_FINE 应包含 TABLE_CELL")
	}
	if AllowedBlockTypes(GranularityFine)[BlockFormula] {
		t.Error("FINE 不应包含 FORMULA")
	}
}

func TestFlattenAndIndex(t *testing.T) {
	tree := sampleTree()
	flat := Flatten(tree)
	if len(flat) != 4 {
		t.Fatalf("期望 4 个节点, 得到 %d", len(flat))
	}
	idx := Index(tree)
	if idx["p1-b1-q1.stem"] == nil {
		t.Fatal("索引缺少 stem 节点")
	}
	// 父子关系正确。
	for _, fn := range flat {
		if fn.Node.StableKey == "p1-b1-q1.stem" && fn.ParentKey != "p1-b1" {
			t.Errorf("stem 父节点应为 p1-b1, 得到 %q", fn.ParentKey)
		}
	}
}

func TestCloneIsDeep(t *testing.T) {
	tree := sampleTree()
	cp := Clone(tree)
	Index(cp)["p1-b1-q1.stem"].Text = "改了"
	if Index(tree)["p1-b1-q1.stem"].Text == "改了" {
		t.Fatal("Clone 不是深拷贝, 原树被污染")
	}
}

func TestApplyPatchReplaceText(t *testing.T) {
	tree := sampleTree()
	patch := Patch{Operations: []PatchOp{
		{Op: OpReplaceText, StableKey: "p1-b1-q1.stem", OldValue: "求 f(x)=x^2 的导树", NewValue: "求 f(x)=x^2 的导数"},
	}}
	res := ApplyPatch(tree, patch)
	if res.Applied != 1 || len(res.Conflicts) != 0 {
		t.Fatalf("期望 applied=1 conflicts=0, 得到 applied=%d conflicts=%d", res.Applied, len(res.Conflicts))
	}
	if Index(res.Tree)["p1-b1-q1.stem"].Text != "求 f(x)=x^2 的导数" {
		t.Error("文本未被替换")
	}
	// 原树不受影响（纯函数）。
	if Index(tree)["p1-b1-q1.stem"].Text != "求 f(x)=x^2 的导树" {
		t.Error("ApplyPatch 污染了原树")
	}
}

func TestApplyPatchConflictOnStaleBase(t *testing.T) {
	tree := sampleTree()
	patch := Patch{Operations: []PatchOp{
		{Op: OpReplaceText, StableKey: "p1-b1-q1.stem", OldValue: "过期的旧值", NewValue: "新值"},
	}}
	res := ApplyPatch(tree, patch)
	if len(res.Conflicts) != 1 {
		t.Fatalf("期望 1 个冲突, 得到 %d", len(res.Conflicts))
	}
	if res.Applied != 0 {
		t.Error("冲突操作不应被应用")
	}
}

func TestApplyPatchDeleteAndMissing(t *testing.T) {
	tree := sampleTree()
	patch := Patch{Operations: []PatchOp{
		{Op: OpDeleteBlock, StableKey: "p1-b1-q1.answer"},
		{Op: OpDeleteBlock, StableKey: "does-not-exist"},
	}}
	res := ApplyPatch(tree, patch)
	if res.Applied != 1 {
		t.Errorf("期望 applied=1, 得到 %d", res.Applied)
	}
	if len(res.Conflicts) != 1 {
		t.Errorf("期望 1 个冲突, 得到 %d", len(res.Conflicts))
	}
	if Index(res.Tree)["p1-b1-q1.answer"] != nil {
		t.Error("answer 节点应被删除")
	}
}

func TestDiffCharLevel(t *testing.T) {
	from := sampleTree()
	to := Clone(from)
	Index(to)["p1-b1-q1.stem"].Text = "求 f(x)=x^2 的导数"
	d := Diff(from, to, 1, 2)
	if d.Level != DiffChar {
		t.Errorf("期望 CHAR 级别, 得到 %s", d.Level)
	}
	if len(d.Changes) != 1 {
		t.Fatalf("期望 1 处变更, 得到 %d", len(d.Changes))
	}
	if d.Changes[0].Kind != "modified" || len(d.Changes[0].CharDiff) == 0 {
		t.Error("应有字符级 diff")
	}
	// 字符 diff 应包含删除"树"与新增"数"。
	var minus, plus bool
	for _, op := range d.Changes[0].CharDiff {
		if op.Op == "-" && op.T == "树" {
			minus = true
		}
		if op.Op == "+" && op.T == "数" {
			plus = true
		}
	}
	if !minus || !plus {
		t.Errorf("字符 diff 未捕获 导树→导数: %+v", d.Changes[0].CharDiff)
	}
}

func TestDiffStructureLevel(t *testing.T) {
	from := sampleTree()
	to := Clone(from)
	removeByKey(&to, "p1-b1-q1.answer")
	d := Diff(from, to, 1, 2)
	if d.Level != DiffStructure {
		t.Errorf("删除节点应为 STRUCTURE 级别, 得到 %s", d.Level)
	}
	var removed bool
	for _, c := range d.Changes {
		if c.Kind == "removed" && c.StableKey == "p1-b1-q1.answer" {
			removed = true
		}
	}
	if !removed {
		t.Error("未捕获 removed 变更")
	}
}

func TestStateMachine(t *testing.T) {
	if !CanTransition(StatusUploaded, StatusPreprocessing) {
		t.Error("UPLOADED→PREPROCESSING 应合法")
	}
	if CanTransition(StatusUploaded, StatusPublished) {
		t.Error("UPLOADED→PUBLISHED 应非法")
	}
	if !CanTransition(StatusApproved, StatusPublished) {
		t.Error("APPROVED→PUBLISHED 应合法")
	}
	if CanTransition(StatusPublished, StatusApproved) {
		t.Error("PUBLISHED 是终态, 不可回退")
	}
	if !CanTransition(StatusFailed, StatusPreprocessing) {
		t.Error("FAILED 应可 reprocess 重入")
	}
}

func TestAutoPipeline(t *testing.T) {
	if NextAutoStage(StagePreprocess) != StageSegment {
		t.Error("PREPROCESS 的下一阶段应为 SEGMENT")
	}
	if NextAutoStage(StageQualityCheck) != "" {
		t.Error("QUALITY_CHECK 是自动流水线末阶段")
	}
	if StageSuccessStatus(StageStructure) != StatusStructured {
		t.Error("STRUCTURE 成功应进入 STRUCTURED")
	}
}
