package service

import (
	"strings"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

func TestToPublicListItemAddsContentPreviewOnlyWhenSummaryMissing(t *testing.T) {
	content := "# 标题\n\n正文 **重点** [链接](https://example.com)。\n\n- 保留列表内容"
	post := &model.Post{
		ID:              1,
		Title:           "标题",
		Slug:            "post",
		ContentMarkdown: &content,
		Status:          "PUBLISHED",
	}

	item := toPublicListItem(post, nil, nil)

	if item.ContentPreview == nil {
		t.Fatal("expected content preview for public post without summary")
	}
	preview := *item.ContentPreview
	for _, disallowed := range []string{"**", "[", "](", "https://example.com"} {
		if strings.Contains(preview, disallowed) {
			t.Fatalf("preview should be plain text, got %q", preview)
		}
	}
	for _, want := range []string{"正文", "重点", "链接", "保留列表内容"} {
		if !strings.Contains(preview, want) {
			t.Fatalf("preview %q missing %q", preview, want)
		}
	}
	if strings.HasPrefix(preview, "标题 ") {
		t.Fatalf("preview should skip duplicated leading title, got %q", preview)
	}

	summary := "人工摘要"
	post.Summary = &summary
	item = toPublicListItem(post, nil, nil)
	if item.ContentPreview != nil {
		t.Fatalf("expected no content preview when summary is present, got %q", *item.ContentPreview)
	}
}

func TestToPublicListItemDoesNotExposePasswordPostPreview(t *testing.T) {
	content := "不应在公开列表泄漏的加密正文"
	password := "bcrypt-hash"
	post := &model.Post{
		ID:              1,
		Title:           "加密文章",
		Slug:            "locked",
		ContentMarkdown: &content,
		Status:          "PUBLISHED",
		Password:        &password,
	}

	item := toPublicListItem(post, nil, nil)

	if !item.PasswordRequired {
		t.Fatal("expected passwordRequired to stay true")
	}
	if item.ContentPreview != nil {
		t.Fatalf("expected no content preview for password-protected post, got %q", *item.ContentPreview)
	}
}

func TestBuildPostContentPreviewTruncatesByRune(t *testing.T) {
	content := strings.Repeat("界", postListContentPreviewMaxRunes+8)

	preview := buildPostContentPreview("", &content)

	if preview == nil {
		t.Fatal("expected preview")
	}
	if got := []rune(*preview); len(got) != postListContentPreviewMaxRunes+1 {
		t.Fatalf("preview rune length = %d, want %d", len(got), postListContentPreviewMaxRunes+1)
	}
	if !strings.HasSuffix(*preview, "…") {
		t.Fatalf("expected ellipsis suffix, got %q", *preview)
	}
}
