package service

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/config"
)

// AIClient is an HTTP client that proxies requests to the FastAPI AI service.
type AIClient struct {
	baseURL      string
	syncClient   *http.Client
	streamClient *http.Client
}

// NewAIClient creates a new AIClient from the given config.
func NewAIClient(cfg config.AIConfig) *AIClient {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: cfg.ConnectTimeout,
		}).DialContext,
		MaxIdleConns:        20,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	}

	return &AIClient{
		baseURL: cfg.BaseURL,
		syncClient: &http.Client{
			Transport: transport,
			Timeout:   cfg.ReadTimeout,
		},
		streamClient: &http.Client{
			Transport: transport.Clone(),
			Timeout:   cfg.StreamReadTimeout,
		},
	}
}

// AIClientError represents an error from the AI service with an HTTP status code.
type AIClientError struct {
	StatusCode int
	Message    string
}

func (e *AIClientError) Error() string {
	return e.Message
}

// DoSync sends a synchronous request to the AI service and returns the raw response body.
// The caller is responsible for closing the returned ReadCloser.
func (c *AIClient) DoSync(ctx context.Context, method, path string, body io.Reader, authHeader string) (io.ReadCloser, int, error) {
	return c.do(ctx, c.syncClient, method, path, body, authHeader, "application/json")
}

// DoStream sends a streaming request to the AI service and returns the raw response body.
// The caller is responsible for closing the returned ReadCloser.
func (c *AIClient) DoStream(ctx context.Context, method, path string, body io.Reader, authHeader string) (io.ReadCloser, int, error) {
	return c.do(ctx, c.streamClient, method, path, body, authHeader, "application/json")
}

func (c *AIClient) do(ctx context.Context, client *http.Client, method, path string, body io.Reader, authHeader, contentType string) (io.ReadCloser, int, error) {
	url := c.baseURL + path

	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "application/json")
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}

	resp, err := client.Do(req)
	if err != nil {
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return nil, 0, &AIClientError{StatusCode: http.StatusGatewayTimeout, Message: "AI 服务请求超时"}
		}
		return nil, 0, &AIClientError{StatusCode: http.StatusBadGateway, Message: "AI 服务不可用"}
	}

	return resp.Body, resp.StatusCode, nil
}
