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

type noteIndexAIClient interface {
	DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error)
}

// NoteIndexResult 镜像 ai-service /v1/notes/{id}/index。
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

// NoteIndexerClient通过内部触发注释嵌入写入
// Atlas 和 KB 索引使用的 ai-service 通道。
type NoteIndexerClient struct {
	client        noteIndexAIClient
	internalToken string
}

func NewNoteIndexerClient(client noteIndexAIClient, internalToken string) *NoteIndexerClient {
	return &NoteIndexerClient{client: client, internalToken: internalToken}
}

func (c *NoteIndexerClient) IndexNote(ctx context.Context, noteID int64, userID *int64) (*NoteIndexResult, error) {
	if c == nil || c.client == nil {
		return nil, errors.New("note indexer client not configured")
	}
	if strings.TrimSpace(c.internalToken) == "" {
		return nil, errors.New("AI internal service token not configured")
	}
	body, err := json.Marshal(struct {
		UserID *int64 `json:"user_id,omitempty"`
	}{UserID: userID})
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
