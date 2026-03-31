// Package testutil 为 handler 测试提供共享的测试基础设施。
package testutil

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// TestJWTSecret 是单元测试专用的 JWT 密钥，不可用于生产环境。
const TestJWTSecret = "test-secret-for-unit-tests-only"

// echoValidator 是对 go-playground/validator 的 Echo 适配包装，
// 实现了 echo.Validator 接口。
type echoValidator struct{ v *validator.Validate }

// Validate 对传入的结构体执行校验，实现 echo.Validator 接口。
func (ev *echoValidator) Validate(i any) error { return ev.v.Struct(i) }

// NewEcho 创建一个配置了校验器的全新 Echo 实例，与服务端配置保持一致。
func NewEcho() *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Validator = &echoValidator{v: validator.New()}
	return e
}

// DoRequest 向指定的 Echo 实例发送 HTTP 请求并返回响应记录器。
// headers 为可选参数，可附加额外请求头。
func DoRequest(e *echo.Echo, method, path string, body string, headers ...http.Header) *httptest.ResponseRecorder {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	// 追加调用方提供的额外请求头
	if len(headers) > 0 {
		for k, vs := range headers[0] {
			for _, v := range vs {
				req.Header.Set(k, v)
			}
		}
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// DoAuthRequest 向指定的 Echo 实例发送携带有效 JWT Authorization 头的 HTTP 请求。
// 使用 TestJWTSecret 为指定用户 ID 签发测试用 Token。
func DoAuthRequest(e *echo.Echo, method, path, body string, userID int64) *httptest.ResponseRecorder {
	token, _ := jwtutil.GenerateToken(userID, "admin", "ADMIN", TestJWTSecret, time.Hour)
	h := http.Header{}
	h.Set("Authorization", "Bearer "+token)
	return DoRequest(e, method, path, body, h)
}

// ParseResponse 从响应记录器的 Body 中解析出标准 response.R 响应结构。
func ParseResponse(rec *httptest.ResponseRecorder) (*response.R, error) {
	var r response.R
	if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
		return nil, err
	}
	return &r, nil
}
