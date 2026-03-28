package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

const draftKeyPrefix = "post:draft:"
const draftTTL = 7 * 24 * time.Hour

type PostService struct {
	repo    *repository.PostRepo
	catRepo *repository.CategoryRepo
	tagRepo *repository.TagRepo
	rdb     *redis.Client
}

func NewPostService(
	repo *repository.PostRepo,
	catRepo *repository.CategoryRepo,
	tagRepo *repository.TagRepo,
	rdb *redis.Client,
) *PostService {
	return &PostService{repo: repo, catRepo: catRepo, tagRepo: tagRepo, rdb: rdb}
}

// --- Admin ---

func (s *PostService) GetForAdmin(ctx context.Context, f dto.PostFilter) (*response.PageResult, error) {
	adminF := repository.AdminPostFilter{
		PageNum:  f.PageNum,
		PageSize: f.PageSize,
	}
	if f.Status != "" {
		adminF.Status = &f.Status
	}
	if f.Keyword != "" {
		adminF.Keyword = &f.Keyword
	}
	adminF.CategoryID = f.CategoryID
	adminF.TagID = f.TagID
	if f.MinViewCount != nil {
		v := int64(*f.MinViewCount)
		adminF.MinViewCount = &v
	}
	if f.MaxViewCount != nil {
		v := int64(*f.MaxViewCount)
		adminF.MaxViewCount = &v
	}
	if f.StartDate != nil {
		s := f.StartDate.Format(time.RFC3339)
		adminF.StartDate = &s
	}
	if f.EndDate != nil {
		e := f.EndDate.Format(time.RFC3339)
		adminF.EndDate = &e
	}
	adminF.Hidden = f.Hidden

	rows, total, err := s.repo.FindForAdmin(ctx, adminF)
	if err != nil {
		return nil, err
	}

	postIDs := make([]int64, len(rows))
	for i, r := range rows {
		postIDs[i] = r.ID
	}
	tagsMap, _ := s.repo.FindTagsByPostIDs(ctx, postIDs)

	items := make([]dto.PostListItem, len(rows))
	for i, r := range rows {
		items[i] = toListItem(&r.Post, r.CategoryName, tagsMap[r.ID])
	}
	pr := response.NewPageResult(items, total, f.PageNum, f.PageSize)
	return &pr, nil
}

func (s *PostService) GetByID(ctx context.Context, id int64) (*dto.PostDetail, error) {
	p, err := s.repo.FindByID(ctx, id)
	if err != nil || p == nil {
		return nil, err
	}
	return s.enrichDetail(ctx, p, true)
}

func (s *PostService) Create(ctx context.Context, req dto.CreatePostRequest, authorID int64) (*dto.PostDetail, error) {
	slug, err := s.resolveSlug(ctx, req.Slug, req.Title, 0)
	if err != nil {
		return nil, err
	}

	status := req.Status
	if status == "" {
		status = "DRAFT"
	}

	post := &model.Post{
		Title: req.Title, Slug: slug, ContentMarkdown: &req.Content,
		Summary: req.Summary, CoverImage: req.CoverImage, Status: status,
		CategoryID: req.CategoryID, AuthorID: &authorID,
		IsHidden: boolVal(req.IsHidden, false), IsPinned: boolVal(req.IsPinned, false),
		PinPriority: intVal(req.PinPriority, 0), AllowComment: boolVal(req.AllowComment, true),
		Password: req.Password, WordCount: countWords(req.Content),
		ReadingTime: calcReadingTime(req.Content),
	}
	if status == "PUBLISHED" && req.PublishedAt == nil {
		now := time.Now()
		post.PublishedAt = &now
	} else {
		post.PublishedAt = req.PublishedAt
	}

	if err := s.hashPostPassword(post); err != nil {
		return nil, err
	}

	out, err := s.repo.Create(ctx, post)
	if err != nil {
		return nil, err
	}

	if len(req.TagIDs) > 0 {
		s.repo.SetTags(ctx, out.ID, req.TagIDs)
	}

	return s.enrichDetail(ctx, out, true)
}

