package service

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
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
	publishedAt := time.Date(2026, 5, 12, 10, 30, 0, 0, time.UTC)
	existing := &model.Post{
		Slug:         "manual-slug",
		CoverImage:   &cover,
		Password:     &passwordHash,
		PublishedAt:  &publishedAt,
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
	if post.PublishedAt == nil || !post.PublishedAt.Equal(publishedAt) {
		t.Errorf("publishedAt should be preserved, got %#v", post.PublishedAt)
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

func TestBuildPostUpdateModelSetsPublishedAtOnFirstPublish(t *testing.T) {
	existing := &model.Post{AllowComment: true}

	post, _ := buildPostUpdateModel(existing, dto.CreatePostRequest{
		Title:   "发布标题",
		Content: "发布正文",
		Status:  "PUBLISHED",
	}, "manual-slug", "PUBLISHED")

	if post.PublishedAt == nil {
		t.Fatal("publishedAt should be set on first publish")
	}
	if time.Since(*post.PublishedAt) > time.Second {
		t.Fatalf("publishedAt should be close to now, got %v", *post.PublishedAt)
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

func TestUpdateReturnsSetTagsError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	svc := &PostService{repo: repository.NewPostRepo(sqlx.NewDb(db, "sqlmock"))}
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	existingRows := sqlmock.NewRows([]string{
		"id", "title", "slug", "content_markdown", "status", "allow_comment", "created_at", "updated_at",
	}).AddRow(int64(7), "旧标题", "manual-slug", "旧正文", "DRAFT", true, now, now)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM posts WHERE id = $1 AND deleted = false`)).
		WithArgs(int64(7)).
		WillReturnRows(existingRows)

	updatedRows := sqlmock.NewRows([]string{
		"id", "title", "slug", "content_markdown", "status", "allow_comment", "created_at", "updated_at",
	}).AddRow(int64(7), "新标题", "manual-slug", "新正文", "DRAFT", true, now, now)
	mock.ExpectQuery(`UPDATE posts SET`).
		WillReturnRows(updatedRows)

	tagErr := errors.New("tag delete failed")
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM post_tags WHERE post_id = $1`)).
		WithArgs(int64(7)).
		WillReturnError(tagErr)
	mock.ExpectRollback()

	_, err = svc.Update(context.Background(), 7, dto.CreatePostRequest{
		Title:   "新标题",
		Content: "新正文",
		Status:  "DRAFT",
		TagIDs:  []int64{1, 2},
	}, 1)
	if !errors.Is(err, tagErr) {
		t.Fatalf("Update should return SetTags error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
