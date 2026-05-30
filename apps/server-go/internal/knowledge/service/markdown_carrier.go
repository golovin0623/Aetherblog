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
	"github.com/golovin0623/aetherblog-server/internal/knowledge/pkg/anchoring"
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

// ErrAtlasForbidden 表示调用者没有访问目标 Atlas 资源的权限。
var ErrAtlasForbidden = errors.New("atlas resource forbidden")

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
	return s.getOrCreateForNote(ctx, noteID, 0, true)
}

// GetOrCreateForNoteAs 懒创建/返回当前调用者可访问的 Markdown carrier。
func (s *MarkdownCarrierService) GetOrCreateForNoteAs(ctx context.Context, noteID int64, userID int64, canAdmin bool) (*model.Carrier, error) {
	return s.getOrCreateForNote(ctx, noteID, userID, canAdmin)
}

func (s *MarkdownCarrierService) getOrCreateForNote(ctx context.Context, noteID int64, userID int64, canAdmin bool) (*model.Carrier, error) {
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
	if !canAdmin && (note.AuthorID == nil || *note.AuthorID != userID) {
		return nil, ErrAtlasForbidden
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

	// 已存在且 hash 变了：迁移标注 + bump 版本（注意**顺序**）
	// PR #724 review fix (Codex P1, markdown_carrier.go:104):
	//   过去顺序是 UpdateContent → MigrateAnnotations，hash 在 migration 之前就 commit。
	//   一旦 migration 失败，下次 GetOrCreateForNote 会因 ContentHash == hash 跳过迁移分支，
	//   标注永远停留在旧锚定状态。
	//
	//   现在改为：MigrateAnnotations 先跑（针对**新文本** newText 计算 anchor，
	//   relocate() 是幂等的——失败 retry 时同一 annotation 会得到同一结果，安全）。
	//   全部 migration 成功后才 commit 新 hash + 写新 carrier_version。
	//   若 migration 失败：carrier.content_hash 仍是旧值 → 下次入口检测到不一致 → 重试 migration。
	//
	// 仍依赖 PR #724 第二轮 Codex P1（atomic accept）的同款防御：每个独立 UPDATE 通过
	// MigrateAnnotations 内部统计 + firstErr 串联，让调用方知道并能区分"部分成功 / 全失败"。
	if !justCreated && carrier.ContentHash != hash {
		if s.versioning != nil {
			// PR #724 review fix (Codex P1, markdown_carrier.go:112): 标注创建时锚定的是
			// MarkdownPreview 渲染后的 textContent；migration 必须用同一空间，否则 markdown
			// 语法字符 (`#`、`**`、链接 URL) 会让 prefix/suffix/position 全部漂移。
			// 这里把 raw markdown 转近似 plaintext 再传给 MigrateAnnotations。
			plain := anchoring.MarkdownToPlaintext(note.Content)
			if _, err := s.versioning.MigrateAnnotations(ctx, carrier.ID, plain); err != nil {
				// 迁移失败：carrier 版本未推进，标注可能部分更新（relocate 幂等所以安全）；
				// 下次 GetOrCreateForNote 会因 hash 仍未变化重新进入 migration 分支自动追赶。
				return nil, fmt.Errorf("migrate annotations before hash bump: %w", err)
			}
		}
		diff := []byte(`{"reason":"note_edited"}`)
		if err := s.carriers.UpdateContent(ctx, carrier.ID, hash, uri, "user_edit", diff); err != nil {
			// 迁移已成功但 hash 写入失败 —— 下次同样靠 hash 不一致重入；标注已是新状态故无副作用。
			return nil, fmt.Errorf("update carrier content after migration: %w", err)
		}
		carrier.ContentHash = hash
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
