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

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

const noteDraftKeyPrefix = "note:draft:"

var allowedNoteSourceTypes = map[string]bool{
	"manual":  true,
	"web":     true,
	"article": true,
	"chat":    true,
	"import":  true,
	"api":     true,
}

var (
	inlineTagRE = regexp.MustCompile(`(?:^|\s)#([\p{L}\p{N}_-]+)`)
	noteLinkRE  = regexp.MustCompile(`\[\[([^\[\]]+)\]\]`)
)

// ParsedNoteLink 是 wiki link 解析结果。
type ParsedNoteLink = repository.ParsedNoteLink

// NoteService 管理后台私有智能笔记。
type NoteService struct {
	repo *repository.NoteRepo
	rdb  *redis.Client
}

// NewNoteService 创建 NoteService。
func NewNoteService(repo *repository.NoteRepo, rdb *redis.Client) *NoteService {
	return &NoteService{repo: repo, rdb: rdb}
}

// GetOwnership 返回笔记存在标志与作者 ID。
func (s *NoteService) GetOwnership(ctx context.Context, id int64) (bool, *int64, error) {
	return s.repo.FindOwnership(ctx, id)
}

// GetForAdmin 返回后台笔记分页列表。
func (s *NoteService) GetForAdmin(ctx context.Context, f dto.NoteFilter) (*response.PageResult, error) {
	view := f.View
	if view == "" {
		view = "all"
	}
	adminF := repository.AdminNoteFilter{
		View:     &view,
		PageNum:  f.PageNum,
		PageSize: f.PageSize,
	}
	if f.Keyword != "" {
		adminF.Keyword = &f.Keyword
	}
	adminF.FolderID = f.FolderID
	if f.Tag != "" {
		adminF.Tag = &f.Tag
	}
	if f.SourceType != "" {
		adminF.SourceType = &f.SourceType
	}
	adminF.Archived = f.Archived

	rows, total, err := s.repo.FindForAdmin(ctx, adminF)
	if err != nil {
		return nil, err
	}
	items := make([]dto.NoteListItem, len(rows))
	for i, row := range rows {
		items[i] = toNoteListItem(&row.Note, row.FolderName, []string(row.TagNames))
	}
	pr := response.NewPageResult(items, total, f.PageNum, f.PageSize)
	return &pr, nil
}

// GetByID 返回笔记详情, 包含 Redis 自动保存草稿。
func (s *NoteService) GetByID(ctx context.Context, id int64, userID int64) (*dto.NoteDetail, error) {
	n, err := s.repo.FindByID(ctx, id)
	if err != nil || n == nil {
		return nil, err
	}
	_ = s.repo.MarkOpened(ctx, id, time.Now())
	return s.enrichDetail(ctx, n, userID)
}

// Create 创建笔记。
func (s *NoteService) Create(ctx context.Context, req dto.CreateNoteRequest, authorID int64) (*dto.NoteDetail, error) {
	content := stringPtrVal(req.ContentMarkdown)
	title := resolveNoteTitle(stringPtrVal(req.Title), content, time.Now())
	sourceType := stringPtrVal(req.SourceType)
	if sourceType == "" {
		sourceType = "manual"
	}
	if !allowedNoteSourceTypes[sourceType] {
		return nil, fmt.Errorf("不支持的来源类型: %s", sourceType)
	}
	sourceMeta, err := marshalSourceMeta(req.SourceMeta)
	if err != nil {
		return nil, err
	}
	authorPtr := noteAuthorPtr(authorID)
	n := &model.Note{
		Title:           title,
		ContentMarkdown: content,
		Summary:         req.Summary,
		FolderID:        req.FolderID,
		AuthorID:        authorPtr,
		SourceType:      sourceType,
		SourceURL:       req.SourceURL,
		SourceTitle:     req.SourceTitle,
		SourceMeta:      sourceMeta,
		IsPinned:        boolVal(req.IsPinned, false),
		IsFavorite:      boolVal(req.IsFavorite, false),
		WordCount:       countWords(content),
		EmbeddingStatus: "PENDING",
	}
	out, err := s.repo.CreateWithRelations(ctx, n, normalizeNoteTags(req.TagNames, content), parseNoteLinks(content))
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, out.ID, authorID)
}

