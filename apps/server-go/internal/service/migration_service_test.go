package service

import (
	"encoding/json"
	"strings"
	"testing"
)

// 本测试集只覆盖 service 包中纯函数（不依赖 DB），对应：
//   - JSON 解析兼容性（真实 VanBlog 导出形状，包含 user/viewer/visit/static/setting 等未使用字段）
//   - slug / source_key 生成规则
//   - summary / cover_image 派生
//   - classifyArticle 的 5 种路径（create / skip_duplicate / overwrite / skip_hidden / skip_deleted / invalid）
//   - ImportOptions.ApplyDefaults 的默认值
//
// Analyze/Execute 的 DB 集成路径由 live verification + 手测覆盖。

func TestApplyDefaults_Values(t *testing.T) {
	opts := ImportOptions{}
	opts.ApplyDefaults()
	if opts.ConflictStrategy != ConflictStrategySkip {
		t.Errorf("want ConflictStrategy=skip got %q", opts.ConflictStrategy)
	}
	if !*opts.PreserveTimestamps {
		t.Error("PreserveTimestamps should default to true")
	}
	if !*opts.ImportHidden {
		t.Error("ImportHidden should default to true")
	}
	if !*opts.ImportDrafts {
		t.Error("ImportDrafts should default to true")
	}
	if *opts.ImportDeleted {
		t.Error("ImportDeleted should default to false")
	}
	if !*opts.PreservePasswords {
		t.Error("PreservePasswords should default to true")
	}
}

func TestApplyDefaults_PreservesExplicit(t *testing.T) {
	f := false
	opts := ImportOptions{
		ConflictStrategy:  ConflictStrategyOverwrite,
		ImportDrafts:      &f,
		PreservePasswords: &f,
	}
	opts.ApplyDefaults()
	if opts.ConflictStrategy != ConflictStrategyOverwrite {
		t.Errorf("explicit ConflictStrategy overwritten: %q", opts.ConflictStrategy)
	}
	if *opts.ImportDrafts {
		t.Error("explicit ImportDrafts=false was overridden")
	}
	if *opts.PreservePasswords {
		t.Error("explicit PreservePasswords=false was overridden")
	}
}

func TestVanBlogBackup_DecodeRealShape(t *testing.T) {
	// 真实 VanBlog 导出的顶层 key（来自 4.5MB 生产备份实测）：
	//   articles/tags/meta/drafts/categories/user/viewer/visit/static/setting
	// 老 handler 的 DisallowUnknownFields() 在这份 JSON 上会直接 400；
	// 新实现必须接住已知字段并安静丢弃 user/viewer/visit/static/setting。
	raw := []byte(`{
		"articles": [
			{"id": 88, "title": "Mac终端", "content": "# hi", "tags": ["工具"], "category": "工具",
			 "top": 0, "hidden": false, "private": false, "password": "", "pathname": "",
			 "author": "Golovin", "viewer": 42, "visited": 42,
			 "createdAt": "2026-01-11T14:20:06.559Z", "updatedAt": "2026-01-11T14:28:58.370Z",
			 "lastVisitedTime": "2026-03-03T13:35:48.647Z"}
		],
		"drafts": [],
		"tags": ["Linux", "工具", "配置"],
		"categories": ["工具", "Docker"],
		"meta": {"siteInfo": {"siteName": "AetherBlog"}},
		"user": {"name": "admin"},
		"viewer": [],
		"visit": [],
		"static": [],
		"setting": {"static": {}}
	}`)
	var b VanBlogBackup
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(b.Articles) != 1 {
		t.Fatalf("want 1 article got %d", len(b.Articles))
	}
	if b.Articles[0].ID == nil || *b.Articles[0].ID != 88 {
		t.Errorf("article.id decode wrong: %+v", b.Articles[0].ID)
	}
	if b.Articles[0].Author != "Golovin" {
		t.Errorf("article.author decode wrong: %q", b.Articles[0].Author)
	}
	if b.Articles[0].Visited != 42 {
		t.Errorf("article.visited decode wrong: %d", b.Articles[0].Visited)
	}
	if len(b.Tags) != 3 || b.Tags[0] != "Linux" {
		t.Errorf("tags decode wrong: %+v", b.Tags)
	}
	if len(b.Categories) != 2 || b.Categories[0] != "工具" {
		t.Errorf("categories decode wrong: %+v", b.Categories)
	}
	if b.Meta == nil {
		t.Error("meta should be decoded (single object)")
	}
	if b.User == nil || b.User.Name != "admin" {
		t.Error("user should be decoded (single object, singular key)")
	}
}

func TestSourceKey_WithID(t *testing.T) {
	id := 88
	a := &VanBlogArticle{ID: &id, Title: "Mac终端"}
	got := sourceKeyForArticle(a)
	if got != "vanblog:88" {
		t.Errorf("want vanblog:88 got %q", got)
	}
}

