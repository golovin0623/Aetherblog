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
	"time"
)

type noteIndexAIClient interface {
	DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error)
}

// NoteIndexResult mirrors ai-service /v1/notes/{id}/index.
type NoteIndexResult struct {
	NoteID       int64  `json:"note_id"`
	ProfileID    int64  `json:"profile_id"`
	ModelID      string `json:"model_id"`
	EmbeddingDim int    `json:"embedding_dim"`
	ChunkCount   int    `json:"chunk_count"`
	DocChars     int    `json:"doc_chars"`
	DocTokens    int    `json:"doc_tokens"`
	Status       string `json:"status"`
	Error        string `json:"error,omitempty"`
}

// NoteKnowledgeReadinessResult mirrors ai-service /v1/notes/{id}/readiness.
type NoteKnowledgeReadinessResult struct {
	NoteID             int64      `json:"note_id"`
	Status             string     `json:"status"`
	Queryable          bool       `json:"queryable"`
	ProfileID          *int64     `json:"profile_id"`
	ProfileName        *string    `json:"profile_name"`
	ModelID            *string    `json:"model_id"`
	ChunkCount         int        `json:"chunk_count"`
	CarrierID          *int64     `json:"carrier_id"`
	SourceFingerprint  string     `json:"source_fingerprint"`
	IndexedFingerprint *string    `json:"indexed_fingerprint"`
	IndexedAt          *time.Time `json:"indexed_at"`
	Message            string     `json:"message"`
}

// NoteIndexerClient triggers note embedding writes through the internal
// ai-service channel used by Atlas and KB indexing.
type NoteIndexerClient struct {
	client        noteIndexAIClient
	internalToken string
}

func NewNoteIndexerClient(client noteIndexAIClient, internalToken string) *NoteIndexerClient {
	return &NoteIndexerClient{client: client, internalToken: internalToken}
}

func (c *NoteIndexerClient) IndexNote(ctx context.Context, noteID int64, userID *int64, attemptID *string) (*NoteIndexResult, error) {
	if c == nil || c.client == nil {
		return nil, errors.New("note indexer client not configured")
	}
	if strings.TrimSpace(c.internalToken) == "" {
		return nil, errors.New("AI internal service token not configured")
	}
	body, err := json.Marshal(struct {
		UserID    *int64  `json:"user_id,omitempty"`
		AttemptID *string `json:"attempt_id,omitempty"`
	}{UserID: userID, AttemptID: attemptID})
	if err != nil {
		return nil, fmt.Errorf("marshal note index request: %w", err)
	}
	path := fmt.Sprintf("/v1/notes/%d/index", noteID)
	respBody, statusCode, err := c.client.DoSync(ctx, http.MethodPost, path, bytes.NewReader(body), map[string]string{
		"X-Internal-Service": c.internalToken,
	})
	if err != nil {
		return nil, fmt.Errorf("AI note index request failed: %w", err)
	}
	defer respBody.Close()

	raw, err := io.ReadAll(respBody)
	if err != nil {
		return nil, fmt.Errorf("read AI note index response: %w", err)
	}
	if statusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("AI note index returned %d: %s", statusCode, truncate(string(raw), 240))
	}
	var out NoteIndexResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parse AI note index response: %w", err)
	}
	return &out, nil
}

// GetReadiness returns the fail-closed queryability receipt for one note.
func (c *NoteIndexerClient) GetReadiness(ctx context.Context, noteID int64, userID *int64) (*NoteKnowledgeReadinessResult, error) {
	if c == nil || c.client == nil {
		return nil, errors.New("note indexer client not configured")
	}
	if strings.TrimSpace(c.internalToken) == "" {
		return nil, errors.New("AI internal service token not configured")
	}
	path := fmt.Sprintf("/v1/notes/%d/readiness", noteID)
	if userID != nil && *userID > 0 {
		path += fmt.Sprintf("?user_id=%d", *userID)
	}
	respBody, statusCode, err := c.client.DoSync(ctx, http.MethodGet, path, bytes.NewReader(nil), map[string]string{
		"X-Internal-Service": c.internalToken,
	})
	if err != nil {
		return nil, fmt.Errorf("AI note readiness request failed: %w", err)
	}
	defer respBody.Close()

	raw, err := io.ReadAll(respBody)
	if err != nil {
		return nil, fmt.Errorf("read AI note readiness response: %w", err)
	}
	if statusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("AI note readiness returned %d: %s", statusCode, truncate(string(raw), 240))
	}
	var out NoteKnowledgeReadinessResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parse AI note readiness response: %w", err)
	}
	return &out, nil
}
