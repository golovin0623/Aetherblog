package handler

import (
	"encoding/json"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/qatree"
)

// 标注类型枚举码 ↔ 前端中文标签（category）双向映射。契约 §6 / 前端 AnnotationCategory。
var annotationTypeToCategory = map[string]string{
	"TYPO":           "错字",
	"MISSING":        "漏字",
	"FORMULA_ERROR":  "公式错",
	"TABLE_ERROR":    "表格错",
	"NUMBER_ERROR":   "题号错",
	"SPLIT_ERROR":    "拆分错",
	"ANSWER_ERROR":   "答案错",
	"ANALYSIS_ERROR": "解析错",
}

var categoryToAnnotationType = func() map[string]string {
	m := make(map[string]string, len(annotationTypeToCategory))
	for k, v := range annotationTypeToCategory {
		m[v] = k
	}
	return m
}()

// validAnnotationType 判断枚举码是否合法。
func validAnnotationType(t string) bool {
	_, ok := annotationTypeToCategory[t]
	return ok
}

// resolveAnnotationType 从 annotationType（枚举）或 category（中文）解析出枚举码。
func resolveAnnotationType(annotationType, category string) string {
	if validAnnotationType(annotationType) {
		return annotationType
	}
	if code, ok := categoryToAnnotationType[category]; ok {
		return code
	}
	return ""
}

// qaAnnotationVO 是标注的响应形状，同时给出枚举码与中文 category、blockId 别名。
type qaAnnotationVO struct {
	ID             int64     `json:"id"`
	DocumentID     int64     `json:"documentId"`
	BlockID        string    `json:"blockId"`
	StableKey      string    `json:"stableKey"`
	AnnotationType string    `json:"annotationType"`
	Category       string    `json:"category"`
	OriginalText   *string   `json:"originalText,omitempty"`
	CorrectedText  *string   `json:"correctedText,omitempty"`
	Note           *string   `json:"note,omitempty"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func toAnnotationVO(a *model.QAAnnotation) qaAnnotationVO {
	return qaAnnotationVO{
		ID:             a.ID,
		DocumentID:     a.DocumentID,
		BlockID:        a.StableKey,
		StableKey:      a.StableKey,
		AnnotationType: a.AnnotationType,
		Category:       annotationTypeToCategory[a.AnnotationType],
		OriginalText:   a.OriginalText,
		CorrectedText:  a.CorrectedText,
		Note:           a.Note,
		Status:         a.Status,
		CreatedAt:      a.CreatedAt,
		UpdatedAt:      a.UpdatedAt,
	}
}

func toAnnotationVOs(rows []model.QAAnnotation) []qaAnnotationVO {
	out := make([]qaAnnotationVO, 0, len(rows))
	for i := range rows {
		out = append(out, toAnnotationVO(&rows[i]))
	}
	return out
}

// qaDiffVO 把 Diff 行与解析后的 DiffResult 拍平为前端 §5 形状。
type qaDiffVO struct {
	ID          int64             `json:"id"`
	DocumentID  int64             `json:"documentId"`
	PatchID     *int64            `json:"patchId,omitempty"`
	Level       string            `json:"level"`
	FromVersion int               `json:"fromVersion"`
	ToVersion   int               `json:"toVersion"`
	HasConflict bool              `json:"hasConflict"`
	Changes     []qatree.Change   `json:"changes"`
	Conflicts   []qatree.Conflict `json:"conflicts"`
	CreatedAt   time.Time         `json:"createdAt"`
}

func toDiffVO(d *model.QADocumentDiff) qaDiffVO {
	var res qatree.DiffResult
	if len(d.Diff) > 0 {
		_ = json.Unmarshal(d.Diff, &res)
	}
	if res.Changes == nil {
		res.Changes = []qatree.Change{}
	}
	if res.Conflicts == nil {
		res.Conflicts = []qatree.Conflict{}
	}
	level := res.Level
	if level == "" {
		level = d.DiffLevel
	}
	return qaDiffVO{
		ID:          d.ID,
		DocumentID:  d.DocumentID,
		PatchID:     d.PatchID,
		Level:       level,
		FromVersion: res.FromVersion,
		ToVersion:   res.ToVersion,
		HasConflict: d.HasConflict,
		Changes:     res.Changes,
		Conflicts:   res.Conflicts,
		CreatedAt:   d.CreatedAt,
	}
}