func (s *PostService) Update(ctx context.Context, id int64, req dto.CreatePostRequest, authorID int64) (*dto.PostDetail, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("文章不存在")
	}

	slug, err := s.resolveSlug(ctx, req.Slug, req.Title, id)
	if err != nil {
		return nil, err
	}

	status := req.Status
	if status == "" {
		status = existing.Status
	}

	post := &model.Post{
		Title: req.Title, Slug: slug, ContentMarkdown: &req.Content,
		Summary: req.Summary, CoverImage: req.CoverImage, Status: status,
		CategoryID: req.CategoryID, IsHidden: boolVal(req.IsHidden, existing.IsHidden),
		IsPinned: boolVal(req.IsPinned, existing.IsPinned),
		PinPriority: intVal(req.PinPriority, existing.PinPriority),
		AllowComment: boolVal(req.AllowComment, existing.AllowComment),
		Password: req.Password, WordCount: countWords(req.Content),
		ReadingTime: calcReadingTime(req.Content),
	}
	if status == "PUBLISHED" && existing.PublishedAt == nil {
		now := time.Now()
		post.PublishedAt = &now
	} else if req.PublishedAt != nil {
		post.PublishedAt = req.PublishedAt
	} else {
		post.PublishedAt = existing.PublishedAt
	}
	if err := s.hashPostPassword(post); err != nil {
		return nil, err
	}

	out, err := s.repo.Update(ctx, id, post)
	if err != nil {
		return nil, err
	}
	s.repo.SetTags(ctx, id, req.TagIDs)

	// Clear draft cache
	s.deleteDraft(ctx, id)
	return s.enrichDetail(ctx, out, true)
}

func (s *PostService) UpdateProperties(ctx context.Context, id int64, req dto.UpdatePostPropertiesRequest) (*dto.PostDetail, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("文章不存在")
	}

	fields := map[string]any{}
	if req.Title != nil {
		fields["title"] = *req.Title
	}
	if req.Summary != nil {
		fields["summary"] = *req.Summary
	}
	if req.CoverImage != nil {
		fields["cover_image"] = *req.CoverImage
	}
	if req.CategoryID != nil {
		fields["category_id"] = *req.CategoryID
	}
	if req.Status != nil {
		fields["status"] = *req.Status
		if *req.Status == "PUBLISHED" && existing.PublishedAt == nil {
			now := time.Now()
			fields["published_at"] = now
		}
	}
	if req.IsPinned != nil {
		fields["is_pinned"] = *req.IsPinned
	}
	if req.PinPriority != nil {
		fields["pin_priority"] = *req.PinPriority
	}
	if req.AllowComment != nil {
		fields["allow_comment"] = *req.AllowComment
	}
	if req.Password != nil {
		if *req.Password != "" {
			h, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
			if err != nil {
				return nil, err
			}
			s := string(h)
			fields["password"] = &s
		} else {
			fields["password"] = nil
		}
	}
	if req.IsHidden != nil {
		fields["is_hidden"] = *req.IsHidden
	}
	if req.Slug != nil {
		slug, err := s.resolveSlug(ctx, req.Slug, "", id)
		if err != nil {
			return nil, err
		}
		fields["slug"] = slug
	}
	if req.CreatedAt != nil {
		fields["created_at"] = *req.CreatedAt
	}
	if req.PublishedAt != nil {
		fields["published_at"] = *req.PublishedAt
	}
	if req.ViewCount != nil {
		fields["view_count"] = *req.ViewCount
	}

	out, err := s.repo.UpdateProperties(ctx, id, fields)
	if err != nil {
		return nil, err
	}

	if req.TagIDs != nil {
		s.repo.SetTags(ctx, id, req.TagIDs)
	}
	return s.enrichDetail(ctx, out, true)
}

