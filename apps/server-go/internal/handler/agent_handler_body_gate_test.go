package handler

// /agent/chat 请求体的廉价结构闸门测试：超纯文本预算（256KB）且不含
// image_url 的 body 必须在任何 JSON 解析之前被 413 拒绝；含 image_url 的
// 大 body 则放行进入正常解析链（由 24MB 上限与 Python 侧校验继续把关）。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/labstack/echo/v4"
)

func TestAgentChatBodyExceedsTextBudget(t *testing.T) {
	pad := strings.Repeat("a", agentChatTextOnlyBodyLimit)
	tests := []struct {
		name string
		body string
		want bool
	}{
		{name: "小体积纯文本放行", body: `{"messages":[]}`, want: false},
		{name: "恰好等于预算放行", body: pad, want: false},
		{name: "超预算且无图片片段拦截", body: pad + "x", want: true},
		// 含 image_url 字样的大 body 放行——闸门只做廉价判定，体积仍由
		// 24MB 上限与 Python 侧图片校验约束。
		{name: "超预算但含图片片段放行", body: pad + `"image_url"`, want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := agentChatBodyExceedsTextBudget([]byte(tc.body)); got != tc.want {
				t.Fatalf("agentChatBodyExceedsTextBudget(len=%d) = %v, want %v", len(tc.body), got, tc.want)
			}
		})
	}
}

func TestAgentHandlerChatRejectsOversizedTextOnlyBodyBeforeParsing(t *testing.T) {
	h := &AgentHandler{internalToken: "test-internal-token"}
	// 故意用非法 JSON：若闸门未能在解析前短路，后续 normalize 会把它判成
	// 400 而不是 413——通过状态码即可断言「解析从未发生」。
	body := strings.Repeat("a", agentChatTextOnlyBodyLimit+1)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/chat", strings.NewReader(body))
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "AUTHOR"})

	if err := h.Chat(c); err != nil {
		t.Fatalf("Chat returned error: %v", err)
	}
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("HTTP status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
	var out struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("parse response: %v", err)
	}
	if out.Code != http.StatusRequestEntityTooLarge || out.Message != "请求体过大" {
		t.Fatalf("response = %+v, want 413/请求体过大", out)
	}
}

func TestAgentHandlerChatOversizedBodyWithImageMarkerReachesParsing(t *testing.T) {
	h := &AgentHandler{internalToken: "test-internal-token"}
	// 超预算但含 image_url 字样：闸门放行，进入 normalize —— 用非法的
	// knowledgeContextMode 断言请求真的走到了 JSON 解析阶段（400 而非 413）。
	pad := strings.Repeat("a", agentChatTextOnlyBodyLimit)
	body := `{"messages":[],"knowledgeContextMode":"invalid","pad":"image_url` + pad + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/chat", strings.NewReader(body))
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "AUTHOR"})

	if err := h.Chat(c); err != nil {
		t.Fatalf("Chat returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("HTTP status = %d, want %d (should reach JSON parsing)", rec.Code, http.StatusBadRequest)
	}
}
