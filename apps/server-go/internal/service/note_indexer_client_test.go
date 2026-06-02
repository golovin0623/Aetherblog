package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakeNoteIndexAIClient struct {
	path    string
	headers map[string]string
	body    string
}

func (f *fakeNoteIndexAIClient) DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error) {
	f.path = path
	f.headers = headers
	raw, _ := io.ReadAll(body)
	f.body = string(raw)
	return io.NopCloser(strings.NewReader(`{"note_id":11,"profile_id":42,"model_id":"text-embedding-3-small","embedding_dim":1536,"chunk_count":2,"doc_chars":120,"doc_tokens":36,"status":"INDEXED"}`)), http.StatusOK, nil
}

func TestNoteIndexerClientIndexNote(t *testing.T) {
	ai := &fakeNoteIndexAIClient{}
	client := NewNoteIndexerClient(ai, "internal-token")
	userID := int64(9)

	result, err := client.IndexNote(context.Background(), 11, &userID)
	if err != nil {
		t.Fatalf("IndexNote returned error: %v", err)
	}
	if ai.path != "/v1/notes/11/index" {
		t.Fatalf("path = %q", ai.path)
	}
	if ai.headers["X-Internal-Service"] != "internal-token" {
		t.Fatalf("missing internal token header: %#v", ai.headers)
	}
	if !strings.Contains(ai.body, `"user_id":9`) {
		t.Fatalf("body = %s, want user_id", ai.body)
	}
	if result.NoteID != 11 || result.ProfileID != 42 || result.EmbeddingDim != 1536 || result.ChunkCount != 2 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestNoteIndexerClientRequiresInternalToken(t *testing.T) {
	client := NewNoteIndexerClient(&fakeNoteIndexAIClient{}, "")
	_, err := client.IndexNote(context.Background(), 11, nil)
	if err == nil {
		t.Fatal("expected missing token error")
	}
}
