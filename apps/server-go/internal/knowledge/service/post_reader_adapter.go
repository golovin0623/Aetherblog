package service

import (
	"context"
	"errors"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// PostRepoReader 是 PostReader 的实现，背靠现有 PostRepo。
type PostRepoReader struct {
	repo *repository.PostRepo
}

// NewPostRepoReader 构造适配器。
func NewPostRepoReader(repo *repository.PostRepo) *PostRepoReader {
	return &PostRepoReader{repo: repo}
}

// GetPostSnapshot 实现 PostReader。
func (a *PostRepoReader) GetPostSnapshot(ctx context.Context, postID int64) (*PostSnapshot, error) {
	if a == nil || a.repo == nil {
		return nil, errors.New("post repo not configured")
	}
	p, err := a.repo.FindByID(ctx, postID)
	if err != nil || p == nil {
		return nil, err
	}
	content := ""
	if p.ContentMarkdown != nil {
		content = *p.ContentMarkdown
	}
	summary := ""
	if p.Summary != nil {
		summary = *p.Summary
	}
	return &PostSnapshot{
		ID:       p.ID,
		Title:    p.Title,
		Slug:     p.Slug,
		Status:   p.Status,
		Content:  content,
		Summary:  summary,
		AuthorID: p.AuthorID,
	}, nil
}
