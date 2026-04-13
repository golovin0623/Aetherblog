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

// draftKeyPrefix 是 Redis 中自动保存草稿的键前缀，格式为 "post:draft:<postID>"。
const draftKeyPrefix = "post:draft:"

// draftTTL 是 Redis 中自动保存草稿的过期时间（7 天）。
const draftTTL = 7 * 24 * time.Hour

// PostService 管理博客文章的增删改查及相关业务规则。
type PostService struct {
	repo    *repository.PostRepo
	catRepo *repository.CategoryRepo
	tagRepo *repository.TagRepo
	rdb     *redis.Client
}

// NewPostService 创建一个 PostService，依赖给定的仓储和 Redis 客户端。
// rdb 可为 nil；Redis 不可用时，草稿自动保存功能会静默禁用。
func NewPostService(
	repo *repository.PostRepo,
	catRepo *repository.CategoryRepo,
	tagRepo *repository.TagRepo,
	rdb *redis.Client,
) *PostService {
	return &PostService{repo: repo, catRepo: catRepo, tagRepo: tagRepo, rdb: rdb}
}

// --- 管理后台接口 ---

// GetForAdmin 返回供管理后台使用的分页文章列表。
// 包含所有状态（含草稿、隐藏文章），支持按状态、关键词、分类、标签、阅读量、日期范围过滤。
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

	// 批量查询文章标签，避免 N+1 查询
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

// GetByID 按主键返回文章完整详情，包含 Redis 中的草稿缓存（仅管理端使用）。
func (s *PostService) GetByID(ctx context.Context, id int64) (*dto.PostDetail, error) {
	p, err := s.repo.FindByID(ctx, id)
	if err != nil || p == nil {
		return nil, err
	}
	return s.enrichDetail(ctx, p, true)
}

// Create 持久化一篇新文章。
// 业务规则：
//   - 未提供 slug 时，从标题自动生成；
//   - 未提供 status 时，默认为 "DRAFT"；
//   - status 为 "PUBLISHED" 且未提供 published_at 时，自动设为当前时间；
//   - 密码字段（如存在）会经过 bcrypt 加密后存储。
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
	// 首次发布时自动记录发布时间
	if status == "PUBLISHED" && req.PublishedAt == nil {
		now := time.Now()
		post.PublishedAt = &now
	} else {
		post.PublishedAt = req.PublishedAt
	}

	// 对密码字段进行 bcrypt 加密
	if err := s.hashPostPassword(post); err != nil {
		return nil, err
	}

	out, err := s.repo.Create(ctx, post)
	if err != nil {
		return nil, err
	}

	// 写入文章标签关联
	if len(req.TagIDs) > 0 {
		s.repo.SetTags(ctx, out.ID, req.TagIDs)
	}

	return s.enrichDetail(ctx, out, true)
}

// Update 全量替换指定文章的内容，并清除对应的 Redis 草稿缓存。
// 业务规则：
//   - 文章不存在时返回错误；
//   - 首次从非发布状态变为 PUBLISHED 时，自动记录 published_at；
//   - 密码字段重新进行 bcrypt 加密；
//   - 更新完成后清除草稿缓存。
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
	// 首次发布时自动记录发布时间
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

	// 清除 Redis 草稿缓存
	s.deleteDraft(ctx, id)
	return s.enrichDetail(ctx, out, true)
}

// UpdateProperties 对文章进行局部属性更新，仅更新请求中明确提供的字段。
// 适用于切换置顶状态、修改发布状态等场景，不会覆盖其他字段。
// 业务规则：将状态改为 PUBLISHED 且文章尚未有发布时间时，自动记录当前时间。
func (s *PostService) UpdateProperties(ctx context.Context, id int64, req dto.UpdatePostPropertiesRequest) (*dto.PostDetail, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("文章不存在")
	}

	// 构建动态更新字段映射
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
		// 首次发布时自动记录发布时间
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
			// 对新密码进行 bcrypt 加密
			h, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
			if err != nil {
				return nil, err
			}
			s := string(h)
			fields["password"] = &s
		} else {
			// 空字符串表示清除密码
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

	// 如果请求中包含标签列表，则同步更新文章标签关联
	if req.TagIDs != nil {
		s.repo.SetTags(ctx, id, req.TagIDs)
	}
	return s.enrichDetail(ctx, out, true)
}

