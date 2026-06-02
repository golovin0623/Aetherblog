package handler

import (
	"errors"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

func int64Ptr(v int64) *int64 {
	return &v
}

func TestCommonAtlasAuthorIDPrefersScopedOwner(t *testing.T) {
	got, err := commonAtlasAuthorID("evidence", int64Ptr(1), int64Ptr(42))
	if err != nil {
		t.Fatalf("commonAtlasAuthorID returned error: %v", err)
	}
	if got == nil || *got != 42 {
		t.Fatalf("author id = %v, want 42", got)
	}
}

func TestCommonAtlasAuthorIDRejectsMixedOwners(t *testing.T) {
	_, err := commonAtlasAuthorID("relation", int64Ptr(1), int64Ptr(42), int64Ptr(43))
	var atlasErr *atlasHandlerError
	if !errors.As(err, &atlasErr) || atlasErr.code != response.BadRequest {
		t.Fatalf("error = %v, want BadRequest atlas error", err)
	}
}
