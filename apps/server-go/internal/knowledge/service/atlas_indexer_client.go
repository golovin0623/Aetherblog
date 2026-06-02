package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type atlasIndexAIClient interface {
	DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error)
}

// AtlasIndexResult mirrors ai-service /api/v1/atlas/knowledge-points/{id}/index.
type AtlasIndexResult struct {
	KPID         int64  `json:"kp_id"`
	ProfileID    int64  `json:"profile_id"`
	ModelID      string `json:"model_id"`
	EmbeddingDim int    `json:"embedding_dim"`
}

// AtlasIndexerClient triggers ai-service Atlas embedding writes through the
// same internal-service channel used by PDF extraction and AI suggestions.
type AtlasIndexerClient struct {
	client        atlasIndexAIClient
	internalToken string
}

func NewAtlasIndexerClient(client atlasIndexAIClient, internalToken string) *AtlasIndexerClient {
	return &AtlasIndexerClient{client: client, internalToken: internalToken}
}

func (c *AtlasIndexerClient) IndexKnowledgePoint(ctx context.Context, kpID int64, userID *int64) (*AtlasIndexResult, error) {
	if c == nil || c.client == nil {
		return nil, errors.New("Atlas indexer client not configured")
	}
	if strings.TrimSpace(c.internalToken) == "" {
		return nil, errors.New("AI internal service token not configured")
	}
	body, err := json.Marshal(struct {
		UserID *int64 `json:"user_id,omitempty"`
	}{UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("marshal Atlas KP index request: %w", err)
	}
	path := fmt.Sprintf("/api/v1/atlas/knowledge-points/%d/index", kpID)
	respBody, statusCode, err := c.client.DoSync(ctx, http.MethodPost, path, bytes.NewReader(body), map[string]string{
		"X-Internal-Service": c.internalToken,
	})
	if err != nil {
		return nil, fmt.Errorf("AI Atlas KP index request failed: %w", err)
	}
	defer respBody.Close()

	raw, err := io.ReadAll(respBody)
	if err != nil {
		return nil, fmt.Errorf("read AI Atlas KP index response: %w", err)
	}
	if statusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("AI Atlas KP index returned %d: %s", statusCode, truncateForError(string(raw), 240))
	}
	var out AtlasIndexResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parse AI Atlas KP index response: %w", err)
	}
	return &out, nil
}

// AtlasSemanticKnowledgePointHit mirrors ai-service /api/v1/atlas/search/semantic hits.
type AtlasSemanticKnowledgePointHit struct {
	ID           int64    `json:"id"`
	Title        string   `json:"title"`
	BodyMarkdown string   `json:"body_markdown"`
	Type         string   `json:"type"`
	Status       string   `json:"status"`
	Confidence   float32  `json:"confidence"`
	Provenance   string   `json:"provenance"`
	Similarity   *float64 `json:"similarity,omitempty"`
	RecallSource string   `json:"recall_source"`
}

// AtlasSemanticSearchResult mirrors ai-service /api/v1/atlas/search/semantic.
type AtlasSemanticSearchResult struct {
	Query           string                           `json:"query"`
	Limit           int                              `json:"limit"`
	KnowledgePoints []AtlasSemanticKnowledgePointHit `json:"knowledge_points"`
}

// AtlasSemanticSearchClient calls ai-service semantic recall for Atlas search reranking.
type AtlasSemanticSearchClient struct {
	client        atlasIndexAIClient
	internalToken string
}

func NewAtlasSemanticSearchClient(client atlasIndexAIClient, internalToken string) *AtlasSemanticSearchClient {
	return &AtlasSemanticSearchClient{client: client, internalToken: internalToken}
}

func (c *AtlasSemanticSearchClient) Search(ctx context.Context, query string, userID *int64, limit int) (*AtlasSemanticSearchResult, error) {
	if c == nil || c.client == nil {
		return nil, errors.New("Atlas semantic search client not configured")
	}
	if strings.TrimSpace(c.internalToken) == "" {
		return nil, errors.New("AI internal service token not configured")
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("Atlas semantic search query is empty")
	}
	if limit <= 0 {
		limit = 8
	} else if limit > 25 {
		limit = 25
	}
	body, err := json.Marshal(struct {
		Query  string `json:"query"`
		UserID *int64 `json:"user_id,omitempty"`
		Limit  int    `json:"limit"`
	}{Query: query, UserID: userID, Limit: limit})
	if err != nil {
		return nil, fmt.Errorf("marshal Atlas semantic search request: %w", err)
	}
	respBody, statusCode, err := c.client.DoSync(ctx, http.MethodPost, "/api/v1/atlas/search/semantic", bytes.NewReader(body), map[string]string{
		"X-Internal-Service": c.internalToken,
	})
	if err != nil {
		return nil, fmt.Errorf("AI Atlas semantic search request failed: %w", err)
	}
	defer respBody.Close()

	raw, err := io.ReadAll(respBody)
	if err != nil {
		return nil, fmt.Errorf("read AI Atlas semantic search response: %w", err)
	}
	if statusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("AI Atlas semantic search returned %d: %s", statusCode, truncateForError(string(raw), 240))
	}
	var out AtlasSemanticSearchResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parse AI Atlas semantic search response: %w", err)
	}
	return &out, nil
}