func (s *PostService) AutoSave(ctx context.Context, id int64, req dto.CreatePostRequest) error {
	if s.rdb == nil {
		return nil // Redis unavailable
	}
	data, err := json.Marshal(req)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, draftKeyPrefix+fmt.Sprintf("%d", id), data, draftTTL).Err()
}

func (s *PostService) Delete(ctx context.Context, id int64) error {
	s.deleteDraft(ctx, id)
	return s.repo.SoftDelete(ctx, id)
}

func (s *PostService) Publish(ctx context.Context, id int64) error {
	now := time.Now()
	fields := map[string]any{"status": "PUBLISHED"}
	if p, _ := s.repo.FindByID(ctx, id); p != nil && p.PublishedAt == nil {
		fields["published_at"] = now
	}
	_, err := s.repo.UpdateProperties(ctx, id, fields)
	return err
}

// --- Public ---

func (s *PostService) GetPublished(ctx context.Context, p pagination.Params) (*response.PageResult, error) {
	rows, total, err := s.repo.FindPublished(ctx, p.PageNum, p.PageSize)
	if err != nil {
		return nil, err
	}
	postIDs := make([]int64, len(rows))
	for i, r := range rows {
		postIDs[i] = r.ID
	}
	tagsMap, _ := s.repo.FindTagsByPostIDs(ctx, postIDs)
	items := make([]dto.PostListItem, len(rows))
	for i, r := range rows {
		items[i] = toListItem(&r.Post, r.CategoryName, tagsMap[r.ID])
	}
	pr := response.NewPageResult(items, total, p.PageNum, p.PageSize)
	return &pr, nil
}

func (s *PostService) GetPublicBySlug(ctx context.Context, slug, password string) (*dto.PostDetail, error) {
	p, err := s.repo.FindBySlugPublished(ctx, slug)
	if err != nil || p == nil {
		return nil, err
	}
	detail, err := s.enrichDetail(ctx, p, false)
	if err != nil {
		return nil, err
	}

	// Password-protected
	if p.Password != nil && *p.Password != "" {
		if password == "" {
			// Return stub without content
			detail.Content = nil
			detail.PasswordRequired = true
			return detail, nil
		}
		if bcrypt.CompareHashAndPassword([]byte(*p.Password), []byte(password)) != nil {
			detail.Content = nil
			detail.PasswordRequired = true
			return detail, nil
		}
		detail.PasswordRequired = false
	}
	return detail, nil
}

func (s *PostService) GetByCategory(ctx context.Context, categoryID int64, p pagination.Params) (*response.PageResult, error) {
	rows, total, err := s.repo.FindByCategory(ctx, categoryID, p.PageNum, p.PageSize)
	if err != nil {
		return nil, err
	}
	postIDs := make([]int64, len(rows))
	for i, r := range rows {
		postIDs[i] = r.ID
	}
	tagsMap, _ := s.repo.FindTagsByPostIDs(ctx, postIDs)
	items := make([]dto.PostListItem, len(rows))
	for i, r := range rows {
		items[i] = toListItem(&r.Post, r.CategoryName, tagsMap[r.ID])
	}
	pr := response.NewPageResult(items, total, p.PageNum, p.PageSize)
	return &pr, nil
}

func (s *PostService) GetByTag(ctx context.Context, tagID int64, p pagination.Params) (*response.PageResult, error) {
	rows, total, err := s.repo.FindByTag(ctx, tagID, p.PageNum, p.PageSize)
	if err != nil {
		return nil, err
	}
	postIDs := make([]int64, len(rows))
	for i, r := range rows {
		postIDs[i] = r.ID
	}
	tagsMap, _ := s.repo.FindTagsByPostIDs(ctx, postIDs)
	items := make([]dto.PostListItem, len(rows))
	for i, r := range rows {
		items[i] = toListItem(&r.Post, r.CategoryName, tagsMap[r.ID])
	}
	pr := response.NewPageResult(items, total, p.PageNum, p.PageSize)
	return &pr, nil
}

