package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/markdown"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// ReadingBookService 编排「拟真阅读」的生成与读取逻辑：
// 从来源（文章 / 笔记 / 知识库文件）取出 Markdown 文本，一次性渲染成净化 HTML，
// 连同目录、字数落库；之后前台阅读器直接读取缓存即可。
type ReadingBookService struct {
	repo     *repository.ReadingBookRepo
	postRepo *repository.PostRepo
	noteRepo *repository.NoteRepo
}

// NewReadingBookService 创建服务实例。
func NewReadingBookService(
	repo *repository.ReadingBookRepo,
	postRepo *repository.PostRepo,
	noteRepo *repository.NoteRepo,
) *ReadingBookService {
	return &ReadingBookService{repo: repo, postRepo: postRepo, noteRepo: noteRepo}
}

// sourceContent 是从来源解析出的标准化中间结果。
type sourceContent struct {
	title    string
	author   *string
	cover    *string
	ref      *string
	markdown string
}

// Generate 根据来源生成（或重新生成）一本拟真阅读书，返回最新详情。
func (s *ReadingBookService) Generate(ctx context.Context, req dto.GenerateReadingBookRequest, userID int64) (*dto.ReadingBookDetail, error) {
	sc, err := s.resolveSource(ctx, req.SourceType, req.SourceID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(sc.markdown) == "" {
		return nil, errors.New("来源内容为空，无法生成拟真阅读")
	}

	rendered, err := markdown.Render(sc.markdown)
	if err != nil {
		return nil, fmt.Errorf("渲染失败: %w", err)
	}
	tocJSON, _ := json.Marshal(rendered.TOC)

	theme := req.Theme
	if theme == "" {
		theme = "paper"
	}
	now := time.Now()

	existing, err := s.repo.FindBySource(ctx, req.SourceType, req.SourceID)
	if err != nil {
		return nil, err
	}

	html := rendered.HTML
	if existing != nil {
		existing.Title = sc.title
		existing.Author = sc.author
		existing.CoverImage = sc.cover
		existing.SourceRef = sc.ref
		existing.ContentHTML = &html
		existing.TOC = tocJSON
		existing.WordCount = rendered.WordCount
		existing.ReadingTime = rendered.ReadingTime
		existing.Status = model.ReadingStatusReady
		existing.Error = nil
		existing.Theme = theme
		existing.GeneratedAt = &now
		updated, err := s.repo.Update(ctx, existing)
		if err != nil {
			return nil, err
		}
		detail := dto.ToReadingBookDetail(updated)
		return &detail, nil
	}

	slug, err := s.uniqueSlug(ctx, sc.title, req.SourceType, req.SourceID)
	if err != nil {
		return nil, err
	}
	// userID 为 0（未登录 / 系统触发）时存 NULL，语义上不存在 ID 为 0 的用户。
	var createdBy *int64
	if userID > 0 {
		createdBy = &userID
	}
	book := &model.ReadingBook{
		Slug:        slug,
		Title:       sc.title,
		Author:      sc.author,
		CoverImage:  sc.cover,
		SourceType:  req.SourceType,
		SourceID:    req.SourceID,
		SourceRef:   sc.ref,
		ContentHTML: &html,
		TOC:         tocJSON,
		WordCount:   rendered.WordCount,
		ReadingTime: rendered.ReadingTime,
		Status:      model.ReadingStatusReady,
		Theme:       theme,
		CreatedBy:   createdBy,
		GeneratedAt: &now,
	}
	created, err := s.repo.Create(ctx, book)
	if err != nil {
		return nil, err
	}
	detail := dto.ToReadingBookDetail(created)
	return &detail, nil
}

// resolveSource 把不同来源类型统一解析为 sourceContent。
func (s *ReadingBookService) resolveSource(ctx context.Context, sourceType string, sourceID int64) (*sourceContent, error) {
	switch sourceType {
	case model.ReadingSourcePost:
		post, err := s.postRepo.FindByID(ctx, sourceID)
		if err != nil {
			return nil, err
		}
		if post == nil {
			return nil, errors.New("文章不存在")
		}
		md := ""
		if post.ContentMarkdown != nil {
			md = *post.ContentMarkdown
		}
		ref := "文章"
		return &sourceContent{
			title:    post.Title,
			cover:    post.CoverImage,
			ref:      &ref,
			markdown: md,
		}, nil

	case model.ReadingSourceNote:
		note, err := s.noteRepo.FindByID(ctx, sourceID)
		if err != nil {
			return nil, err
		}
		if note == nil {
			return nil, errors.New("学习笔记不存在")
		}
		ref := "学习笔记"
		return &sourceContent{
			title:    note.Title,
			ref:      &ref,
			markdown: note.ContentMarkdown,
		}, nil

	case model.ReadingSourceKBFile:
		src, err := s.repo.FindKBFileSource(ctx, sourceID)
		if err != nil {
			return nil, err
		}
		if src == nil {
			return nil, errors.New("知识库文件不存在")
		}
		// 若该文件来源于站内文章，直接取文章 Markdown（更完整）。
		// 显式处理查询错误，避免临时故障被误判为「文章不存在」而错误退化到块重建。
		if src.PostID != nil {
			post, perr := s.postRepo.FindByID(ctx, *src.PostID)
			if perr != nil {
				return nil, perr
			}
			if post != nil && post.ContentMarkdown != nil {
				ref := "知识库 · " + src.KBName
				return &sourceContent{
					title:    post.Title,
					cover:    post.CoverImage,
					ref:      &ref,
					markdown: *post.ContentMarkdown,
				}, nil
			}
		}
		text, err := s.repo.ReconstructKBFileText(ctx, sourceID, src.VectorProfile)
		if err != nil {
			return nil, err
		}
		title := "知识库文件"
		if src.Title != nil && *src.Title != "" {
			title = *src.Title
		}
		ref := "知识库 · " + src.KBName
		return &sourceContent{
			title:    title,
			ref:      &ref,
			markdown: text,
		}, nil

	default:
		return nil, fmt.Errorf("不支持的来源类型: %s", sourceType)
	}
}

// List 后台书架分页。
func (s *ReadingBookService) List(ctx context.Context, f repository.ReadingBookListFilter) ([]dto.ReadingBookListItem, int64, error) {
	rows, total, err := s.repo.List(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	items := make([]dto.ReadingBookListItem, 0, len(rows))
	for i := range rows {
		items = append(items, dto.ToReadingBookListItem(&rows[i]))
	}
	return items, total, nil
}

// GetByID 后台详情（含正文）。
func (s *ReadingBookService) GetByID(ctx context.Context, id int64) (*dto.ReadingBookDetail, error) {
	b, err := s.repo.FindByID(ctx, id)
	if err != nil || b == nil {
		return nil, err
	}
	detail := dto.ToReadingBookDetail(b)
	return &detail, nil
}

// GetBySlug 前台阅读器读取（仅 READY 状态）。
func (s *ReadingBookService) GetBySlug(ctx context.Context, slug string) (*dto.ReadingBookDetail, error) {
	b, err := s.repo.FindBySlug(ctx, slug)
	if err != nil || b == nil {
		return nil, err
	}
	if b.Status != model.ReadingStatusReady {
		return nil, nil
	}
	detail := dto.ToReadingBookDetail(b)
	return &detail, nil
}

// Delete 删除一本书。
func (s *ReadingBookService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// uniqueSlug 生成唯一 slug。中文标题在去除非 ASCII 后通常为空，
// 因此统一附加来源类型与 ID 后缀以保证可读且唯一。
func (s *ReadingBookService) uniqueSlug(ctx context.Context, title, sourceType string, sourceID int64) (string, error) {
	base := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(title), "-"), "-")
	suffix := fmt.Sprintf("%s-%d", strings.ToLower(sourceType), sourceID)
	slug := suffix
	if base != "" {
		if len([]rune(base)) > 60 {
			base = string([]rune(base)[:60])
		}
		slug = base + "-" + suffix
	}
	// 理论上 (source_type, source_id) 唯一，suffix 已保证不冲突；仍做一次防御性校验。
	exists, err := s.repo.SlugExists(ctx, slug, 0)
	if err != nil {
		return "", err
	}
	if exists {
		slug = fmt.Sprintf("%s-%d", slug, time.Now().Unix())
	}
	return slug, nil
}