// Update 全量保存笔记内容。
func (s *NoteService) Update(ctx context.Context, id int64, req dto.CreateNoteRequest, userID int64) (*dto.NoteDetail, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("笔记不存在")
	}
	content := stringPtrVal(req.ContentMarkdown)
	title := resolveNoteTitle(stringPtrVal(req.Title), content, time.Now())
	sourceType := stringPtrVal(req.SourceType)
	if sourceType == "" {
		sourceType = existing.SourceType
	}
	if !allowedNoteSourceTypes[sourceType] {
		return nil, fmt.Errorf("不支持的来源类型: %s", sourceType)
	}
	sourceMeta, err := marshalSourceMeta(req.SourceMeta)
	if err != nil {
		return nil, err
	}
	n := &model.Note{
		Title:           title,
		ContentMarkdown: content,
		Summary:         req.Summary,
		FolderID:        req.FolderID,
		SourceType:      sourceType,
		SourceURL:       req.SourceURL,
		SourceTitle:     req.SourceTitle,
		SourceMeta:      sourceMeta,
		IsPinned:        boolVal(req.IsPinned, existing.IsPinned),
		IsFavorite:      boolVal(req.IsFavorite, existing.IsFavorite),
		WordCount:       countWords(content),
		EmbeddingStatus: "PENDING",
	}
	if _, err := s.repo.UpdateWithRelations(ctx, id, n, normalizeNoteTags(req.TagNames, content), parseNoteLinks(content)); err != nil {
		return nil, err
	}
	s.deleteDraft(ctx, id, userID)
	return s.GetByID(ctx, id, userID)
}

// UpdateProperties 局部更新笔记属性。
func (s *NoteService) UpdateProperties(ctx context.Context, id int64, req dto.UpdateNotePropertiesRequest, userID int64) (*dto.NoteDetail, error) {
	fields := map[string]any{}
	if req.Title != nil {
		fields["title"] = strings.TrimSpace(*req.Title)
	}
	if req.Summary != nil {
		fields["summary"] = req.Summary
	}
	if req.FolderID != nil {
		fields["folder_id"] = req.FolderID
	}
	if req.SourceType != nil {
		if !allowedNoteSourceTypes[*req.SourceType] {
			return nil, fmt.Errorf("不支持的来源类型: %s", *req.SourceType)
		}
		fields["source_type"] = *req.SourceType
	}
	if req.SourceURL != nil {
		fields["source_url"] = req.SourceURL
	}
	if req.SourceTitle != nil {
		fields["source_title"] = req.SourceTitle
	}
	if req.SourceMeta != nil {
		sourceMeta, err := marshalSourceMeta(req.SourceMeta)
		if err != nil {
			return nil, err
		}
		fields["source_meta"] = sourceMeta
	}
	if req.IsPinned != nil {
		fields["is_pinned"] = *req.IsPinned
	}
	if req.IsFavorite != nil {
		fields["is_favorite"] = *req.IsFavorite
	}
	if req.Archived != nil {
		fields["archived"] = *req.Archived
	}
	n, err := s.repo.UpdateProperties(ctx, id, fields)
	if err != nil || n == nil {
		return nil, err
	}
	if req.TagNames != nil {
		if err := s.repo.ReplaceTags(ctx, id, normalizeNoteTags(req.TagNames, "")); err != nil {
			return nil, err
		}
	}
	return s.GetByID(ctx, id, userID)
}

// AutoSave 将笔记草稿保存到 Redis。
func (s *NoteService) AutoSave(ctx context.Context, id int64, userID int64, req dto.AutoSaveNoteRequest) error {
	if s.rdb == nil {
		return nil
	}
	draft := dto.CreateNoteRequest{
		Title:           req.Title,
		ContentMarkdown: req.ContentMarkdown,
		FolderID:        req.FolderID,
		TagNames:        req.TagNames,
		SourceMeta:      req.SourceMeta,
	}
	data, err := json.Marshal(draft)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, noteDraftKey(id, userID), data, draftTTL).Err()
}