func (s *PostService) GetAdjacentPosts(ctx context.Context, slug string) (*dto.AdjacentPostResponse, error) {
	p, err := s.repo.FindBySlugPublished(ctx, slug)
	if err != nil || p == nil {
		return &dto.AdjacentPostResponse{}, nil
	}
	if p.PublishedAt == nil {
		return &dto.AdjacentPostResponse{}, nil
	}
	prev, next, err := s.repo.FindAdjacentPosts(ctx, p.PublishedAt.Format(time.RFC3339Nano), p.ID)
	if err != nil {
		return nil, err
	}
	resp := &dto.AdjacentPostResponse{}
	if prev != nil {
		resp.Prev = &dto.AdjacentPost{ID: prev.ID, Title: prev.Title, Slug: prev.Slug}
	}
	if next != nil {
		resp.Next = &dto.AdjacentPost{ID: next.ID, Title: next.Title, Slug: next.Slug}
	}
	return resp, nil
}

func (s *PostService) IncrementViewCount(ctx context.Context, id int64) {
	s.repo.IncrementViewCount(ctx, id)
}

// --- Archives ---

func (s *PostService) GetArchives(ctx context.Context) (map[string][]dto.ArchiveItem, error) {
	m, err := s.repo.FindArchivePosts(ctx)
	if err != nil {
		return nil, err
	}
	result := make(map[string][]dto.ArchiveItem)
	for ym, posts := range m {
		items := make([]dto.ArchiveItem, len(posts))
		for i, p := range posts {
			date := ""
			if p.PublishedAt != nil {
				date = p.PublishedAt.Format("2006-01-02")
			}
			items[i] = dto.ArchiveItem{ID: p.ID, Title: p.Title, Slug: p.Slug, Date: date}
		}
		result[ym] = items
	}
	return result, nil
}

func (s *PostService) GetArchiveStats(ctx context.Context) ([]dto.ArchiveStats, error) {
	rows, err := s.repo.FindArchiveStats(ctx)
	if err != nil {
		return nil, err
	}
	stats := make([]dto.ArchiveStats, len(rows))
	for i, r := range rows {
		stats[i] = dto.ArchiveStats{YearMonth: r.YearMonth, Count: r.Count}
	}
	return stats, nil
}

// --- Helpers ---

