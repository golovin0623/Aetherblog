package qatree

// Patch 操作类型常量。
const (
	OpReplaceText = "replace_text"
	OpUpdateField = "update_field"
	OpInsertBlock = "insert_block"
	OpDeleteBlock = "delete_block"
	OpSplitBlock  = "split_block"
	OpMergeBlock  = "merge_block"
)

// PatchOp 是单条 Patch 操作，命中 stableKey(+fieldPath)。契约 §4。
type PatchOp struct {
	Op         string  `json:"op"`
	StableKey  string  `json:"stableKey"`
	FieldPath  string  `json:"fieldPath,omitempty"`
	OldValue   string  `json:"oldValue,omitempty"`
	NewValue   string  `json:"newValue,omitempty"`
	NewNode    *Node   `json:"newNode,omitempty"` // insert_block / split_block 用
	Reason     string  `json:"reason,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
}

// Patch 是 Agent 产出的 Patch Proposal。
type Patch struct {
	Summary    string    `json:"summary"`
	Operations []PatchOp `json:"operations"`
}

// Conflict 表示一处合并冲突（base 基线已变更或目标缺失）。
type Conflict struct {
	StableKey string `json:"stableKey"`
	Reason    string `json:"reason"`
}

// ApplyResult 是 Patch 应用结果。
type ApplyResult struct {
	Tree      []*Node
	Applied   int
	Conflicts []Conflict
}

// ApplyPatch 在 base 树的深拷贝上应用 Patch。基线过期或目标缺失的操作记为冲突
// 并跳过（不污染其余操作），返回新树 + 冲突列表。纯函数，不改入参。
func ApplyPatch(base []*Node, patch Patch) ApplyResult {
	tree := Clone(base)
	res := ApplyResult{Tree: tree}

	for _, op := range patch.Operations {
		switch op.Op {
		case OpReplaceText, OpUpdateField:
			n := findNode(tree, op.StableKey)
			if n == nil {
				res.Conflicts = append(res.Conflicts, Conflict{op.StableKey, "目标节点不存在"})
				continue
			}
			// 字段级：仅支持 text（其余字段路径暂按文本处理）。
			if op.OldValue != "" && NormalizeText(n.Text) != NormalizeText(op.OldValue) {
				res.Conflicts = append(res.Conflicts, Conflict{op.StableKey, "base 基线已变更，patch 过期"})
				continue
			}
			n.Text = op.NewValue
			res.Applied++

		case OpDeleteBlock:
			if removeByKey(&tree, op.StableKey) {
				res.Applied++
			} else {
				res.Conflicts = append(res.Conflicts, Conflict{op.StableKey, "待删除节点不存在"})
			}

		case OpInsertBlock:
			if op.NewNode == nil {
				res.Conflicts = append(res.Conflicts, Conflict{op.StableKey, "insert_block 缺少 newNode"})
				continue
			}
			parent := findNode(tree, op.StableKey)
			if parent == nil {
				// 无父则插入为根节点。
				tree = append(tree, cloneNode(op.NewNode))
				res.Tree = tree
			} else {
				parent.Children = append(parent.Children, cloneNode(op.NewNode))
			}
			res.Applied++

		case OpSplitBlock:
			n := findNode(tree, op.StableKey)
			if n == nil {
				res.Conflicts = append(res.Conflicts, Conflict{op.StableKey, "待拆分节点不存在"})
				continue
			}
			n.Text = op.OldValue // 拆分后原节点保留前半
			if op.NewNode != nil {
				n.Children = append(n.Children, cloneNode(op.NewNode))
			}
			res.Applied++

		case OpMergeBlock:
			n := findNode(tree, op.StableKey)
			if n == nil {
				res.Conflicts = append(res.Conflicts, Conflict{op.StableKey, "待合并节点不存在"})
				continue
			}
			n.Text = op.NewValue
			res.Applied++

		default:
			res.Conflicts = append(res.Conflicts, Conflict{op.StableKey, "未知操作类型: " + op.Op})
		}
	}
	res.Tree = tree
	return res
}

// IsStructuralOp 判断操作是否改变树结构（用于推断 Diff 粒度）。
func IsStructuralOp(op string) bool {
	switch op {
	case OpInsertBlock, OpDeleteBlock, OpSplitBlock, OpMergeBlock:
		return true
	}
	return false
}