// AutoSave 将编辑器内容以 JSON 格式缓存到 Redis，过期时间为 7 天。
// 该操作为尽力而为（best-effort），Redis 不可用时静默返回 nil。
func (s *PostService) AutoSave(ctx context.Context, id int64, req dto.CreatePostRequest) error {
	if s.rdb == nil {
		return nil // Redis 不可用，静默跳过
	}
	data, err := json.Marshal(req)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, draftKeyPrefix+fmt.Sprintf("%d", id), data, draftTTL).Err()
}

// Delete 软删除指定文章，并清除对应的 Redis 草稿缓存。
func (s *PostService) Delete(ctx context.Context, id int64) error {
	s.deleteDraft(ctx, id)
	return s.repo.SoftDelete(ctx, id)
}

// Publish 将文章状态设置为 PUBLISHED。
// 若文章尚未记录 published_at，则自动设为当前时间。
func (s *PostService) Publish(ctx context.Context, id int64) error {
	now := time.Now()
	fields := map[string]any{"status": "PUBLISHED"}
	if p, _ := s.repo.FindByID(ctx, id); p != nil && p.PublishedAt == nil {
		fields["published_at"] = now
	}
	_, err := s.repo.UpdateProperties(ctx, id, fields)
	return err
}

// --- 公开前台接口 ---

// GetPublished 返回供博客前台展示的已发布、可见文章分页列表。
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

// GetPublicBySlug 按 slug 返回已发布文章的公开详情。
// 密码保护规则：
//   - 文章设有密码且请求未提供密码时，返回无正文内容的存根并设 PasswordRequired=true；
//   - 密码错误时同样返回存根；
//   - 同时支持明文密码（遗留）和 bcrypt 哈希密码校验。
func (s *PostService) GetPublicBySlug(ctx context.Context, slug, password string) (*dto.PostDetail, error) {
	p, err := s.repo.FindBySlugPublished(ctx, slug)
	if err != nil || p == nil {
		return nil, err
	}
	detail, err := s.enrichDetail(ctx, p, false)
	if err != nil {
		return nil, err
	}

	// 处理密码保护逻辑
	if p.Password != nil && *p.Password != "" {
		if password == "" {
			// 未提供密码，返回不含正文的存根
			detail.Content = nil
			detail.PasswordRequired = true
			return detail, nil
		}
		// 仅支持 bcrypt 哈希密码校验（已移除明文比较）
		if bcrypt.CompareHashAndPassword([]byte(*p.Password), []byte(password)) != nil {
			// 密码错误，返回存根
			detail.Content = nil
			detail.PasswordRequired = true
			return detail, nil
		}
		detail.PasswordRequired = false
	}
	return detail, nil
}

// GetByCategory 返回指定分类下的分页已发布文章列表。
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

// GetByTag 返回携带指定标签的分页已发布文章列表。
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

// GetAdjacentPosts 返回指定 slug 文章的上一篇和下一篇（按发布时间排序）。
// 若 slug 不存在或文章无发布时间，返回空的 AdjacentPostResponse。
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
		resp.PrevPost = &dto.AdjacentPost{ID: prev.ID, Title: prev.Title, Slug: prev.Slug}
	}
	if next != nil {
		resp.NextPost = &dto.AdjacentPost{ID: next.ID, Title: next.Title, Slug: next.Slug}
	}
	return resp, nil
}

// IncrementViewCount 异步递增文章的阅读计数。
// 推荐通过 goroutine 调用（go s.IncrementViewCount(...)），避免阻塞 HTTP 响应。
func (s *PostService) IncrementViewCount(ctx context.Context, id int64) {
	s.repo.IncrementViewCount(ctx, id)
}

// --- 归档接口 ---

// GetArchives 返回已发布文章按 "YYYY-MM" 年月分组的归档数据，最新月份在前。
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

// GetArchiveStats 返回各月份的发布文章数量，用于归档侧边栏组件展示。
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

// --- 内部辅助函数 ---