func (s *PostService) enrichDetail(ctx context.Context, p *model.Post, includeAdminFields bool) (*dto.PostDetail, error) {
	tags, _ := s.repo.FindTagsByPostID(ctx, p.ID)
	tagInfos := make([]dto.TagInfo, len(tags))
	for i, t := range tags {
		tagInfos[i] = dto.TagInfo{ID: t.ID, Name: t.Name, Slug: t.Slug, Color: t.Color}
	}

	var catInfo *dto.CategoryInfo
	if p.CategoryID != nil {
		if cat, _ := s.catRepo.FindByID(ctx, *p.CategoryID); cat != nil {
			catInfo = &dto.CategoryInfo{ID: cat.ID, Name: cat.Name, Slug: cat.Slug}
		}
	}

	detail := &dto.PostDetail{
		ID: p.ID, Title: p.Title, Slug: p.Slug, Content: p.ContentMarkdown,
		Summary: p.Summary, CoverImage: p.CoverImage, Status: p.Status,
		Category: catInfo, Tags: tagInfos,
		ViewCount: p.ViewCount, CommentCount: p.CommentCount, LikeCount: p.LikeCount,
		WordCount: p.WordCount, ReadingTime: p.ReadingTime,
		IsPinned: p.IsPinned, PinPriority: p.PinPriority,
		IsHidden: p.IsHidden, AllowComment: p.AllowComment,
		PasswordRequired: p.Password != nil && *p.Password != "",
		SEOTitle: p.SEOTitle, SEODescription: p.SEODescription, SEOKeywords: p.SEOKeywords,
		LegacyAuthorName: p.LegacyAuthorName, LegacyVisitedCount: p.LegacyVisitedCount,
		PublishedAt: p.PublishedAt, ScheduledAt: p.ScheduledAt,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
	if includeAdminFields {
		detail.Password = p.Password
		detail.Draft = s.getDraft(ctx, p.ID)
	}
	return detail, nil
}

func (s *PostService) getDraft(ctx context.Context, id int64) *dto.CreatePostRequest {
	if s.rdb == nil {
		return nil
	}
	data, err := s.rdb.Get(ctx, draftKeyPrefix+fmt.Sprintf("%d", id)).Bytes()
	if err != nil {
		return nil
	}
	var req dto.CreatePostRequest
	if json.Unmarshal(data, &req) != nil {
		return nil
	}
	return &req
}

func (s *PostService) deleteDraft(ctx context.Context, id int64) {
	if s.rdb != nil {
		s.rdb.Del(ctx, draftKeyPrefix+fmt.Sprintf("%d", id))
	}
}

func (s *PostService) resolveSlug(ctx context.Context, reqSlug *string, title string, excludeID int64) (string, error) {
	var slug string
	if reqSlug != nil && *reqSlug != "" {
		slug = *reqSlug
	} else if title != "" {
		slug = generateSlug(title)
	}
	if slug == "" {
		slug = fmt.Sprintf("post-%d", time.Now().UnixMilli())
	}

	// Check uniqueness
	existing, err := s.repo.FindBySlug(ctx, slug)
	if err != nil {
		return "", err
	}
	if existing != nil && existing.ID != excludeID {
		// Append timestamp to make unique
		slug = fmt.Sprintf("%s-%d", slug, time.Now().UnixMilli()%10000)
	}
	return slug, nil
}

func (s *PostService) hashPostPassword(p *model.Post) error {
	if p.Password == nil || *p.Password == "" {
		p.Password = nil
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(*p.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	h := string(hash)
	p.Password = &h
	return nil
}

func toListItem(p *model.Post, catName *string, tags []model.Tag) dto.PostListItem {
	tagNames := make([]string, len(tags))
	for i, t := range tags {
		tagNames[i] = t.Name
	}
	return dto.PostListItem{
		ID: p.ID, Title: p.Title, Slug: p.Slug, Summary: p.Summary,
		CoverImage: p.CoverImage, Status: p.Status, CategoryName: catName,
		TagNames: tagNames, ViewCount: p.ViewCount, CommentCount: p.CommentCount,
		IsPinned: p.IsPinned, PinPriority: p.PinPriority, IsHidden: p.IsHidden,
		PasswordRequired: p.Password != nil && *p.Password != "",
		PublishedAt: p.PublishedAt, CreatedAt: p.CreatedAt,
	}
}

var nonAlphanumRe = regexp.MustCompile(`[^\w\s-]`)
var spacesRe = regexp.MustCompile(`[\s_]+`)

func generateSlug(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	// Keep CJK characters; strip other non-alphanumeric
	var sb strings.Builder
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF || r >= 0x3040 && r <= 0x30FF ||
			(r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == ' ' {
			sb.WriteRune(r)
		}
	}
	result := spacesRe.ReplaceAllString(sb.String(), "-")
	result = strings.Trim(result, "-")
	if result == "" {
		return fmt.Sprintf("post-%d", time.Now().UnixMilli())
	}
	if len(result) > 100 {
		result = result[:100]
	}
	return result
}

func countWords(content string) int {
	return utf8.RuneCountInString(strings.TrimSpace(content))
}

func calcReadingTime(content string) int {
	words := countWords(content)
	t := words / 300
	if t < 1 {
		return 1
	}
	return t
}

func boolVal(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}

func intVal(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}