func TestSourceKey_NoID_FallsBackToTitleHash(t *testing.T) {
	a := &VanBlogArticle{Title: "hello"}
	got := sourceKeyForArticle(a)
	if !strings.HasPrefix(got, "vanblog:title-sha1:") {
		t.Errorf("want vanblog:title-sha1:<hex> got %q", got)
	}
	// 同一标题应生成同一 key（幂等）。
	got2 := sourceKeyForArticle(&VanBlogArticle{Title: "hello"})
	if got != got2 {
		t.Errorf("hash not deterministic: %q vs %q", got, got2)
	}
	// 不同标题应生成不同 key。
	got3 := sourceKeyForArticle(&VanBlogArticle{Title: "different"})
	if got == got3 {
		t.Errorf("hash collision: %q == %q", got, got3)
	}
}

func TestDeriveCoverImage_FromMarkdownImage(t *testing.T) {
	md := "hello\n\n![cover](https://cdn.example.com/a.png)\n\nmore"
	got := deriveCoverImage(md)
	if got == nil {
		t.Fatal("expected cover url")
	}
	if *got != "https://cdn.example.com/a.png" {
		t.Errorf("wrong cover url: %q", *got)
	}
}

func TestDeriveCoverImage_NoImage(t *testing.T) {
	got := deriveCoverImage("just text, no image")
	if got != nil {
		t.Errorf("expected nil, got %q", *got)
	}
}

func TestDeriveSummary_TrimsMarkdown(t *testing.T) {
	md := "# Title\n\n**Bold** and [link](https://x.com).\n\n```\ncode\n```\n\nMore body."
	got := deriveSummary(md)
	if got == nil {
		t.Fatal("expected summary")
	}
	if strings.Contains(*got, "**") {
		t.Errorf("bold markers should be stripped: %q", *got)
	}
	if strings.Contains(*got, "https://x.com") {
		t.Errorf("url should be stripped, link text kept: %q", *got)
	}
	if strings.Contains(*got, "```") {
		t.Errorf("code fences should be stripped: %q", *got)
	}
	if strings.Contains(*got, "#") {
		t.Errorf("heading hash should be stripped: %q", *got)
	}
}

func TestDeriveSummary_CJKRuneTruncate(t *testing.T) {
	// 构造 300 个中文字的文章，确保截断按 rune 切而不是按字节切半。
	var builder strings.Builder
	for i := 0; i < 300; i++ {
		builder.WriteString("中")
	}
	got := deriveSummary(builder.String())
	if got == nil {
		t.Fatal("expected summary")
	}
	runes := []rune(*got)
	if len(runes) != 200 {
		t.Errorf("want 200 runes, got %d", len(runes))
	}
}

