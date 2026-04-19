package service

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jmoiron/sqlx"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// MigrationService 编排 VanBlog 备份的解析、分析与执行三阶段。
//   - Analyze(): 不写 DB，返回 AnalysisReport（dry-run 的原地升级版）。
//   - Execute(): 分阶段事务 + 批量 SQL，边写边通过 emit 回调向 handler 推送 SSE。
type MigrationService struct {
	db   *sqlx.DB
	repo *repository.MigrationRepo
}

// NewMigrationService 构造实例。
func NewMigrationService(db *sqlx.DB, repo *repository.MigrationRepo) *MigrationService {
	return &MigrationService{db: db, repo: repo}
}

// slugRegex 匹配所有非字母数字、非汉字字符，用于生成 URL 友好的 slug。
var slugRegex = regexp.MustCompile(`[^a-z0-9\p{Han}]+`)

// migrationSlugify 复用老 handler 的规则：小写 ASCII + 汉字原样保留 + 非法字符归一成连字符。
// 长度上限 100（与 posts.slug 列定义 VARCHAR(200) 留余量，外键/索引也更友好）。
func migrationSlugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRegex.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "untitled"
	}
	if len(s) > 100 {
		s = s[:100]
	}
	return s
}

// mdImageRegex 匹配 Markdown 的图片语法 ![alt](url)，用于派生 cover_image。
var mdImageRegex = regexp.MustCompile(`!\[[^\]]*\]\(([^)\s]+)`)

// deriveCoverImage 从 markdown 正文取第一张图片 URL；未找到返回 nil。
func deriveCoverImage(content string) *string {
	m := mdImageRegex.FindStringSubmatch(content)
	if len(m) < 2 {
		return nil
	}
	u := strings.TrimSpace(m[1])
	if u == "" {
		return nil
	}
	return &u
}

