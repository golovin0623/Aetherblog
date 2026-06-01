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
	if ai.path != "/api/v1/atlas/knowledge-points/7/index" {
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

type fakeAtlasSemanticSearchAIClient struct {
	path    string
	headers map[string]string
	body    string
}

func (f *fakeAtlasSemanticSearchAIClient) DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error) {
	f.path = path
	f.headers = headers
	raw, _ := io.ReadAll(body)
	f.body = string(raw)
	return io.NopCloser(strings.NewReader(`{
		"query":"evidence graph",
		"limit":3,
		"knowledge_points":[{
			"id":8,
			"title":"Semantic KP",
			"body_markdown":"semantic body",
			"type":"claim",
			"status":"evergreen",
			"confidence":0.86,
			"provenance":"user",
			"similarity":0.77,
			"recall_source":"semantic"
		}]
	}`)), http.StatusOK, nil
}

func TestAtlasSemanticSearchClientSearch(t *testing.T) {
	ai := &fakeAtlasSemanticSearchAIClient{}
	client := NewAtlasSemanticSearchClient(ai, "internal-token")
	userID := int64(9)

	result, err := client.Search(context.Background(), " evidence graph ", &userID, 3)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if ai.path != "/api/v1/atlas/search/semantic" {
		t.Fatalf("path = %q", ai.path)
	}
	if ai.headers["X-Internal-Service"] != "internal-token" {
		t.Fatalf("missing internal token header: %#v", ai.headers)
	}
	if !strings.Contains(ai.body, `"query":"evidence graph"`) || !strings.Contains(ai.body, `"user_id":9`) {
		t.Fatalf("body = %s, want query and user_id", ai.body)
	}
	if result.Query != "evidence graph" || len(result.KnowledgePoints) != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.KnowledgePoints[0].ID != 8 || result.KnowledgePoints[0].Similarity == nil || *result.KnowledgePoints[0].Similarity != 0.77 {
		t.Fatalf("unexpected hit: %#v", result.KnowledgePoints[0])
	}
}

func TestAtlasSemanticSearchClientRequiresInternalToken(t *testing.T) {
	client := NewAtlasSemanticSearchClient(&fakeAtlasSemanticSearchAIClient{}, "")
	_, err := client.Search(context.Background(), "query", nil, 3)
	if err == nil {
		t.Fatal("expected missing token error")
	}
}