func TestMigrationSlugify_CJKPreserved(t *testing.T) {
	cases := map[string]string{
		"Hello World":    "hello-world",
		"工具":             "工具",
		"Docker & Nginx": "docker-nginx",
		"   ":            "untitled",
		"AI 入门":          "ai-入门",
	}
	for in, want := range cases {
		if got := migrationSlugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseVanBlogTime_ISO(t *testing.T) {
	got := parseVanBlogTime("2026-01-11T14:20:06.559Z")
	if got == nil {
		t.Fatal("expected non-nil")
	}
	if got.Year() != 2026 || got.Month() != 1 || got.Day() != 11 {
		t.Errorf("wrong date: %+v", got)
	}
}

func TestParseVanBlogTime_Empty(t *testing.T) {
	if parseVanBlogTime("") != nil {
		t.Error("empty string should return nil")
	}
	if parseVanBlogTime("garbage") != nil {
		t.Error("garbage should return nil")
	}
}

func TestClassifyArticle_Paths(t *testing.T) {
	opts := ImportOptions{}
	opts.ApplyDefaults()

	// invalid: 空标题
	{
		a := &VanBlogArticle{Title: ""}
		action, _, _, _ := classifyArticle(a, "vanblog:1", opts, map[string]int64{})
		if action != "invalid" {
			t.Errorf("empty title should be invalid, got %q", action)
		}
	}
	// skip_hidden: hidden=true, ImportHidden=false
	{
		f := false
		opts2 := opts
		opts2.ImportHidden = &f
		a := &VanBlogArticle{Title: "h", Hidden: true}
		action, _, _, _ := classifyArticle(a, "vanblog:1", opts2, map[string]int64{})
		if action != "skip_hidden" {
			t.Errorf("want skip_hidden got %q", action)
		}
	}
	// skip_deleted: deleted=true, ImportDeleted=false
	{
		tr := true
		a := &VanBlogArticle{Title: "d", Deleted: &tr}
		action, _, _, _ := classifyArticle(a, "vanblog:1", opts, map[string]int64{})
		if action != "skip_deleted" {
			t.Errorf("want skip_deleted got %q", action)
		}
	}
	// create: 无冲突
	{
		a := &VanBlogArticle{Title: "fresh"}
		action, _, _, matched := classifyArticle(a, "vanblog:99", opts, map[string]int64{})
		if matched != "" {
			t.Errorf("no-match case should return empty matchedKey, got %q", matched)
		}
		if action != "create" {
			t.Errorf("want create got %q", action)
		}
	}
	// skip_duplicate: source_key 已存在，默认 skip
	{
		a := &VanBlogArticle{Title: "dup"}
		existing := map[string]int64{"vanblog:7": 123}
		action, _, existingID, matched := classifyArticle(a, "vanblog:7", opts, existing)
		if action != "skip_duplicate" {
			t.Errorf("want skip_duplicate got %q", action)
		}
		if existingID == nil || *existingID != 123 {
			t.Errorf("existingID should be 123, got %+v", existingID)
		}
		if matched != "vanblog:7" {
			t.Errorf("new-key match should return matched=vanblog:7, got %q", matched)
		}
	}
	// overwrite: ConflictStrategy=overwrite
	{
		opts2 := opts
		opts2.ConflictStrategy = ConflictStrategyOverwrite
		a := &VanBlogArticle{Title: "dup"}
		existing := map[string]int64{"vanblog:7": 123}
		action, _, _, matched := classifyArticle(a, "vanblog:7", opts2, existing)
		if action != "overwrite" {
			t.Errorf("want overwrite got %q", action)
		}
		if matched != "vanblog:7" {
			t.Errorf("overwrite via new key should return matched=vanblog:7, got %q", matched)
		}
	}
	// 兼容旧 source_key 格式 vanblog:<title>
	{
		a := &VanBlogArticle{Title: "legacy"}
		existing := map[string]int64{"vanblog:legacy": 456} // 老格式
		action, _, existingID, matched := classifyArticle(a, "vanblog:77", opts, existing)
		if action != "skip_duplicate" {
			t.Errorf("legacy key hit should trigger skip_duplicate, got %q", action)
		}
		if existingID == nil || *existingID != 456 {
			t.Errorf("legacy existingID should be 456, got %+v", existingID)
		}
		// 关键：老格式命中时，matched 必须是老 key（vanblog:legacy），而不是新传入的 vanblog:77。
		// Execute 的 overwrite 路径用这个值做 WHERE，否则更新会 miss 老数据。
		if matched != "vanblog:legacy" {
			t.Errorf("legacy match should return matched=vanblog:legacy, got %q", matched)
		}
	}
}

// TestClassifyArticle_LegacyOverwrite_ReturnsLegacyKey 保证老数据的 overwrite 路径
// 能拿到老 key 做 WHERE 定位 —— 这是修复 "overwrite 对老数据静默失败" 的关键。
func TestClassifyArticle_LegacyOverwrite_ReturnsLegacyKey(t *testing.T) {
	opts := ImportOptions{ConflictStrategy: ConflictStrategyOverwrite}
	opts.ApplyDefaults()
	a := &VanBlogArticle{Title: "老文章"}
	existing := map[string]int64{"vanblog:老文章": 99}
	action, _, _, matched := classifyArticle(a, "vanblog:123", opts, existing)
	if action != "overwrite" {
		t.Fatalf("want overwrite got %q", action)
	}
	if matched != "vanblog:老文章" {
		t.Errorf("legacy-overwrite must expose legacy key for WHERE clause, got %q", matched)
	}
}

func TestResolveSlug_CollisionFallback(t *testing.T) {
	a := &VanBlogArticle{Title: "Docker 入门"}
	dbSet := map[string]struct{}{"docker-入门": {}}
	seen := map[string]struct{}{}
	got := resolveSlug(a, dbSet, seen)
	if got == "docker-入门" {
		t.Error("should avoid DB slug")
	}
	if got != "docker-入门-2" {
		t.Errorf("want docker-入门-2 got %q", got)
	}
}

func TestResolveSlug_PathnameOverrideTitle(t *testing.T) {
	a := &VanBlogArticle{Title: "Random Title", Pathname: "custom-path"}
	got := resolveSlug(a, map[string]struct{}{}, map[string]struct{}{})
	if got != "custom-path" {
		t.Errorf("pathname should override title, got %q", got)
	}
}

func TestCollectCategoryAndTagNames_UnionFromAllSources(t *testing.T) {
	id1 := 1
	b := &VanBlogBackup{
		Categories: []string{"A", "B"},
		Tags:       []string{"x"},
		Articles: []VanBlogArticle{
			{ID: &id1, Title: "t1", Category: "C", Tags: []string{"x", "y"}},
		},
		Drafts: []VanBlogArticle{
			{Title: "d1", Category: "D", Tags: []string{"z"}},
		},
	}
	cats, tags := collectCategoryAndTagNames(b)
	catSet := make(map[string]bool)
	for _, c := range cats {
		catSet[c] = true
	}
	for _, exp := range []string{"A", "B", "C", "D"} {
		if !catSet[exp] {
			t.Errorf("category %q missing from union: %+v", exp, cats)
		}
	}
	tagSet := make(map[string]bool)
	for _, t := range tags {
		tagSet[t] = true
	}
	for _, exp := range []string{"x", "y", "z"} {
		if !tagSet[exp] {
			t.Errorf("tag %q missing from union: %+v", exp, tags)
		}
	}
}
