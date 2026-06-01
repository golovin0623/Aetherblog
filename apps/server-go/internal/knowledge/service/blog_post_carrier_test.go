package service

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestBlogPostCarrierServiceSourceScope(t *testing.T) {
	ownerID := int64(10)
	otherID := int64(11)
	posts := &fakeBlogPosts{
		posts: map[int64]*PostSnapshot{
			7: {
				ID:       7,
				Title:    "Draft post",
				Slug:     "draft-post",
				Status:   "DRAFT",
				Content:  "draft body",
				Summary:  "draft summary",
				AuthorID: &ownerID,
			},
		},
	}
	svc := NewBlogPostCarrierService(nil, posts)

	post, err := svc.GetPostSourceAs(context.Background(), 7, ownerID, false)
	if err != nil {
		t.Fatalf("owner read returned error: %v", err)
	}
	if post.ID != 7 || post.Title != "Draft post" {
		t.Fatalf("unexpected owner post: %#v", post)
	}

	_, err = svc.GetPostSourceAs(context.Background(), 7, otherID, false)
	if !errors.Is(err, ErrAtlasForbidden) {
		t.Fatalf("other user error = %v, want ErrAtlasForbidden", err)
	}

	post, err = svc.GetPostSourceAs(context.Background(), 7, otherID, true)
	if err != nil {
		t.Fatalf("admin read returned error: %v", err)
	}
	if post.ID != 7 {
		t.Fatalf("unexpected admin post: %#v", post)
	}
}

func TestBlogPostSourceURIAndText(t *testing.T) {
	if got := BlogPostSourceURI(42); got != "posts://42" {
		t.Fatalf("source uri = %q, want posts://42", got)
	}
	if got := BlogPostTextLayerStorageURI(42, "abc123"); got != "atlas-text-layer://blog-post/42/abc123" {
		t.Fatalf("text layer uri = %q, want blog-post text-layer URI", got)
	}

	text := BlogPostText(&PostSnapshot{
		Title:   "Knowledge Atlas",
		Summary: "A short summary",
		Content: "## Heading\n\nThis is **markdown** content.",
	})
	for _, want := range []string{"Knowledge Atlas", "A short summary", "Heading", "markdown content"} {
		if !strings.Contains(text, want) {
			t.Fatalf("BlogPostText() = %q, want it to contain %q", text, want)
		}
	}
	if strings.Contains(text, "**") {
		t.Fatalf("BlogPostText() should normalize markdown syntax, got %q", text)
	}
}

func TestAtlasServiceAttachBlogPosts(t *testing.T) {
	posts := NewBlogPostCarrierService(nil, nil)
	svc := NewAtlasService(nil, nil)
	svc.AttachBlogPosts(posts)
	if svc.BlogPosts() != posts {
		t.Fatalf("BlogPosts() did not return attached service")
	}
}

type fakeBlogPosts struct {
	posts map[int64]*PostSnapshot
}

func (f *fakeBlogPosts) GetPostSnapshot(_ context.Context, postID int64) (*PostSnapshot, error) {
	post, ok := f.posts[postID]
	if !ok {
		return nil, nil
	}
	copy := *post
	return &copy, nil
}