// deriveSummary 从 markdown 正文派生摘要：去除标题/链接/图片/代码块标记，
// 取开头至多 200 个 rune。不做严格解析，按经验规则够用。
func deriveSummary(content string) *string {
	s := content
	s = strings.ReplaceAll(s, "\r", "")
	// 简易清洗：代码块、标题、图片
	s = regexp.MustCompile("```[\\s\\S]*?```").ReplaceAllString(s, "")
	s = regexp.MustCompile(`(?m)^#{1,6}\s+`).ReplaceAllString(s, "")
	s = mdImageRegex.ReplaceAllString(s, "")
	s = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`).ReplaceAllString(s, "$1")
	s = regexp.MustCompile(`\*\*([^*]+)\*\*`).ReplaceAllString(s, "$1")
	s = regexp.MustCompile(`\s+`).ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	// 按 rune 截断以避免 CJK 多字节截半。
	runes := []rune(s)
	if len(runes) > 200 {
		runes = runes[:200]
	}
	out := string(runes)
	return &out
}

// sourceKeyForArticle 生成 VanBlog 文章的幂等 source_key：
//   - 有 id → vanblog:<id>（本次迁移实测 74/74 文章都带 id）
//   - 无 id → vanblog:title-sha1:<10 hex chars>（对齐 title 唯一性）
func sourceKeyForArticle(a *VanBlogArticle) string {
	if a.ID != nil {
		return "vanblog:" + strconv.Itoa(*a.ID)
	}
	h := sha1.Sum([]byte(a.Title))
	return "vanblog:title-sha1:" + hex.EncodeToString(h[:])[:10]
}

// legacySourceKeyForArticle 生成老 handler 使用的 vanblog:<title> 键，
// 用于双读幂等检测 —— 老代码导入过的文章新代码不会重复导入。
func legacySourceKeyForArticle(a *VanBlogArticle) string {
	return "vanblog:" + a.Title
}

// parseVanBlogTime 把 VanBlog 的 ISO8601 时间串转成 *time.Time；空串/非法返回 nil。
func parseVanBlogTime(s string) *time.Time {
	if s == "" {
		return nil
	}
	// VanBlog 用 JS ISOString，格式固定 2006-01-02T15:04:05.000Z；用 time.RFC3339Nano 容错覆盖。
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return &t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &t
	}
	return nil
}

// buildSourceIDLabel 用于 ArticlePlan.SourceID / ProgressEvent.SourceID 的展示值。
// 数字 id 优先；否则用 title-hash 前缀。
func buildSourceIDLabel(a *VanBlogArticle) string {
	if a.ID != nil {
		return strconv.Itoa(*a.ID)
	}
	h := sha1.Sum([]byte(a.Title))
	return "sha1:" + hex.EncodeToString(h[:])[:6]
}

// --- Analyze ---

// Analyze 解析整份备份、做幂等/冲突预判，返回完整 AnalysisReport 用于前端预览页。
// 不写 DB，调用方无需事务。
func (s *MigrationService) Analyze(
	ctx context.Context, backup *VanBlogBackup, opts ImportOptions,
) (*AnalysisReport, error) {
	opts.ApplyDefaults()

	rep := &AnalysisReport{
		Summary:     AnalysisSummary{TotalArticles: len(backup.Articles), TotalDrafts: len(backup.Drafts)},
		Warnings:    []string{},
		Unsupported: []string{},
	}

	// 0. 收集备份里虽然存在但当前不导入的数据块，作为 "Unsupported but detected" 提示。
	if len(backup.Viewer) > 2 {
		rep.Unsupported = append(rep.Unsupported, "viewer (访客行为记录，不导入)")
	}
	if len(backup.Visit) > 2 {
		rep.Unsupported = append(rep.Unsupported, "visit (访问日志，不导入)")
	}
	if len(backup.Static) > 2 {
		rep.Unsupported = append(rep.Unsupported, "static (站点静态资源元信息，不导入)")
	}
	if backup.Meta != nil {
		rep.Unsupported = append(rep.Unsupported, "meta.siteInfo (站点信息，不导入到 site_settings)")
	}

	// 1. 组装所有需要的分类 / 标签 / source_key 集合，走批量查询。
	catNames, tagNames := collectCategoryAndTagNames(backup)

	// 按 onlyArticleIDs 白名单过滤 articles/drafts（在后续步骤生效）。
	filter := buildOnlyFilter(opts.OnlyArticleIDs)

	// 收集新旧 source_key 供双读幂等检测。
	allKeys := make([]string, 0, len(backup.Articles)+len(backup.Drafts))
	for _, a := range backup.Articles {
		allKeys = append(allKeys, sourceKeyForArticle(&a), legacySourceKeyForArticle(&a))
	}
	if *opts.ImportDrafts {
		for _, a := range backup.Drafts {
			allKeys = append(allKeys, sourceKeyForArticle(&a), legacySourceKeyForArticle(&a))
		}
	}

	existingCatMap, err := s.repo.LoadCategoryMap(ctx, catNames)
	if err != nil {
		return nil, fmt.Errorf("load categories: %w", err)
	}
	existingTagMap, err := s.repo.LoadTagMap(ctx, tagNames)
	if err != nil {
		return nil, fmt.Errorf("load tags: %w", err)
	}
	existingSourceKeyMap, err := s.repo.LoadSourceKeyMap(ctx, allKeys)
	if err != nil {
		return nil, fmt.Errorf("load source_keys: %w", err)
	}

	// 2. 生成分类/标签计划。
	rep.CategoryPlans = make([]EntityPlan, 0, len(catNames))
	for _, n := range catNames {
		if _, ok := existingCatMap[n]; ok {
			rep.CategoryPlans = append(rep.CategoryPlans, EntityPlan{Name: n, Action: "reuse"})
			rep.Summary.ReusedCategories++
		} else {
			rep.CategoryPlans = append(rep.CategoryPlans, EntityPlan{Name: n, Action: "create"})
			rep.Summary.CreatedCategories++
		}
	}
	rep.TagPlans = make([]EntityPlan, 0, len(tagNames))
	for _, n := range tagNames {
		if _, ok := existingTagMap[n]; ok {
			rep.TagPlans = append(rep.TagPlans, EntityPlan{Name: n, Action: "reuse"})
			rep.Summary.ReusedTags++
		} else {
			rep.TagPlans = append(rep.TagPlans, EntityPlan{Name: n, Action: "create"})
			rep.Summary.CreatedTags++
		}
	}

	// 3. 生成文章计划（含 PUBLISHED + DRAFT）。
	seenSlugs := make(map[string]struct{})
	// 预取 DB 现有 slug 集合，避免每条文章一次查询。
	candidateSlugs := make([]string, 0, len(backup.Articles)+len(backup.Drafts))
	for _, a := range backup.Articles {
		candidateSlugs = append(candidateSlugs, proposeSlug(&a))
	}
	if *opts.ImportDrafts {
		for _, a := range backup.Drafts {
			candidateSlugs = append(candidateSlugs, proposeSlug(&a))
		}
	}
	dbSlugSet, err := s.repo.LoadPostSlugSet(ctx, candidateSlugs)
	if err != nil {
		return nil, fmt.Errorf("load post slugs: %w", err)
	}

	plan := func(a *VanBlogArticle, status string) ArticlePlan {
		plan := ArticlePlan{
			SourceID:    buildSourceIDLabel(a),
			SourceKey:   sourceKeyForArticle(a),
			Title:       a.Title,
			Status:      status,
			Category:    a.Category,
			Tags:        append([]string(nil), a.Tags...),
			IsPinned:    a.Top > 0,
			IsHidden:    a.Hidden,
			HasPassword: a.Password != "",
			WordCount:   utf8.RuneCountInString(a.Content),
		}
		plan.Slug = resolveSlug(a, dbSlugSet, seenSlugs)
		plan.Action, plan.Reason, plan.ExistingPostID, plan.MatchedSourceKey = classifyArticle(a, plan.SourceKey, opts, existingSourceKeyMap)
		switch plan.Action {
		case "create":
			rep.Summary.WillCreatePosts++
			rep.Summary.ImportableArticles++
		case "overwrite":
			rep.Summary.WillOverwritePosts++
			rep.Summary.ImportableArticles++
		case "rename":
			rep.Summary.WillRenameDuplicates++
			rep.Summary.ImportableArticles++
		case "skip_duplicate":
			rep.Summary.WillSkipDuplicates++
		case "skip_hidden":
			rep.Summary.SkippedHidden++
		case "skip_deleted":
			rep.Summary.SkippedDeleted++
		case "invalid":
			rep.Summary.InvalidRecords++
		}
		// onlyArticleIds 过滤
		if filter != nil && a.ID != nil {
			if _, ok := filter[*a.ID]; !ok {
				plan.Action = "skip_filtered"
				plan.Reason = "不在 onlyArticleIds 白名单"
				rep.Summary.WillSkipDuplicates++
			}
		}
		return plan
	}

	rep.ArticlePlans = make([]ArticlePlan, 0, len(backup.Articles)+len(backup.Drafts))
	for i := range backup.Articles {
		rep.ArticlePlans = append(rep.ArticlePlans, plan(&backup.Articles[i], "PUBLISHED"))
	}
	if *opts.ImportDrafts {
		for i := range backup.Drafts {
			rep.ArticlePlans = append(rep.ArticlePlans, plan(&backup.Drafts[i], "DRAFT"))
		}
	}

	// slug 冲突统计
	for s := range dbSlugSet {
		if _, ok := seenSlugs[s]; ok {
			rep.Summary.SlugCollisions++
		}
	}

	return rep, nil
}

// proposeSlug 生成一篇文章的默认 slug（pathname 优先，否则按标题）。
func proposeSlug(a *VanBlogArticle) string {
	if strings.TrimSpace(a.Pathname) != "" {
		return migrationSlugify(a.Pathname)
	}
	return migrationSlugify(a.Title)
}

// resolveSlug 在已知 DB 已用 slug 和本批内 seen slug 的基础上，给文章分配一个 unique slug。
// 冲突时追加 `-2`, `-3` ... 后缀。
func resolveSlug(a *VanBlogArticle, dbSet, seen map[string]struct{}) string {
	base := proposeSlug(a)
	candidate := base
	for i := 2; ; i++ {
		_, inSeen := seen[candidate]
		_, inDB := dbSet[candidate]
		if !inSeen && !inDB {
			seen[candidate] = struct{}{}
			return candidate
		}
		candidate = fmt.Sprintf("%s-%d", base, i)
		if i > 200 {
			// 保险：避免恶意数据导致无限循环。
			candidate = fmt.Sprintf("%s-%d", base, time.Now().UnixMilli())
			seen[candidate] = struct{}{}
			return candidate
		}
	}
}

// classifyArticle 决定单篇文章的处置动作，依据 hidden / deleted / 冲突策略 / 已存在 source_key。
// 返回值里的 matchedKey 是在 DB 里实际命中的 source_key（新格式 or 老 vanblog:<title>），
// 未命中时为空串。Execute 在 overwrite 路径里用它做 WHERE，顺便把列值升级到新格式。
func classifyArticle(
	a *VanBlogArticle, sourceKey string, opts ImportOptions,
	existingKeyMap map[string]int64,
) (action, reason string, existingID *int64, matchedKey string) {
	if strings.TrimSpace(a.Title) == "" {
		return "invalid", "标题为空", nil, ""
	}
	if a.Deleted != nil && *a.Deleted && !*opts.ImportDeleted {
		return "skip_deleted", "标记为已删除，已跳过", nil, ""
	}
	if a.Hidden && !*opts.ImportHidden {
		return "skip_hidden", "标记为隐藏，已跳过", nil, ""
	}

	// 幂等检测：先查新格式 source_key（vanblog:<id>）。
	if id, ok := existingKeyMap[sourceKey]; ok {
		id := id
		switch opts.ConflictStrategy {
		case ConflictStrategyOverwrite:
			return "overwrite", "source_key 已存在，按 overwrite 策略覆盖", &id, sourceKey
		case ConflictStrategyRename:
			return "rename", "source_key 已存在，按 rename 策略插入为新记录", &id, sourceKey
		default:
			return "skip_duplicate", "source_key 已存在，按 skip 策略跳过", &id, sourceKey
		}
	}
	// 兼容旧 handler 写入的 vanblog:<title> 格式。
	legacyKey := "vanblog:" + a.Title
	if id, ok := existingKeyMap[legacyKey]; ok {
		id := id
		switch opts.ConflictStrategy {
		case ConflictStrategyOverwrite:
			return "overwrite", "历史 source_key (vanblog:<title>) 命中，按 overwrite 覆盖并升级到 vanblog:<id>", &id, legacyKey
		case ConflictStrategyRename:
			return "rename", "历史 source_key (vanblog:<title>) 命中，按 rename 新增", &id, legacyKey
		default:
			return "skip_duplicate", "历史 source_key (vanblog:<title>) 命中，按 skip 跳过", &id, legacyKey
		}
	}
	return "create", "", nil, ""
}

// collectCategoryAndTagNames 从 categories/tags/articles/drafts 四处聚合名称并去重。
func collectCategoryAndTagNames(b *VanBlogBackup) (cats, tags []string) {
	catSet := make(map[string]struct{})
	tagSet := make(map[string]struct{})
	for _, n := range b.Categories {
		if n != "" {
			catSet[n] = struct{}{}
		}
	}
	for _, n := range b.Tags {
		if n != "" {
			tagSet[n] = struct{}{}
		}
	}
	for _, a := range b.Articles {
		if a.Category != "" {
			catSet[a.Category] = struct{}{}
		}
		for _, t := range a.Tags {
			if t != "" {
				tagSet[t] = struct{}{}
			}
		}
	}
	for _, a := range b.Drafts {
		if a.Category != "" {
			catSet[a.Category] = struct{}{}
		}
		for _, t := range a.Tags {
			if t != "" {
				tagSet[t] = struct{}{}
			}
		}
	}
	cats = make([]string, 0, len(catSet))
	for n := range catSet {
		cats = append(cats, n)
	}
	tags = make([]string, 0, len(tagSet))
	for n := range tagSet {
		tags = append(tags, n)
	}
	return
}

func buildOnlyFilter(ids []int) map[int]struct{} {
	if len(ids) == 0 {
		return nil
	}
	m := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		m[id] = struct{}{}
	}
	return m
}

// --- Execute ---

// ProgressEmit 是 handler 注入的 SSE 写入回调。service 层调用它推事件。
type ProgressEmit func(ev ProgressEvent)

// Execute 跑完整的导入流程：分类 → 标签 → 文章 → 关联 → 计数重算。
// 四个阶段分别在独立事务中提交，任一阶段失败不会回滚已提交的前置阶段 ——
// 依靠 source_key UNIQUE 和 slug UNIQUE 保证二次运行的天然续跑。
//
// callerID 是发起导入的管理员 id，写入 posts.author_id（VULN-035 历史遗留修正）。
func (s *MigrationService) Execute(
	ctx context.Context, backup *VanBlogBackup, opts ImportOptions,
	callerID int64, emit ProgressEmit,
) (*ExecutionSummary, error) {
	opts.ApplyDefaults()
	started := time.Now()
	summary := &ExecutionSummary{Warnings: []string{}, Errors: []string{}}

	// 预先跑一遍 Analyze 拿到完整计划 —— Execute 就是 "按计划执行 + 实时 emit"。
	rep, err := s.Analyze(ctx, backup, opts)
	if err != nil {
		return summary, err
	}

	// 阶段 1：分类
	emit(ProgressEvent{Type: "phase", Phase: "categories", Total: len(rep.CategoryPlans)})
	catMap, err := s.runCategoryPhase(ctx, rep.CategoryPlans, summary, emit)
	if err != nil {
		return summary, err
	}

	// 阶段 2：标签
	emit(ProgressEvent{Type: "phase", Phase: "tags", Total: len(rep.TagPlans)})
	tagMap, err := s.runTagPhase(ctx, rep.TagPlans, summary, emit)
	if err != nil {
		return summary, err
	}

	// 阶段 3：文章
	emit(ProgressEvent{Type: "phase", Phase: "articles", Total: len(rep.ArticlePlans)})
	postMap, err := s.runArticlePhase(
		ctx, backup, rep.ArticlePlans, catMap, callerID, opts, summary, emit,
	)
	if err != nil {
		return summary, err
	}

	// 阶段 4：文章-标签关联
	links := buildPostTagLinks(backup, rep.ArticlePlans, postMap, tagMap)
	emit(ProgressEvent{Type: "phase", Phase: "post_tags", Total: len(links)})
	if err := s.runPostTagPhase(ctx, rep.ArticlePlans, postMap, links, summary, emit); err != nil {
		return summary, err
	}

	// 阶段 5：重算计数 + 完成
	if err := s.recomputeCounts(ctx); err != nil {
		summary.Warnings = append(summary.Warnings, "重算 post_count 失败: "+err.Error())
	}

	summary.DurationMs = time.Since(started).Milliseconds()
	emit(ProgressEvent{Type: "phase", Phase: "done"})
	emit(ProgressEvent{Type: "summary", Summary: summary})
	return summary, nil
}

// runCategoryPhase 创建所有 "action=create" 的分类；返回全量 name → id 映射（含 reuse）。
func (s *MigrationService) runCategoryPhase(
	ctx context.Context, plans []EntityPlan, sum *ExecutionSummary, emit ProgressEmit,
) (map[string]int64, error) {
	// 复用已存在的：直接批量 load。
	allNames := make([]string, 0, len(plans))
	for _, p := range plans {
		allNames = append(allNames, p.Name)
	}
	existing, err := s.repo.LoadCategoryMap(ctx, allNames)
	if err != nil {
		return nil, err
	}

	toInsert := make([]repository.CategoryInsert, 0, len(plans))
	slugSeen := make(map[string]struct{})
	// 预取 DB 已有 slug，避免和现有分类撞 slug UNIQUE。
	proposedSlugs := make([]string, 0, len(plans))
	for _, p := range plans {
		proposedSlugs = append(proposedSlugs, migrationSlugify(p.Name))
	}
	dbSlugs, err := s.repo.LoadCategorySlugSet(ctx, proposedSlugs)
	if err != nil {
		return nil, err
	}

	for _, p := range plans {
		if _, ok := existing[p.Name]; ok {
			sum.ReusedCategories++
			emit(ProgressEvent{Type: "item", Kind: "category", Title: p.Name, Action: "reuse"})
			continue
		}
		slug := uniqueSlug(migrationSlugify(p.Name), dbSlugs, slugSeen)
		toInsert = append(toInsert, repository.CategoryInsert{Name: p.Name, Slug: slug})
	}

	if len(toInsert) > 0 {
		tx, err := s.db.BeginTxx(ctx, nil)
		if err != nil {
			return nil, err
		}
		created, err := s.repo.BatchInsertCategories(ctx, tx, toInsert)
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		for name, id := range created {
			existing[name] = id
			sum.CreatedCategories++
			emit(ProgressEvent{Type: "item", Kind: "category", Title: name, Action: "create"})
		}
	}
	return existing, nil
}

// runTagPhase 与 runCategoryPhase 对称。
func (s *MigrationService) runTagPhase(
	ctx context.Context, plans []EntityPlan, sum *ExecutionSummary, emit ProgressEmit,
) (map[string]int64, error) {
	allNames := make([]string, 0, len(plans))
	for _, p := range plans {
		allNames = append(allNames, p.Name)
	}
	existing, err := s.repo.LoadTagMap(ctx, allNames)
	if err != nil {
		return nil, err
	}

	toInsert := make([]repository.TagInsert, 0, len(plans))
	slugSeen := make(map[string]struct{})
	proposedSlugs := make([]string, 0, len(plans))
	for _, p := range plans {
		proposedSlugs = append(proposedSlugs, migrationSlugify(p.Name))
	}
	dbSlugs, err := s.repo.LoadTagSlugSet(ctx, proposedSlugs)
	if err != nil {
		return nil, err
	}

	for _, p := range plans {
		if _, ok := existing[p.Name]; ok {
			sum.ReusedTags++
			emit(ProgressEvent{Type: "item", Kind: "tag", Title: p.Name, Action: "reuse"})
			continue
		}
		slug := uniqueSlug(migrationSlugify(p.Name), dbSlugs, slugSeen)
		toInsert = append(toInsert, repository.TagInsert{Name: p.Name, Slug: slug})
	}

	if len(toInsert) > 0 {
		tx, err := s.db.BeginTxx(ctx, nil)
		if err != nil {
			return nil, err
		}
		created, err := s.repo.BatchInsertTags(ctx, tx, toInsert)
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		for name, id := range created {
			existing[name] = id
			sum.CreatedTags++
			emit(ProgressEvent{Type: "item", Kind: "tag", Title: name, Action: "create"})
		}
	}
	return existing, nil
}

// uniqueSlug 若 base 已被占用，追加数字后缀直到唯一。
func uniqueSlug(base string, dbSet, seen map[string]struct{}) string {
	candidate := base
	for i := 2; ; i++ {
		_, inSeen := seen[candidate]
		_, inDB := dbSet[candidate]
		if !inSeen && !inDB {
			seen[candidate] = struct{}{}
			return candidate
		}
		candidate = fmt.Sprintf("%s-%d", base, i)
		if i > 500 {
			candidate = fmt.Sprintf("%s-%d", base, time.Now().UnixMilli())
			seen[candidate] = struct{}{}
			return candidate
		}
	}
}

// runArticlePhase 把 action∈{create,overwrite,rename} 的文章按策略批量写入。
// 返回 source_key → post.id 映射。
func (s *MigrationService) runArticlePhase(
	ctx context.Context,
	backup *VanBlogBackup,
	plans []ArticlePlan,
	catMap map[string]int64,
	callerID int64,
	opts ImportOptions,
	sum *ExecutionSummary,
	emit ProgressEmit,
) (map[string]int64, error) {
	// 事务外先跑完 bcrypt：每次 ~100ms，16 篇密码保护的实测值在 1.6s 级别；
	// 若搬进事务里会让整段时间 DB 连接被占用、可能与其他 tx 产生锁冲突。
	pwMap, pwErrs := precomputePasswordHashes(backup, plans, opts)
	for _, e := range pwErrs {
		sum.Errors = append(sum.Errors, e)
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		// defer 里不判 err —— 已 Commit 的 tx 再 Rollback 会返回 ErrTxDone，无害。
		_ = tx.Rollback()
	}()

	if *opts.PreserveTimestamps {
		if err := s.repo.SetPreserveUpdatedAt(ctx, tx, true); err != nil {
			return nil, fmt.Errorf("set preserve_updated_at: %w", err)
		}
	}

	postMap := make(map[string]int64, len(plans))

	toInsert := make([]repository.PostInsert, 0, len(plans))
	for i, p := range plans {
		var a *VanBlogArticle
		if i < len(backup.Articles) {
			a = &backup.Articles[i]
		} else {
			a = &backup.Drafts[i-len(backup.Articles)]
		}

		switch p.Action {
		case "create", "rename":
			ins, err := buildPostInsert(a, p, catMap, callerID, opts, pwMap)
			if err != nil {
				sum.FailedPosts++
				sum.Errors = append(sum.Errors, fmt.Sprintf("文章 [%s] 构建失败: %v", p.Title, err))
				emit(ProgressEvent{Type: "item", Kind: "article", SourceID: p.SourceID,
					Title: p.Title, Action: "fail", Error: err.Error()})
				continue
			}
			// rename: 追加后缀防 source_key 冲突
			if p.Action == "rename" {
				ins.SourceKey = fmt.Sprintf("%s:re-%d", p.SourceKey, time.Now().UnixMilli())
			}
			toInsert = append(toInsert, ins)

		case "overwrite":
			ins, err := buildPostInsert(a, p, catMap, callerID, opts, pwMap)
			if err != nil {
				sum.FailedPosts++
				sum.Errors = append(sum.Errors,
					fmt.Sprintf("文章 [%s] 构建失败: %v", p.Title, err))
				continue
			}
			// PreservePasswords=true 时不覆盖旧密码：传 nil 让 COALESCE 生效。
			if *opts.PreservePasswords {
				ins.Password = nil
			}
			// WHERE 用老命中的 key（可能是 vanblog:<title> 或 vanblog:<id>），
			// SET 则把列值升级到新格式 ins.SourceKey=vanblog:<id>。二合一迁移。
			matchKey := p.MatchedSourceKey
			if matchKey == "" {
				// 理论上 overwrite 路径一定有命中；兜底回退到新 key 自我一致。
				matchKey = ins.SourceKey
			}
			id, err := s.repo.UpdatePostBySourceKey(ctx, tx, ins, matchKey)
			if err != nil {
				sum.FailedPosts++
				sum.Errors = append(sum.Errors,
					fmt.Sprintf("文章 [%s] 覆盖失败: %v", p.Title, err))
				emit(ProgressEvent{Type: "item", Kind: "article",
					SourceID: p.SourceID, Title: p.Title, Action: "fail", Error: err.Error()})
				continue
			}
			if id > 0 {
				postMap[ins.SourceKey] = id
				sum.OverwrittenPosts++
				emit(ProgressEvent{Type: "item", Kind: "article", SourceID: p.SourceID,
					Title: p.Title, Action: "overwrite", PostID: &id})
			}

		case "skip_duplicate", "skip_hidden", "skip_deleted", "skip_filtered", "invalid":
			sum.SkippedPosts++
			emit(ProgressEvent{Type: "item", Kind: "article", SourceID: p.SourceID,
				Title: p.Title, Action: p.Action})
		}
	}

	// 批量写 create/rename。
	if len(toInsert) > 0 {
		inserted, err := s.repo.BatchInsertPosts(ctx, tx, toInsert)
		if err != nil {
			return nil, err
		}
		for _, ins := range toInsert {
			if id, ok := inserted[ins.SourceKey]; ok {
				postMap[ins.SourceKey] = id
				sum.CreatedPosts++
				emit(ProgressEvent{Type: "item", Kind: "article",
					SourceID: ins.SourceKey, Title: ins.Title, Action: "create", PostID: &id})
			} else {
				// ON CONFLICT DO NOTHING 没有返回行 —— 表示被 source_key 唯一约束挡下。
				sum.SkippedPosts++
				emit(ProgressEvent{Type: "item", Kind: "article",
					SourceID: ins.SourceKey, Title: ins.Title, Action: "skip_duplicate"})
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return postMap, nil
}

// precomputePasswordHashes 在开事务之前串行跑 bcrypt，产出 source_key → hash 映射。
// 策略：
//   - 只对 action ∈ {create, rename, overwrite(且 preservePasswords=false)} 的文章做哈希
//   - overwrite + preservePasswords=true 的文章不需要新哈希（走 COALESCE 保留旧密码）
//   - skip_* / invalid 的文章不需要哈希
//
// 返回的 errors 列表会合并到 ExecutionSummary.Errors；单篇哈希失败不中断整批。
func precomputePasswordHashes(
	backup *VanBlogBackup, plans []ArticlePlan, opts ImportOptions,
) (map[string]string, []string) {
	out := make(map[string]string)
	var errs []string
	preservePwOnOverwrite := opts.PreservePasswords != nil && *opts.PreservePasswords
	for i, p := range plans {
		if p.Action == "skip_duplicate" || p.Action == "skip_hidden" ||
			p.Action == "skip_deleted" || p.Action == "skip_filtered" || p.Action == "invalid" {
			continue
		}
		if p.Action == "overwrite" && preservePwOnOverwrite {
			continue
		}
		var a *VanBlogArticle
		if i < len(backup.Articles) {
			a = &backup.Articles[i]
		} else {
			a = &backup.Drafts[i-len(backup.Articles)]
		}
		if a.Password == "" {
			continue
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(a.Password), bcrypt.DefaultCost)
		if err != nil {
			errs = append(errs, fmt.Sprintf("文章 [%s] 密码哈希失败: %v", p.Title, err))
			continue
		}
		out[p.SourceKey] = string(hash)
	}
	return out, errs
}

// buildPostInsert 把 VanBlog 文章转成 repository.PostInsert。
// 密码哈希通过 pwMap 传入（key=文章的 source_key），在事务外预计算，避免
// 在循环里跑 bcrypt（~100ms/次 × N）占用 DB 连接和锁资源。
func buildPostInsert(
	a *VanBlogArticle, p ArticlePlan,
	catMap map[string]int64, callerID int64, opts ImportOptions,
	pwMap map[string]string,
) (repository.PostInsert, error) {
	ins := repository.PostInsert{
		Title:        a.Title,
		Slug:         p.Slug,
		Status:       p.Status,
		IsPinned:     p.IsPinned,
		PinPriority:  a.Top,
		IsHidden:     a.Hidden,
		SourceKey:    p.SourceKey,
		AllowComment: true,
	}
	content := a.Content
	ins.ContentMarkdown = &content
	ins.Summary = deriveSummary(content)
	ins.CoverImage = deriveCoverImage(content)
	if a.Category != "" {
		if cid, ok := catMap[a.Category]; ok {
			ins.CategoryID = &cid
		}
	}
	uid := callerID
	ins.AuthorID = &uid
	// SECURITY (VULN-033): VanBlog 导出里密码明文；必须 bcrypt 后再存。
	// 哈希已在 precomputePasswordHashes 里生成；这里只做 lookup。
	if a.Password != "" {
		if h, ok := pwMap[p.SourceKey]; ok {
			hs := h
			ins.Password = &hs
		}
	}
	ins.WordCount = utf8.RuneCountInString(content)
	ins.ReadingTime = ins.WordCount / 300
	if ins.ReadingTime < 1 {
		ins.ReadingTime = 1
	}
	if a.Author != "" {
		author := a.Author
		ins.LegacyAuthorName = &author
	}
	if a.Copyright != "" {
		cp := a.Copyright
		ins.LegacyCopyright = &cp
	}
	// visited/viewer：VanBlog 这两个字段通常相等（实测 74/74 每篇相同），取 visited。
	ins.LegacyVisitedCount = a.Visited
	if a.Visited == 0 {
		ins.LegacyVisitedCount = a.Viewer
	}

	createdAt := parseVanBlogTime(a.CreatedAt)
	updatedAt := parseVanBlogTime(a.UpdatedAt)
	if *opts.PreserveTimestamps {
		ins.CreatedAt = createdAt
		ins.UpdatedAt = updatedAt
	}
	// published_at 规则：PUBLISHED 取 createdAt；DRAFT 置 nil。
	if p.Status == "PUBLISHED" && createdAt != nil {
		ins.PublishedAt = createdAt
	}

	return ins, nil
}

// buildPostTagLinks 把文章计划里的 tags 展开成 (post_id, tag_id) 关联列表。
func buildPostTagLinks(
	backup *VanBlogBackup, plans []ArticlePlan,
	postMap map[string]int64, tagMap map[string]int64,
) []repository.PostTagLink {
	links := make([]repository.PostTagLink, 0, len(plans)*3)
	for i, p := range plans {
		var a *VanBlogArticle
		if i < len(backup.Articles) {
			a = &backup.Articles[i]
		} else {
			a = &backup.Drafts[i-len(backup.Articles)]
		}
		postID, ok := postMap[p.SourceKey]
		if !ok {
			// rename 策略下 source_key 追加后缀；现阶段 rename 文章的 tag 关联暂不处理
			// （service 层 action==rename 时在 runArticlePhase 重写了 SourceKey，此处无法
			// 直接映射；留待下一迭代支持）。
			continue
		}
		for _, tn := range a.Tags {
			if tagID, ok := tagMap[tn]; ok {
				links = append(links, repository.PostTagLink{PostID: postID, TagID: tagID})
			}
		}
	}
	return links
}

// runPostTagPhase 执行文章-标签关联批量写入。
func (s *MigrationService) runPostTagPhase(
	ctx context.Context, plans []ArticlePlan, postMap map[string]int64,
	links []repository.PostTagLink, sum *ExecutionSummary, emit ProgressEmit,
) error {
	if len(links) == 0 {
		return nil
	}
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// overwrite 策略：收集所有需要清空的 post_id，一次 DELETE 搞定，
	// 避免 overwrite 100 篇 = 100 次 round-trip 的 N+1。
	toClearSet := make(map[int64]struct{})
	for _, p := range plans {
		if p.Action != "overwrite" {
			continue
		}
		id, ok := postMap[p.SourceKey]
		if !ok {
			continue
		}
		toClearSet[id] = struct{}{}
	}
	if len(toClearSet) > 0 {
		toClear := make([]int64, 0, len(toClearSet))
		for id := range toClearSet {
			toClear = append(toClear, id)
		}
		if err := s.repo.ClearPostTagsBatch(ctx, tx, toClear); err != nil {
			sum.Warnings = append(sum.Warnings,
				fmt.Sprintf("批量清空 post_tags 失败 (%d 条): %v", len(toClear), err))
		}
	}

	n, err := s.repo.BatchInsertPostTags(ctx, tx, links)
	if err != nil {
		return err
	}
	sum.CreatedPostTags = n
	emit(ProgressEvent{Type: "item", Kind: "post_tag", Action: "batch_done",
		Title: fmt.Sprintf("共写入 %d 条关联", n)})
	return tx.Commit()
}

// recomputeCounts 单开事务刷新 post_count 缓存。不影响幂等。
func (s *MigrationService) recomputeCounts(ctx context.Context) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.repo.RecomputePostCounts(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

// LogMigrationSummary 将迁移结果摘要写入应用日志，供运维留档。
// 单独提出以便 handler 在 SSE 关闭前同步记录（handler 层无法捕获 emit 的闭包）。
func (s *MigrationService) LogMigrationSummary(sum *ExecutionSummary) {
	log.Info().
		Int("created_posts", sum.CreatedPosts).
		Int("overwritten_posts", sum.OverwrittenPosts).
		Int("skipped_posts", sum.SkippedPosts).
		Int("failed_posts", sum.FailedPosts).
		Int("created_post_tags", sum.CreatedPostTags).
		Int("created_categories", sum.CreatedCategories).
		Int("created_tags", sum.CreatedTags).
		Int64("duration_ms", sum.DurationMs).
		Msg("VanBlog migration completed")
}
