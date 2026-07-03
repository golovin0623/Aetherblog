package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/pkg/anchoring"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// PostReader 是 BlogPostCarrierService 需要的最小 post 读接口。
type PostReader interface {
	GetPostSnapshot(ctx context.Context, postID int64) (*PostSnapshot, error)
}

// PostSnapshot 是 Atlas 需要的 post 字段子集。
type PostSnapshot struct {
	ID       int64
	Title    string
	Slug     string
	Status   string
	Content  string
	Summary  string
	AuthorID *int64
}

// BlogPostCarrierService 处理 blog_post 类型载体（背靠 posts 表）。
type BlogPostCarrierService struct {
	carriers   *repository.CarrierRepo
	posts      PostReader
	versioning *CarrierVersioningService
}

// NewBlogPostCarrierService 创建服务。
func NewBlogPostCarrierService(carriers *repository.CarrierRepo, posts PostReader) *BlogPostCarrierService {
	return &BlogPostCarrierService{carriers: carriers, posts: posts}
}

// AttachVersioning 注入版本迁移服务。
func (s *BlogPostCarrierService) AttachVersioning(v *CarrierVersioningService) {
	s.versioning = v
}

// GetOrCreateForPostAs 懒创建/返回当前调用者可访问的 blog_post carrier。
func (s *BlogPostCarrierService) GetOrCreateForPostAs(ctx context.Context, postID int64, userID int64, canAdmin bool) (*model.Carrier, error) {
	if s.carriers == nil {
		return nil, errors.New("carrier repo not configured")
	}
	uri := BlogPostSourceURI(postID)
	post, err := s.loadScopedPost(ctx, postID, userID, canAdmin)
	if err != nil {
		return nil, fmt.Errorf("load post %d: %w", postID, err)
	}

	text := BlogPostText(post)
	hash := contentSHA256(text)
	storageURI := BlogPostTextLayerStorageURI(post.ID, hash)
	metadata, err := blogPostMetadata(post, text, storageURI)
	if err != nil {
		return nil, fmt.Errorf("marshal post metadata: %w", err)
	}
	candidate := &model.Carrier{
		Type:        "blog_post",
		SourceURI:   uri,
		ContentHash: hash,
		Title:       firstNonEmpty(post.Title, fmt.Sprintf("post-%d", post.ID)),
		Metadata:    metadata,
		OwnerID:     post.AuthorID,
		Status:      "ready",
	}
	carrier, justCreated, err := s.carriers.UpsertBySourceURI(ctx, candidate, storageURI)
	if err != nil {
		return nil, fmt.Errorf("upsert carrier: %w", err)
	}
	if !justCreated && carrier.ContentHash != hash {
		if s.versioning != nil {
			if _, err := s.versioning.MigrateAnnotations(ctx, carrier.ID, text); err != nil {
				return nil, fmt.Errorf("migrate annotations before hash bump: %w", err)
			}
		}
		if err := s.persistTextLayer(ctx, carrier.ID, hash, storageURI, text); err != nil {
			return nil, err
		}
		diff := []byte(`{"reason":"post_edited"}`)
		if err := s.carriers.UpdateContent(ctx, carrier.ID, hash, storageURI, "post_edit", diff); err != nil {
			return nil, fmt.Errorf("update carrier content after migration: %w", err)
		}
		if err := s.carriers.UpdateDisplayAndIngestState(ctx, carrier.ID, candidate.Title, candidate.Author, candidate.Language, metadata, "ready", nil); err != nil {
			return nil, fmt.Errorf("update carrier metadata after content change: %w", err)
		}
		carrier.ContentHash = hash
		carrier.Title = candidate.Title
		carrier.Metadata = metadata
		carrier.Status = "ready"
		carrier.StatusMessage = nil
		return carrier, nil
	}
	if err := s.persistTextLayer(ctx, carrier.ID, hash, storageURI, text); err != nil {
		return nil, err
	}
	if !justCreated {
		if err := s.carriers.UpdateDisplayAndIngestState(ctx, carrier.ID, candidate.Title, candidate.Author, candidate.Language, metadata, "ready", nil); err != nil {
			return nil, fmt.Errorf("refresh carrier metadata: %w", err)
		}
		carrier.Title = candidate.Title
		carrier.Metadata = metadata
		carrier.Status = "ready"
		carrier.StatusMessage = nil
	}
	return carrier, nil
}

// GetPostSourceAs 返回当前调用者可访问的 post source 内容。
func (s *BlogPostCarrierService) GetPostSourceAs(ctx context.Context, postID int64, userID int64, canAdmin bool) (*PostSnapshot, error) {
	return s.loadScopedPost(ctx, postID, userID, canAdmin)
}

func (s *BlogPostCarrierService) loadScopedPost(ctx context.Context, postID int64, userID int64, canAdmin bool) (*PostSnapshot, error) {
	if postID <= 0 {
		return nil, errors.New("invalid post id")
	}
	if s.posts == nil {
		return nil, errors.New("post reader not configured")
	}
	post, err := s.posts.GetPostSnapshot(ctx, postID)
	if err != nil {
		return nil, err
	}
	if post == nil {
		return nil, fmt.Errorf("post %d not found", postID)
	}
	if !canAdmin && (post.AuthorID == nil || *post.AuthorID != userID) {
		return nil, ErrAtlasForbidden
	}
	return post, nil
}

// BlogPostSourceURI 构造 blog_post 载体的 source_uri。
func BlogPostSourceURI(postID int64) string {
	return fmt.Sprintf("posts://%d", postID)
}

// BlogPostTextLayerStorageURI 为博客文章快照构造不可变的 rootText 存储 URI。
func BlogPostTextLayerStorageURI(postID int64, hash string) string {
	return fmt.Sprintf("atlas-text-layer://blog-post/%d/%s", postID, hash)
}

// BlogPostText 构造用于 carrier-level AI 建议和标注迁移的稳定文本空间。
func BlogPostText(post *PostSnapshot) string {
	if post == nil {
		return ""
	}
	parts := make([]string, 0, 3)
	if title := strings.TrimSpace(post.Title); title != "" {
		parts = append(parts, title)
	}
	if summary := strings.TrimSpace(post.Summary); summary != "" {
		parts = append(parts, summary)
	}
	if content := strings.TrimSpace(anchoring.MarkdownToPlaintext(post.Content)); content != "" {
		parts = append(parts, content)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func (s *BlogPostCarrierService) persistTextLayer(ctx context.Context, carrierID int64, hash, storageURI, text string) error {
	charCount := textLayerCharCount(text)
	pages, err := json.Marshal([]map[string]any{{
		"page":       1,
		"text":       text,
		"char_start": 0,
		"char_end":   charCount,
	}})
	if err != nil {
		return fmt.Errorf("marshal blog post text page: %w", err)
	}
	if err := s.carriers.UpsertTextLayer(ctx, &model.CarrierTextLayer{
		CarrierID:   carrierID,
		ContentHash: hash,
		StorageURI:  storageURI,
		PageCount:   1,
		CharCount:   charCount,
		TextContent: text,
		Pages:       pages,
	}); err != nil {
		return fmt.Errorf("persist blog post text layer: %w", err)
	}
	return nil
}

func blogPostMetadata(post *PostSnapshot, text string, storageURI string) ([]byte, error) {
	if post == nil {
		return json.Marshal(map[string]any{})
	}
	return json.Marshal(map[string]any{
		"slug":          strings.TrimSpace(post.Slug),
		"status":        strings.TrimSpace(post.Status),
		"textLayerURI":  storageURI,
		"contentFormat": "markdown",
		"charCount":     textLayerCharCount(text),
	})
}
