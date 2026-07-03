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

type pdfAIClient interface {
	DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error)
}

// AIPDFTextExtractor通过内部服务通道调用ai-service /API/v1/atlas/pdf/extract。
type AIPDFTextExtractor struct {
	client        pdfAIClient
	internalToken string
}

// NewAIPDFTextExtractor 创建生产 PDF 文本提取器。
func NewAIPDFTextExtractor(client pdfAIClient, internalToken string) *AIPDFTextExtractor {
	return &AIPDFTextExtractor{client: client, internalToken: internalToken}
}

// ExtractPDFText 从 PDF 字节流中提取页面感知文本层。
func (e *AIPDFTextExtractor) ExtractPDFText(ctx context.Context, content []byte, mimeType string, filename string) (*PDFTextLayer, error) {
	if e == nil || e.client == nil {
		return nil, errors.New("AI PDF text extractor client not configured")
	}
	if strings.TrimSpace(e.internalToken) == "" {
		return nil, errors.New("AI internal service token not configured")
	}
	body, err := json.Marshal(struct {
		Filename     string `json:"filename,omitempty"`
		MimeType     string `json:"mime_type,omitempty"`
		ContentBytes []byte `json:"content_bytes"`
	}{
		Filename:     filename,
		MimeType:     mimeType,
		ContentBytes: content,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal pdf extract request: %w", err)
	}
	respBody, statusCode, err := e.client.DoSync(ctx, http.MethodPost, "/api/v1/atlas/pdf/extract", bytes.NewReader(body), map[string]string{
		"X-Internal-Service": e.internalToken,
	})
	if err != nil {
		return nil, fmt.Errorf("AI PDF extract request failed: %w", err)
	}
	defer respBody.Close()

	data, err := io.ReadAll(respBody)
	if err != nil {
		return nil, fmt.Errorf("read AI PDF extract response: %w", err)
	}
	if statusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("AI PDF extract returned %d: %s", statusCode, truncateForError(string(data), 240))
	}
	var out PDFTextLayer
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("parse AI PDF extract response: %w", err)
	}
	if strings.TrimSpace(out.TextHash) == "" {
		out.TextHash = contentSHA256(out.Text)
	}
	if out.CharCount == 0 {
		out.CharCount = len([]rune(out.Text))
	}
	if out.PageCount == 0 {
		out.PageCount = len(out.Pages)
	}
	if out.Extractor == "" {
		out.Extractor = "ai-service/pypdf"
	}
	return &out, nil
}

func truncateForError(s string, maxRunes int) string {
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	return string(r[:maxRunes]) + "..."
}
