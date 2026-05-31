package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakeAtlasIndexAIClient struct {
	path    string
	headers map[string]string
	body    string
}

func (f *fakeAtlasIndexAIClient) DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error) {
	f.path = path
	f.headers = headers
	raw, _ := io.ReadAll(body)
	f.body = string(raw)
	return io.NopCloser(strings.NewReader(`{"kp_id":7,"profile_id":42,"model_id":"text-embedding-3-small","embedding_dim":1536}`)), http.StatusOK, nil
}

func TestAtlasIndexerClientIndexKnowledgePoint(t *testing.T) {
	ai := &fakeAtlasIndexAIClient{}
	client := NewAtlasIndexerClient(ai, "internal-token")
	userID := int64(9)

	result, err := client.IndexKnowledgePoint(context.Background(), 7, &userID)
	if err != nil {
		t.Fatalf("IndexKnowledgePoint returned error: %v", err)
	}
	if ai.path != "/v1/atlas/knowledge-points/7/index" {
		t.Fatalf("path = %q", ai.path)
	}
	if ai.headers["X-Internal-Service"] != "internal-token" {
		t.Fatalf("missing internal token header: %#v", ai.headers)
	}
	if !strings.Contains(ai.body, `"user_id":9`) {
		t.Fatalf("body = %s, want user_id", ai.body)
	}
	if result.KPID != 7 || result.ProfileID != 42 || result.EmbeddingDim != 1536 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestAtlasIndexerClientRequiresInternalToken(t *testing.T) {
	client := NewAtlasIndexerClient(&fakeAtlasIndexAIClient{}, "")
	_, err := client.IndexKnowledgePoint(context.Background(), 7, nil)
	if err == nil {
		t.Fatal("expected missing token error")
	}
}
