package service

import (
	"context"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
)

func TestResolveUpdateSlugPreservesExistingWhenOmitted(t *testing.T) {
	svc := &PostService{}

	got, err := svc.resolveUpdateSlug(context.Background(), "manual-slug", nil, "new title", 42)
	if err != nil {
		t.Fatalf("resolveUpdateSlug: %v", err)
	}
	if got != "manual-slug" {
		t.Fatalf("omitted slug should keep existing value, got %q", got)
	}
}

func TestBuildPostUpdateModelPreservesOmittedSensitiveProperties(t *testing.T) {
	cover := "https://cdn.example.com/cover.png"
	passwordHash := "$2a$10$abcdefghijklmnopqrstuuDSmw7MnyHid9VZgONwV5cdvLc6VeFKC"
	existing := &model.Post{
		Slug:         "manual-slug",
		CoverImage:   &cover,
		Password:     &passwordHash,
		IsHidden:     true,
		IsPinned:     true,
		PinPriority:  9,
		AllowComment: false,
	}

	post, shouldHashPassword := buildPostUpdateModel(existing, dto.CreatePostRequest{
		Title:   "更新标题",
		Content: "更新正文",
		Status:  "PUBLISHED",
	}, existing.Slug, "PUBLISHED")

	if shouldHashPassword {
		t.Fatal("omitted password must not be re-hashed")
	}
	if post.Slug != "manual-slug" {
		t.Errorf("slug should be preserved, got %q", post.Slug)
	}
	if post.CoverImage == nil || *post.CoverImage != cover {
		t.Errorf("cover image should be preserved, got %#v", post.CoverImage)
	}
	if post.Password == nil || *post.Password != passwordHash {
		t.Errorf("password hash should be preserved, got %#v", post.Password)
	}
	if !post.IsHidden {
		t.Error("isHidden should be preserved")
	}
	if !post.IsPinned || post.PinPriority != 9 {
		t.Errorf("pin settings should be preserved, got isPinned=%v pinPriority=%d", post.IsPinned, post.PinPriority)
	}
	if post.AllowComment {
		t.Error("allowComment=false should be preserved")
	}
}

func TestBuildPostUpdateModelHashesOnlyExplicitPassword(t *testing.T) {
	oldPasswordHash := "$2a$10$abcdefghijklmnopqrstuuDSmw7MnyHid9VZgONwV5cdvLc6VeFKC"
	newPassword := "new-secret"
	existing := &model.Post{Password: &oldPasswordHash, AllowComment: true}

	post, shouldHashPassword := buildPostUpdateModel(existing, dto.CreatePostRequest{
		Title:    "更新标题",
		Content:  "更新正文",
		Password: &newPassword,
	}, "manual-slug", "DRAFT")

	if !shouldHashPassword {
		t.Fatal("explicit password should be hashed")
	}
	svc := &PostService{}
	if err := svc.hashPostPassword(post); err != nil {
		t.Fatalf("hashPostPassword: %v", err)
	}
	if post.Password == nil {
		t.Fatal("password should be set")
	}
	if *post.Password == newPassword || *post.Password == oldPasswordHash {
		t.Fatalf("password should be a fresh bcrypt hash, got %q", *post.Password)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*post.Password), []byte(newPassword)); err != nil {
		t.Fatalf("stored password hash should match explicit new password: %v", err)
	}
}

func TestBuildPostUpdateModelClearsExplicitEmptyPassword(t *testing.T) {
	oldPasswordHash := "$2a$10$abcdefghijklmnopqrstuuDSmw7MnyHid9VZgONwV5cdvLc6VeFKC"
	emptyPassword := ""
	existing := &model.Post{Password: &oldPasswordHash, AllowComment: true}

	post, shouldHashPassword := buildPostUpdateModel(existing, dto.CreatePostRequest{
		Title:    "更新标题",
		Content:  "更新正文",
		Password: &emptyPassword,
	}, "manual-slug", "DRAFT")

	if !shouldHashPassword {
		t.Fatal("explicit empty password should be treated as a password update")
	}
	svc := &PostService{}
	if err := svc.hashPostPassword(post); err != nil {
		t.Fatalf("hashPostPassword: %v", err)
	}
	if post.Password != nil {
		t.Fatalf("explicit empty password should clear protection, got %#v", post.Password)
	}
}