// Delete 软删除笔记。
func (s *NoteService) Delete(ctx context.Context, id int64, userID int64) error {
	s.deleteDraft(ctx, id, userID)
	return s.repo.SoftDelete(ctx, id)
}

// Duplicate 复制笔记。
func (s *NoteService) Duplicate(ctx context.Context, id int64, authorID int64) (*dto.NoteDetail, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("笔记不存在")
	}
	title := existing.Title + " 副本"
	authorPtr := noteAuthorPtr(authorID)
	out, err := s.repo.DuplicateWithRelations(ctx, id, title, authorPtr, parseNoteLinks(existing.ContentMarkdown))
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, out.ID, authorID)
}

// ListFolders 返回笔记文件夹。
func (s *NoteService) ListFolders(ctx context.Context) ([]dto.NoteFolderItem, error) {
	folders, err := s.repo.ListFolders(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]dto.NoteFolderItem, len(folders))
	for i, f := range folders {
		items[i] = dto.NoteFolderItem{ID: f.ID, Name: f.Name, ParentID: f.ParentID, SortOrder: f.SortOrder, CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt}
	}
	return items, nil
}

// CreateFolder 创建笔记文件夹。
func (s *NoteService) CreateFolder(ctx context.Context, req dto.CreateNoteFolderRequest) (*dto.NoteFolderItem, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("文件夹名称不能为空")
	}
	f := &model.NoteFolder{Name: name, ParentID: req.ParentID, SortOrder: intVal(req.SortOrder, 100)}
	out, err := s.repo.CreateFolder(ctx, f)
	if err != nil {
		return nil, err
	}
	item := dto.NoteFolderItem{ID: out.ID, Name: out.Name, ParentID: out.ParentID, SortOrder: out.SortOrder, CreatedAt: out.CreatedAt, UpdatedAt: out.UpdatedAt}
	return &item, nil
}

// ListTags 返回笔记标签。
func (s *NoteService) ListTags(ctx context.Context) ([]dto.NoteTagItem, error) {
	tags, err := s.repo.ListTags(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]dto.NoteTagItem, len(tags))
	for i, t := range tags {
		items[i] = dto.NoteTagItem{ID: t.ID, Name: t.Name, Color: t.Color}
	}
	return items, nil
}

// BackLinks 返回反向链接。
func (s *NoteService) BackLinks(ctx context.Context, id int64) ([]dto.NoteLinkItem, error) {
	return s.repo.FindBackLinks(ctx, id)
}

func (s *NoteService) enrichDetail(ctx context.Context, n *model.Note, userID int64) (*dto.NoteDetail, error) {
	tags, _ := s.repo.GetTagNames(ctx, n.ID)
	outLinks, _ := s.repo.FindOutLinks(ctx, n.ID)
	backLinks, _ := s.repo.FindBackLinks(ctx, n.ID)
	sourceMeta := unmarshalSourceMeta(n.SourceMeta)
	detail := &dto.NoteDetail{
		NoteListItem:    toNoteListItem(n, nil, tags),
		ContentMarkdown: n.ContentMarkdown,
		SourceURL:       n.SourceURL,
		SourceTitle:     n.SourceTitle,
		SourceMeta:      sourceMeta,
		OutLinks:        outLinks,
		BackLinks:       backLinks,
	}
	if s.rdb != nil {
		if data, err := s.rdb.Get(ctx, noteDraftKey(n.ID, userID)).Bytes(); err == nil && len(data) > 0 {
			var draft dto.CreateNoteRequest
			if json.Unmarshal(data, &draft) == nil {
				detail.Draft = &draft
			}
		}
	}
	return detail, nil
}

func (s *NoteService) deleteDraft(ctx context.Context, id int64, userID int64) {
	if s.rdb != nil {
		s.rdb.Del(ctx, noteDraftKey(id, userID))
	}
}

func noteDraftKey(noteID int64, userID int64) string {
	return fmt.Sprintf("%s%d:user:%d", noteDraftKeyPrefix, noteID, userID)
}

