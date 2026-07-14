package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakeNoteIndexAIClient struct {
	method  string
	path    string
	headers map[string]string
	body    string
	status  int
	result  string
}

func (f *fakeNoteIndexAIClient) DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error) {
	f.method = method
	f.path = path
	f.headers = headers
	raw, _ := io.ReadAll(body)
	f.body = string(raw)
	result := f.result
	if result == "" {
		result = `{"note_id":11,"profile_id":42,"model_id":"text-embedding-3-small","embedding_dim":1536,"chunk_count":2,"doc_chars":120,"doc_tokens":36,"status":"INDEXED"}`
	}
	status := f.status
	if status == 0 {
		status = http.StatusOK
	}
	return io.NopCloser(strings.NewReader(result)), status, nil
}

func TestNoteIndexerClientGetReadiness(t *testing.T) {
	ai := &fakeNoteIndexAIClient{result: `{"note_id":11,"status":"ready","queryable":true,"profile_id":42,"profile_name":"Active search","model_id":"text-embedding-3-small","chunk_count":2,"carrier_id":77,"source_fingerprint":"current","indexed_fingerprint":"current","indexed_at":null,"message":"ready"}`}
	client := NewNoteIndexerClient(ai, "internal-token")
	userID := int64(9)

	result, err := client.GetReadiness(context.Background(), 11, &userID)
	if err != nil {
		t.Fatalf("GetReadiness returned error: %v", err)
	}
	if ai.method != http.MethodGet {
		t.Fatalf("method = %q, want GET", ai.method)
	}
	if ai.path != "/v1/notes/11/readiness?user_id=9" {
		t.Fatalf("path = %q", ai.path)
	}
	if ai.headers["X-Internal-Service"] != "internal-token" {
		t.Fatalf("missing internal token header: %#v", ai.headers)
	}
	if result.Status != "ready" || !result.Queryable || result.ProfileID == nil || *result.ProfileID != 42 || result.ChunkCount != 2 || result.CarrierID == nil || *result.CarrierID != 77 {
		t.Fatalf("unexpected result: %#v", result)
	}
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
