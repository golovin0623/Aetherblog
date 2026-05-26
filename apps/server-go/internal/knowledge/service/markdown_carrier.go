// Atlas — MarkdownCarrierAdapter
//
// 把 notes.id 包装为 atlas_carriers 行（懒创建）。
// source_uri 约定: `notes://{note_id}` —— 与 docs/plan/task-aether-knowledge-system.md §1.5 一致。
//
// 红线: 不修改 notes 表 schema；不删除 notes 行；ContentHash 仅作变更检测用。

package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// NoteReader 是 MarkdownCarrierService 需要的最小 note 读接口。
// 解耦：避免直接 import internal/repository.NoteRepo，让 Atlas 子域不耦合 notes 表细节。
// 实际实现：由 server.go 装配时传入一个适配器。
type NoteReader interface {
	GetNoteSnapshot(ctx context.Context, noteID int64) (*NoteSnapshot, error)
}

// NoteSnapshot 是 Atlas 需要的 note 字段子集。
type NoteSnapshot struct {
	ID       int64
	Title    string
	Content  string
	AuthorID *int64
}

// MarkdownCarrierService 处理 markdown 类型载体（背靠 notes 表）。
type MarkdownCarrierService struct {
	carriers   *repository.CarrierRepo
	notes      NoteReader
	versioning *CarrierVersioningService // P1-09: 内容变更时跑标注迁移；可为 nil（向后兼容）
}

// NewMarkdownCarrierService 创建服务。
func NewMarkdownCarrierService(carriers *repository.CarrierRepo, notes NoteReader) *MarkdownCarrierService {
	return &MarkdownCarrierService{carriers: carriers, notes: notes}
}

// AttachVersioning 注入版本迁移服务（P1-09）。
func (s *MarkdownCarrierService) AttachVersioning(v *CarrierVersioningService) {
	s.versioning = v
}

// GetOrCreateForNote 懒创建一个 Carrier 包装指定 note。幂等。
// 调用方场景: 用户在 Atlas Reader 第一次打开某条 note 时触发。
//
// PR #724 review fix (Codex P1): 过去 read-then-insert 模式无锁，并发首次打开同一 note
// 会同时 miss FindBySourceURI 各自 INSERT 造成重复行。现在改走 CarrierRepo.UpsertBySourceURI
// 单一 INSERT ... ON CONFLICT (source_uri) 路径 + migration 000066 加 UNIQUE 约束。
func (s *MarkdownCarrierService) GetOrCreateForNote(ctx context.Context, noteID int64) (*model.Carrier, error) {
	if noteID <= 0 {
		return nil, errors.New("invalid note id")
	}
	if s.notes == nil {
		return nil, errors.New("note reader not configured")
	}

	uri := MarkdownSourceURI(noteID)

	note, err := s.notes.GetNoteSnapshot(ctx, noteID)
	if err != nil {
		return nil, fmt.Errorf("load note %d: %w", noteID, err)
	}
	if note == nil {
		return nil, fmt.Errorf("note %d not found", noteID)
	}

	hash := contentSHA256(note.Content)

	// 原子 upsert：返回 (carrier, justCreated)。
	// justCreated=true: 本次 INSERT，已同步建 v1 carrier_version
	// justCreated=false: 并发 / 之前已存在，仅拿到已有 carrier
	candidate := &model.Carrier{
		Type:        "markdown",
		SourceURI:   uri,
		ContentHash: hash,
		Title:       firstNonEmpty(note.Title, fmt.Sprintf("note-%d", note.ID)),
		Metadata:    []byte(`{}`),
		OwnerID:     note.AuthorID,
		Status:      "ready",
	}
	carrier, justCreated, err := s.carriers.UpsertBySourceURI(ctx, candidate, uri)
	if err != nil {
		return nil, fmt.Errorf("upsert carrier: %w", err)
	}

	// 已存在且 hash 变了：bump 版本 + 迁移标注
	// PR #724 review fix (Gemini high + Codex P1): UpdateContent + MigrateAnnotations
	// 错误必须 propagate；过去吞掉错误导致内存 hash 与 DB 不一致 + 迁移失败被静默吞掉。
	if !justCreated && carrier.ContentHash != hash {
		diff := []byte(`{"reason":"note_edited"}`)
		if err := s.carriers.UpdateContent(ctx, carrier.ID, hash, uri, "user_edit", diff); err != nil {
			return nil, fmt.Errorf("update carrier content: %w", err)
		}
		carrier.ContentHash = hash
		if s.versioning != nil {
			if _, err := s.versioning.MigrateAnnotations(ctx, carrier.ID, note.Content); err != nil {
				// 迁移失败：carrier 版本已落库，但标注未重对齐。返回错误让上层决定（前端可重试）。
				return nil, fmt.Errorf("migrate annotations after note edit: %w", err)
			}
		}
	}
	return carrier, nil
}

// MarkdownSourceURI 构造 markdown 载体的 source_uri。集中在一处便于将来调整。
func MarkdownSourceURI(noteID int64) string {
	return fmt.Sprintf("notes://%d", noteID)
}

func contentSHA256(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