func noteAuthorPtr(authorID int64) *int64 {
	if authorID <= 0 {
		return nil
	}
	return &authorID
}

func toNoteListItem(n *model.Note, folderName *string, tagNames []string) dto.NoteListItem {
	return dto.NoteListItem{
		ID:              n.ID,
		Title:           n.Title,
		Summary:         n.Summary,
		FolderID:        n.FolderID,
		FolderName:      folderName,
		TagNames:        tagNames,
		SourceType:      n.SourceType,
		IsPinned:        n.IsPinned,
		IsFavorite:      n.IsFavorite,
		Archived:        n.Archived,
		WordCount:       n.WordCount,
		EmbeddingStatus: n.EmbeddingStatus,
		LastOpenedAt:    n.LastOpenedAt,
		CreatedAt:       n.CreatedAt,
		UpdatedAt:       n.UpdatedAt,
	}
}

func resolveNoteTitle(title, content string, now time.Time) string {
	if t := strings.TrimSpace(title); t != "" {
		return truncateRunes(t, 200)
	}
	for _, line := range strings.Split(content, "\n") {
		clean := stripMarkdownTitle(line)
		if clean != "" {
			return truncateRunes(clean, 60)
		}
	}
	return "未命名笔记 " + now.Format("2006-01-02 15:04")
}

func stripMarkdownTitle(line string) string {
	s := strings.TrimSpace(line)
	s = strings.TrimLeft(s, "#>-*+ \t")
	if len(s) > 2 && s[0] >= '0' && s[0] <= '9' {
		if idx := strings.Index(s, "."); idx > 0 && idx < 4 {
			s = strings.TrimSpace(s[idx+1:])
		}
	}
	s = strings.Trim(s, "`*_[]()")
	return strings.TrimSpace(s)
}

func normalizeNoteTags(explicit []string, content string) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(tag string) {
		tag = strings.TrimSpace(tag)
		tag = strings.TrimSpace(strings.TrimPrefix(tag, "#"))
		if tag == "" {
			return
		}
		tag = truncateRunes(tag, 80)
		key := strings.ToLower(tag)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, tag)
	}
	for _, tag := range explicit {
		add(tag)
	}
	for _, tag := range extractInlineTags(content) {
		add(tag)
	}
	return out
}

func extractInlineTags(content string) []string {
	tags := []string{}
	inFence := false
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		for _, match := range inlineTagRE.FindAllStringSubmatch(stripInlineCode(line), -1) {
			if len(match) > 1 {
				tags = append(tags, match[1])
			}
		}
	}
	return tags
}

func stripInlineCode(line string) string {
	var b strings.Builder
	b.Grow(len(line))
	inCode := false
	for _, r := range line {
		if r == '`' {
			inCode = !inCode
			b.WriteRune(' ')
			continue
		}
		if inCode {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func parseNoteLinks(content string) []ParsedNoteLink {
	seen := map[string]bool{}
	links := []ParsedNoteLink{}
	for _, loc := range noteLinkRE.FindAllStringSubmatchIndex(content, -1) {
		if len(loc) < 4 {
			continue
		}
		raw := strings.TrimSpace(content[loc[2]:loc[3]])
		if raw == "" || seen[raw] {
			continue
		}
		seen[raw] = true
		start, end := loc[0], loc[1]
		links = append(links, ParsedNoteLink{
			TargetTitle:   truncateRunes(raw, 200),
			LinkText:      truncateRunes(raw, 200),
			PositionStart: &start,
			PositionEnd:   &end,
		})
	}
	return links
}

func marshalSourceMeta(meta map[string]any) ([]byte, error) {
	if meta == nil {
		return []byte(`{}`), nil
	}
	return json.Marshal(meta)
}

func unmarshalSourceMeta(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func stringPtrVal(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func truncateRunes(s string, limit int) string {
	if limit <= 0 || utf8.RuneCountInString(s) <= limit {
		return s
	}
	runes := []rune(s)
	return string(runes[:limit])
}
