package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakePDFAIClient struct {
	status  int
	body    string
	headers map[string]string
	path    string
	payload map[string]string
}

func (f *fakePDFAIClient) DoSync(_ context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error) {
	if method != http.MethodPost {
		return io.NopCloser(strings.NewReader(`{}`)), http.StatusMethodNotAllowed, nil
	}
	f.path = path
	f.headers = headers
	raw, _ := io.ReadAll(body)
	_ = json.Unmarshal(raw, &f.payload)
	return io.NopCloser(strings.NewReader(f.body)), f.status, nil
}

func TestAIPDFTextExtractorCallsInternalAtlasPDFEndpoint(t *testing.T) {
	client := &fakePDFAIClient{
		status: http.StatusOK,
		body: `{
			"text":"第一页\n\n第二页",
			"text_hash":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			"page_count":2,
			"char_count":7,
			"pages":[{"page":1,"text":"第一页","char_start":0,"char_end":3}]
		}`,
	}
	extractor := NewAIPDFTextExtractor(client, "internal-token")

	layer, err := extractor.ExtractPDFText(context.Background(), []byte("%PDF"), "application/pdf", "atlas.pdf")
	if err != nil {
		t.Fatalf("ExtractPDFText returned error: %v", err)
	}
	if client.path != "/api/v1/atlas/pdf/extract" {
		t.Fatalf("path = %q, want /api/v1/atlas/pdf/extract", client.path)
	}
	if client.headers["X-Internal-Service"] != "internal-token" {
		t.Fatalf("X-Internal-Service header = %q", client.headers["X-Internal-Service"])
	}
	if got := client.payload["content_bytes"]; got != base64.StdEncoding.EncodeToString([]byte("%PDF")) {
		t.Fatalf("content_bytes = %q, want base64 PDF bytes", got)
	}
	if layer.PageCount != 2 || layer.TextHash == "" || layer.Text == "" {
		t.Fatalf("unexpected layer: %+v", layer)
	}
}

func TestAIPDFTextExtractorRequiresInternalToken(t *testing.T) {
	extractor := NewAIPDFTextExtractor(&fakePDFAIClient{}, "")

	_, err := extractor.ExtractPDFText(context.Background(), []byte("%PDF"), "application/pdf", "atlas.pdf")
	if err == nil || !strings.Contains(err.Error(), "token") {
		t.Fatalf("ExtractPDFText error = %v, want token error", err)
	}
}
