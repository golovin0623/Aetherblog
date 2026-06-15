// Package qatree 实现 QA Document Workflow 的纯领域逻辑：Canonical Document Tree、
// Patch 应用、字符/字段/结构级 Diff、拆分粒度映射与状态机。
//
// 这一层不依赖数据库与 HTTP，全部可单测。契约源：docs/features/qa-document-workflow.md。
package qatree

import "strings"

// BBox 为归一化（0~1，相对页面）的包围盒。
type BBox struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// Node 是 Canonical Document Tree 的节点，JSON 形状与契约 §3 一致（camelCase）。
type Node struct {
	StableKey     string  `json:"stableKey"`
	BlockType     string  `json:"blockType"`
	PageNo        int     `json:"pageNo"`
	BBox          *BBox   `json:"bbox,omitempty"`
	Text          string  `json:"text"`
	Confidence    float64 `json:"confidence"`
	SourceCropURL string  `json:"sourceCropUrl,omitempty"`
	OrderIndex    int     `json:"orderIndex"`
	FieldPath     string  `json:"fieldPath,omitempty"`
	Children      []*Node `json:"children,omitempty"`
}

// Block 类型常量。
const (
	BlockPage        = "PAGE"
	BlockBlock       = "BLOCK"
	BlockQuestion    = "QUESTION"
	BlockStem        = "STEM"
	BlockOption      = "OPTION"
	BlockAnswer      = "ANSWER"
	BlockAnalysis    = "ANALYSIS"
	BlockSubQuestion = "SUB_QUESTION"
	BlockFormula     = "FORMULA"
	BlockTable       = "TABLE"
	BlockTableCell   = "TABLE_CELL"
)

// 拆分粒度常量。
const (
	GranularityCoarse    = "COARSE"
	GranularityStandard  = "STANDARD"
	GranularityFine      = "FINE"
	GranularityUltraFine = "ULTRA_FINE"
)

// AllowedBlockTypes 返回给定粒度下允许出现的 block 层级集合（契约 §2）。
func AllowedBlockTypes(granularity string) map[string]bool {
	switch granularity {
	case GranularityCoarse:
		return set(BlockPage)
	case GranularityStandard:
		return set(BlockPage, BlockBlock)
	case GranularityFine:
		return set(BlockPage, BlockBlock, BlockQuestion, BlockStem, BlockOption, BlockAnswer, BlockAnalysis)
	case GranularityUltraFine:
		return set(BlockPage, BlockBlock, BlockQuestion, BlockStem, BlockOption, BlockAnswer, BlockAnalysis,
			BlockSubQuestion, BlockFormula, BlockTable, BlockTableCell)
	default:
		return set(BlockPage, BlockBlock, BlockQuestion, BlockStem, BlockOption, BlockAnswer, BlockAnalysis)
	}
}

func set(items ...string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, it := range items {
		m[it] = true
	}
	return m
}

// ValidGranularity 判断粒度枚举是否合法。
func ValidGranularity(g string) bool {
	switch g {
	case GranularityCoarse, GranularityStandard, GranularityFine, GranularityUltraFine:
		return true
	}
	return false
}

// FlatNode 是扁平化后的节点，携带父子关系（用于落库）。
type FlatNode struct {
	Node      *Node
	ParentKey string // 空串表示根
	Depth     int
}

// Flatten 把树深度优先展开为扁平列表，便于持久化与索引。
func Flatten(roots []*Node) []FlatNode {
	var out []FlatNode
	var walk func(n *Node, parentKey string, depth int)
	walk = func(n *Node, parentKey string, depth int) {
		out = append(out, FlatNode{Node: n, ParentKey: parentKey, Depth: depth})
		for _, c := range n.Children {
			walk(c, n.StableKey, depth+1)
		}
	}
	for _, r := range roots {
		walk(r, "", 0)
	}
	return out
}

// Index 把树（含所有后代）按 stableKey 建索引，返回 key→node。
func Index(roots []*Node) map[string]*Node {
	idx := make(map[string]*Node)
	for _, fn := range Flatten(roots) {
		idx[fn.Node.StableKey] = fn.Node
	}
	return idx
}

// Clone 深拷贝整棵树（Patch 应用前用，避免污染原版本）。
func Clone(roots []*Node) []*Node {
	out := make([]*Node, 0, len(roots))
	for _, r := range roots {
		out = append(out, cloneNode(r))
	}
	return out
}

func cloneNode(n *Node) *Node {
	if n == nil {
		return nil
	}
	cp := *n
	if n.BBox != nil {
		b := *n.BBox
		cp.BBox = &b
	}
	if len(n.Children) > 0 {
		cp.Children = make([]*Node, 0, len(n.Children))
		for _, c := range n.Children {
			cp.Children = append(cp.Children, cloneNode(c))
		}
	} else {
		cp.Children = nil
	}
	return &cp
}

// removeByKey 从树中删除指定 stableKey 的节点，返回是否删除成功。
func removeByKey(roots *[]*Node, key string) bool {
	for i, n := range *roots {
		if n.StableKey == key {
			*roots = append((*roots)[:i], (*roots)[i+1:]...)
			return true
		}
		if removeByKey(&n.Children, key) {
			return true
		}
	}
	return false
}

// findParentSlice 返回包含 key 节点的父切片指针（用于 insert）。
func findNode(roots []*Node, key string) *Node {
	for _, n := range roots {
		if n.StableKey == key {
			return n
		}
		if got := findNode(n.Children, key); got != nil {
			return got
		}
	}
	return nil
}

// NormalizeText 去除首尾空白，做内容比较的归一。
func NormalizeText(s string) string { return strings.TrimSpace(s) }
