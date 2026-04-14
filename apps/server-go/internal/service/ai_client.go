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

// AIClient 是向 FastAPI AI 服务转发请求的 HTTP 客户端。
// 内部维护两个独立的 http.Client：一个用于同步请求，一个用于流式请求，
// 两者超时配置不同以适应各自的使用场景。
type AIClient struct {
	baseURL      string
	syncClient   *http.Client
	streamClient *http.Client
}

// NewAIClient 根据给定的 AI 配置创建一个新的 AIClient。
// syncClient 使用 ReadTimeout，streamClient 使用 StreamReadTimeout（通常更长），
// 两者共用底层 Transport 以复用连接池。
func NewAIClient(cfg config.AIConfig) *AIClient {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: cfg.ConnectTimeout, // TCP 连接超时
		}).DialContext,
		MaxIdleConns:        20,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	}

	return &AIClient{
		baseURL: cfg.BaseURL,
		syncClient: &http.Client{
			Transport: transport,
			Timeout:   cfg.ReadTimeout, // 同步接口读取超时
		},
		streamClient: &http.Client{
			Transport: transport.Clone(),
			Timeout:   cfg.StreamReadTimeout, // 流式接口读取超时（较长）
		},
	}
}

// AIClientError 表示来自 AI 服务的错误，携带 HTTP 状态码和错误信息。
type AIClientError struct {
	StatusCode int
	Message    string
}

// Error 实现 error 接口，返回错误信息字符串。
func (e *AIClientError) Error() string {
	return e.Message
}

// DoSync 向 AI 服务发送同步请求，返回原始响应体（ReadCloser）。
// 调用方负责关闭返回的 ReadCloser。
// headers 为附加到出站请求的额外 HTTP 头（如 Authorization、X-Request-ID）。
// 错误场景：AI 服务请求超时返回 504，AI 服务不可达返回 502。
func (c *AIClient) DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error) {
	return c.do(ctx, c.syncClient, method, path, body, headers, "application/json")
}

// DoStream 向 AI 服务发送流式请求，返回原始响应体（ReadCloser）。
// 调用方负责关闭返回的 ReadCloser。
// headers 为附加到出站请求的额外 HTTP 头（如 Authorization、X-Request-ID）。
// 错误场景：AI 服务请求超时返回 504，AI 服务不可达返回 502。
func (c *AIClient) DoStream(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error) {
	return c.do(ctx, c.streamClient, method, path, body, headers, "application/json")
}

// do 是底层 HTTP 请求执行方法，供 DoSync 和 DoStream 共用。
// 设置 Content-Type、Accept 及调用方传入的自定义请求头后发起请求。
// 发生网络超时时包装为 AIClientError(504)，其他网络错误包装为 AIClientError(502)。
func (c *AIClient) do(ctx context.Context, client *http.Client, method, path string, body io.Reader, headers map[string]string, contentType string) (io.ReadCloser, int, error) {
	url := c.baseURL + path

	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "application/json")
	// 设置调用方传入的自定义请求头（跳过空值）
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		// 请求上下文被取消（如客户端断开连接导致的 HTTP 499）
		if ctx.Err() == context.Canceled {
			return nil, 0, &AIClientError{StatusCode: 499, Message: "请求已取消"}
		}
		if ctx.Err() == context.DeadlineExceeded {
			return nil, 0, &AIClientError{StatusCode: http.StatusGatewayTimeout, Message: "AI 服务请求超时"}
		}
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return nil, 0, &AIClientError{StatusCode: http.StatusGatewayTimeout, Message: "AI 服务请求超时"}
		}
		return nil, 0, &AIClientError{StatusCode: http.StatusBadGateway, Message: "AI 服务不可用"}
	}

	return resp.Body, resp.StatusCode, nil
}
