package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/config"
)

func TestKBRetrieverClientUsesInternalTokenAndDecodesRankedHits(t *testing.T) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/kb/7/retrieve" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("X-Internal-Service"); got != "internal-token" {
			t.Fatalf("X-Internal-Service = %q", got)
		}
		var payload KBRetrievePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload.Query != "退款规则是什么？" || payload.Limit != 5 {
			t.Fatalf("payload = %+v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"data":{"status":"matched","query":"退款规则是什么？","hits":[{"title":"退款政策.md","snippet":"七天内可申请退款。","score":0.91,"fileId":11,"chunkIndex":3}]}}`))
	}))
	defer server.Close()

	client := NewKBRetrieverClient(config.AIConfig{
		BaseURL: server.URL, ConnectTimeout: time.Second, ReadTimeout: time.Second,
		StreamReadTimeout: time.Second, InternalServiceToken: "internal-token",
	})
	result, err := client.Retrieve(context.Background(), 7, KBRetrievePayload{
		Query: "退款规则是什么？", Limit: 5,
	})
	if err != nil {
		t.Fatalf("Retrieve error: %v", err)
	}
	if result.Status != "matched" || len(result.Hits) != 1 || result.Hits[0].FileID != 11 {
		t.Fatalf("result = %+v", result)
	}
}

func TestKBRetrieverClientReturnsSafeUnavailableError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "postgresql://user:password@internal-db/private", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	client := NewKBRetrieverClient(config.AIConfig{
		BaseURL: server.URL, ConnectTimeout: time.Second, ReadTimeout: time.Second,
		StreamReadTimeout: time.Second, InternalServiceToken: "internal-token",
	})
	_, err := client.Retrieve(context.Background(), 7, KBRetrievePayload{Query: "valid question", Limit: 5})
	if err == nil {
		t.Fatal("Retrieve error = nil")
	}
	if got := err.Error(); got != "knowledge retrieval unavailable" {
		t.Fatalf("error = %q", got)
	}
}

func TestKBRetrieverClientRejectsInconsistentMatchedEnvelope(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"data":{"status":"matched","query":"spoofed","hits":[]}}`))
	}))
	defer server.Close()

	client := NewKBRetrieverClient(config.AIConfig{
		BaseURL: server.URL, ConnectTimeout: time.Second, ReadTimeout: time.Second,
		StreamReadTimeout: time.Second, InternalServiceToken: "internal-token",
	})
	_, err := client.Retrieve(context.Background(), 7, KBRetrievePayload{Query: "valid question", Limit: 5})
	if !errors.Is(err, ErrKBRetrieveUnavailable) {
		t.Fatalf("error = %v", err)
	}
}
