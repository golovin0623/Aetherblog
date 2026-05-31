// Atlas — NoteReader 适配器
//
// 把全局 internal/repository.NoteRepo 暴露的最小字段适配为 Atlas 子域期望的接口。
// 单向依赖：knowledge/service -> internal/repository（与 server.go 装配方向一致）。
//
// 这里特意不直接 import internal/model.Note，避免暴露超出 Atlas 需要的字段。

package service

import (
	"context"
	"errors"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// NoteRepoReader 是 NoteReader 的实现，背靠现有 NoteRepo。
type NoteRepoReader struct {
	repo *repository.NoteRepo
}

// NewNoteRepoReader 构造适配器。
func NewNoteRepoReader(repo *repository.NoteRepo) *NoteRepoReader {
	return &NoteRepoReader{repo: repo}
}

// GetNoteSnapshot 实现 NoteReader。
func (a *NoteRepoReader) GetNoteSnapshot(ctx context.Context, noteID int64) (*NoteSnapshot, error) {
	if a == nil || a.repo == nil {
		return nil, errors.New("note repo not configured")
	}
	n, err := a.repo.FindByID(ctx, noteID)
	if err != nil || n == nil {
		return nil, err
	}
	return &NoteSnapshot{
		ID:       n.ID,
		Title:    n.Title,
		Content:  n.ContentMarkdown,
		AuthorID: n.AuthorID,
	}, nil
}

// CreateNoteSnapshot 实现 NoteSourceWriter。
func (a *NoteRepoReader) CreateNoteSnapshot(ctx context.Context, title string, content string, authorID int64) (*NoteSnapshot, error) {
	if a == nil || a.repo == nil {
		return nil, errors.New("note repo not configured")
	}
	authorIDPtr := authorID
	n, err := a.repo.Create(ctx, &model.Note{
		Title:           title,
		ContentMarkdown: content,
		AuthorID:        &authorIDPtr,
		SourceType:      "manual",
		SourceMeta:      []byte(`{}`),
		WordCount:       len(strings.Fields(content)),
		EmbeddingStatus: "PENDING",
	})
	if err != nil {
		return nil, err
	}
	return &NoteSnapshot{
		ID:       n.ID,
		Title:    n.Title,
		Content:  n.ContentMarkdown,
		AuthorID: n.AuthorID,
	}, nil
}
