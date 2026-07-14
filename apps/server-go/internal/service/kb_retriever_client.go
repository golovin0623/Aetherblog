package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/dto"
)

var ErrKBRetrieveUnavailable = errors.New("knowledge retrieval unavailable")

type KBRetrievePayload struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

type KBRetrieverClient struct {
	ai            *AIClient
	internalToken string
}

func NewKBRetrieverClient(cfg config.AIConfig) *KBRetrieverClient {
	return &KBRetrieverClient{
		ai:            NewAIClient(cfg),
		internalToken: cfg.InternalServiceToken,
	}
}

// Retrieve calls the strict single-KB retrieval endpoint. It never includes an
// upstream response body in returned errors because those bodies can contain
// provider/database diagnostics that are not safe for an admin HTTP response.
func (c *KBRetrieverClient) Retrieve(
	ctx context.Context,
	kbID int64,
	payload KBRetrievePayload,
) (*dto.KBRetrieveResponse, error) {
	query := strings.TrimSpace(payload.Query)
	if c == nil || c.ai == nil || c.internalToken == "" || kbID <= 0 ||
		len([]rune(query)) < 2 || len([]rune(query)) > 500 || payload.Limit < 1 || payload.Limit > 10 {
		return nil, ErrKBRetrieveUnavailable
	}
	payload.Query = query
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, ErrKBRetrieveUnavailable
	}
	body, status, err := c.ai.DoSync(
		ctx,
		http.MethodPost,
		fmt.Sprintf("/api/v1/kb/%d/retrieve", kbID),
		bytes.NewReader(bodyBytes),
		map[string]string{"X-Internal-Service": c.internalToken},
	)
	if err != nil {
		return nil, ErrKBRetrieveUnavailable
	}
	defer body.Close()
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(body, 64<<10))
		return nil, ErrKBRetrieveUnavailable
	}

	var wrapper struct {
		Code int                    `json:"code"`
		Data dto.KBRetrieveResponse `json:"data"`
	}
	decoder := json.NewDecoder(io.LimitReader(body, 2<<20))
	if err := decoder.Decode(&wrapper); err != nil {
		return nil, ErrKBRetrieveUnavailable
	}
	if wrapper.Code != http.StatusOK || len(wrapper.Data.Hits) > payload.Limit {
		return nil, ErrKBRetrieveUnavailable
	}
	switch wrapper.Data.Status {
	case "matched", "empty", "unavailable":
	default:
		return nil, ErrKBRetrieveUnavailable
	}
	if (wrapper.Data.Status == "matched") != (len(wrapper.Data.Hits) > 0) {
		return nil, ErrKBRetrieveUnavailable
	}
	for _, hit := range wrapper.Data.Hits {
		if hit.FileID <= 0 || hit.ChunkIndex < 0 || math.IsNaN(hit.Score) ||
			math.IsInf(hit.Score, 0) || hit.Score < 0 || hit.Score > 1 {
			return nil, ErrKBRetrieveUnavailable
		}
	}
	wrapper.Data.Query = payload.Query
	if wrapper.Data.Hits == nil {
		wrapper.Data.Hits = []dto.KBRetrieveHit{}
	}
	return &wrapper.Data, nil
}