// enrichDetail 从 Post 模型构建 PostDetail DTO，同时加载关联的标签和分类信息。
// includeAdminFields 为 true 时，额外返回密码哈希和 Redis 草稿缓存（仅管理端使用）。
func (s *PostService) enrichDetail(ctx context.Context, p *model.Post, includeAdminFields bool) (*dto.PostDetail, error) {
	// 查询关联标签
	tags, _ := s.repo.FindTagsByPostID(ctx, p.ID)
	tagInfos := make([]dto.TagInfo, len(tags))
	for i, t := range tags {
		tagInfos[i] = dto.TagInfo{ID: t.ID, Name: t.Name, Slug: t.Slug, Color: t.Color}
	}

	// 查询关联分类
	var catInfo *dto.CategoryInfo
	if p.CategoryID != nil {
		if cat, _ := s.catRepo.FindByID(ctx, *p.CategoryID); cat != nil {
			catInfo = &dto.CategoryInfo{ID: cat.ID, Name: cat.Name, Slug: cat.Slug}
		}
	}

	var catID *int64
	var catName *string
	if catInfo != nil {
		catID = &catInfo.ID
		catName = &catInfo.Name
	}

	detail := &dto.PostDetail{
		ID: p.ID, Title: p.Title, Slug: p.Slug, Content: p.ContentMarkdown,
		Summary: p.Summary, CoverImage: p.CoverImage, Status: p.Status,
		Category: catInfo, CategoryID: catID, CategoryName: catName, Tags: tagInfos,
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
	// 管理端专用字段：是否设置了密码（不暴露密码哈希）及草稿缓存
	if includeAdminFields {
		detail.HasPassword = p.Password != nil && *p.Password != ""
		detail.Draft = s.getDraft(ctx, p.ID)
	}
	return detail, nil
}

// getDraft 从 Redis 读取指定文章的草稿缓存，Redis 不可用或数据无效时返回 nil。
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

// deleteDraft 从 Redis 中删除指定文章的草稿缓存。
func (s *PostService) deleteDraft(ctx context.Context, id int64) {
	if s.rdb != nil {
		s.rdb.Del(ctx, draftKeyPrefix+fmt.Sprintf("%d", id))
	}
}

// resolveSlug 推导出唯一的文章 slug。
// 优先使用请求中提供的 slug；否则从标题自动生成；两者均为空时使用毫秒时间戳。
// excludeID 用于排除当前编辑文章本身，防止误判为 slug 冲突。
// 若 slug 已被其他文章使用，则追加时间戳后缀以确保唯一性。
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

	// 检查 slug 唯一性
	existing, err := s.repo.FindBySlug(ctx, slug)
	if err != nil {
		return "", err
	}
	if existing != nil && existing.ID != excludeID {
		// slug 已被其他文章占用，追加时间戳后缀确保唯一
		slug = fmt.Sprintf("%s-%d", slug, time.Now().UnixMilli()%10000)
	}
	return slug, nil
}

// hashPostPassword 将文章的明文密码字段替换为 bcrypt 哈希值。
// 密码字段为空时清空该字段。
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

// toListItem 将 Post 模型转换为列表视图对象（PostListItem）。
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

// nonAlphanumRe 匹配非字母数字字符（用于 slug 清理）。
var nonAlphanumRe = regexp.MustCompile(`[^\w\s-]`)

// spacesRe 匹配空白和下划线序列（用于 slug 中替换为连字符）。
var spacesRe = regexp.MustCompile(`[\s_]+`)

// generateSlug 将文章标题转换为 URL 友好的 slug。
// 保留拉丁字母数字、连字符以及 CJK（中日韩）字符；
// 连续空白替换为连字符；结果截断至 100 个字符。
func generateSlug(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	// 保留 CJK 字符，去除其他非字母数字字符
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
	// 截断至 100 个字符，防止 slug 过长
	if len(result) > 100 {
		result = result[:100]
	}
	return result
}

// countWords 返回内容字符串（去除首尾空白后）的 Unicode 字符数。
// 用作跨语言的字数统计代理指标。
func countWords(content string) int {
	return utf8.RuneCountInString(strings.TrimSpace(content))
}

// calcReadingTime 按 300 字/分钟估算阅读时长（分钟），最小值为 1 分钟。
func calcReadingTime(content string) int {
	words := countWords(content)
	t := words / 300
	if t < 1 {
		return 1
	}
	return t
}

// boolVal 从指针中安全读取布尔值，指针为 nil 时返回默认值。
func boolVal(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}

// intVal 从指针中安全读取整数值，指针为 nil 时返回默认值。
func intVal(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}
