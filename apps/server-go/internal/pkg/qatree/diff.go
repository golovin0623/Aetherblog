package qatree

// Diff 粒度常量（精度由高到低：STRUCTURE > FIELD > CHAR）。
const (
	DiffChar      = "CHAR"
	DiffField     = "FIELD"
	DiffStructure = "STRUCTURE"
)

// CharOp 是字符级 diff 的一段（op: "=" 保留 / "-" 删除 / "+" 新增）。
type CharOp struct {
	T  string `json:"t"`
	Op string `json:"op"`
}

// Change 是一处变更。
type Change struct {
	StableKey string   `json:"stableKey"`
	FieldPath string   `json:"fieldPath,omitempty"`
	Kind      string   `json:"kind"` // added | removed | modified
	Before    string   `json:"before,omitempty"`
	After     string   `json:"after,omitempty"`
	CharDiff  []CharOp `json:"charDiff,omitempty"`
}

// DiffResult 是两版本树的差异，契约 §5。
type DiffResult struct {
	Level       string     `json:"level"`
	FromVersion int        `json:"fromVersion"`
	ToVersion   int        `json:"toVersion"`
	Changes     []Change   `json:"changes"`
	Conflicts   []Conflict `json:"conflicts"`
}

// Diff 比较 from→to 两棵树，按 stableKey 对齐，产出字符/字段/结构级变更。
// Level 取本次涉及变更的最高粒度。纯函数。
func Diff(from, to []*Node, fromVer, toVer int) DiffResult {
	fromIdx := Index(from)
	toIdx := Index(to)
	res := DiffResult{Level: DiffChar, FromVersion: fromVer, ToVersion: toVer}

	level := 0 // 0=CHAR 1=FIELD 2=STRUCTURE
	bump := func(l int) {
		if l > level {
			level = l
		}
	}

	// 删除：from 有、to 无。
	for key, fn := range fromIdx {
		if _, ok := toIdx[key]; !ok {
			res.Changes = append(res.Changes, Change{StableKey: key, Kind: "removed", Before: fn.Text})
			bump(2)
		}
	}
	// 新增 / 修改。
	for key, tn := range toIdx {
		fn, ok := fromIdx[key]
		if !ok {
			res.Changes = append(res.Changes, Change{StableKey: key, Kind: "added", After: tn.Text})
			bump(2)
			continue
		}
		// 文本变化 → CHAR。
		if NormalizeText(fn.Text) != NormalizeText(tn.Text) {
			res.Changes = append(res.Changes, Change{
				StableKey: key, FieldPath: "text", Kind: "modified",
				Before: fn.Text, After: tn.Text,
				CharDiff: charDiff(fn.Text, tn.Text),
			})
			bump(0)
		}
		// 非文本字段变化 → FIELD。
		if fn.BlockType != tn.BlockType {
			res.Changes = append(res.Changes, Change{
				StableKey: key, FieldPath: "blockType", Kind: "modified",
				Before: fn.BlockType, After: tn.BlockType,
			})
			bump(1)
		}
	}

	switch level {
	case 2:
		res.Level = DiffStructure
	case 1:
		res.Level = DiffField
	default:
		res.Level = DiffChar
	}
	return res
}

// charDiffMaxRunes 是字符级 diff 的长度上限。LCS 表是 O(N*M) 时空复杂度，
// 超长文本（整页 OCR / 大表格）会爆内存，超过则降级为整体替换。
const charDiffMaxRunes = 2000

// charDiff 计算 a→b 的字符级 diff（基于 LCS 的最小编辑序列），按 rune 处理中文。
// 任一侧超过 charDiffMaxRunes 时跳过 LCS，直接返回整体删/增（保护内存/CPU）。
func charDiff(a, b string) []CharOp {
	ar := []rune(a)
	br := []rune(b)
	n, m := len(ar), len(br)

	if n > charDiffMaxRunes || m > charDiffMaxRunes {
		ops := make([]CharOp, 0, 2)
		if a != "" {
			ops = append(ops, CharOp{T: a, Op: "-"})
		}
		if b != "" {
			ops = append(ops, CharOp{T: b, Op: "+"})
		}
		return ops
	}

	// LCS 长度表。
	lcs := make([][]int, n+1)
	for i := range lcs {
		lcs[i] = make([]int, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if ar[i] == br[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else if lcs[i+1][j] >= lcs[i][j+1] {
				lcs[i][j] = lcs[i+1][j]
			} else {
				lcs[i][j] = lcs[i][j+1]
			}
		}
	}

	var ops []CharOp
	push := func(t string, op string) {
		// 合并相邻同类型分段，输出更紧凑。
		if k := len(ops) - 1; k >= 0 && ops[k].Op == op {
			ops[k].T += t
			return
		}
		ops = append(ops, CharOp{T: t, Op: op})
	}

	i, j := 0, 0
	for i < n && j < m {
		if ar[i] == br[j] {
			push(string(ar[i]), "=")
			i++
			j++
		} else if lcs[i+1][j] >= lcs[i][j+1] {
			push(string(ar[i]), "-")
			i++
		} else {
			push(string(br[j]), "+")
			j++
		}
	}
	for ; i < n; i++ {
		push(string(ar[i]), "-")
	}
	for ; j < m; j++ {
		push(string(br[j]), "+")
	}
	return ops
}
