package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// fakeAgentSessionStore 是 service.AgentSessionStore 的内存实现，
// 语义契约对齐 repository.AgentSessionRepo（归属校验 / LWW / 全量替换）。
type fakeAgentSessionStore struct {
	sessions map[string]*model.AgentChatSession
	messages map[string][]model.AgentChatMessage
}

func newFakeAgentSessionStore() *fakeAgentSessionStore {
	return &fakeAgentSessionStore{
		sessions: map[string]*model.AgentChatSession{},
		messages: map[string][]model.AgentChatMessage{},
	}
}

func (f *fakeAgentSessionStore) ListByUser(_ context.Context, userID int64, limit int) ([]model.AgentChatSessionListRow, error) {
	rows := []model.AgentChatSessionListRow{}
	for _, s := range f.sessions {
		if s.UserID != userID {
			continue
		}
		rows = append(rows, model.AgentChatSessionListRow{
			AgentChatSession: *s,
			MessageCount:     int64(len(f.messages[s.ID])),
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Pinned != rows[j].Pinned {
			return rows[i].Pinned
		}
		return rows[i].ClientUpdatedAt > rows[j].ClientUpdatedAt
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func (f *fakeAgentSessionStore) CountByUser(_ context.Context, userID int64) (int, error) {
	n := 0
	for _, s := range f.sessions {
		if s.UserID == userID {
			n++
		}
	}
	return n, nil
}

func (f *fakeAgentSessionStore) GetByIDForUser(_ context.Context, id string, userID int64) (*model.AgentChatSession, []model.AgentChatMessage, error) {
	s, ok := f.sessions[id]
	if !ok || s.UserID != userID {
		return nil, nil, nil
	}
	cp := *s
	msgs := append([]model.AgentChatMessage{}, f.messages[id]...)
	return &cp, msgs, nil
}

func (f *fakeAgentSessionStore) Upsert(_ context.Context, s *model.AgentChatSession, msgs []model.AgentChatMessage) error {
	if existing, ok := f.sessions[s.ID]; ok {
		if existing.UserID != s.UserID {
			return repository.ErrAgentSessionNotOwned
		}
		if existing.ClientUpdatedAt > s.ClientUpdatedAt {
			return repository.ErrAgentSessionConflict
		}
	}
	cp := *s
	f.sessions[s.ID] = &cp
	f.messages[s.ID] = append([]model.AgentChatMessage{}, msgs...)
	return nil
}

func (f *fakeAgentSessionStore) Delete(_ context.Context, id string, userID int64) (bool, error) {
	s, ok := f.sessions[id]
	if !ok || s.UserID != userID {
		return false, nil
	}
	delete(f.sessions, id)
	delete(f.messages, id)
	return true, nil
}

func newAgentSessionHandlerForTest(store service.AgentSessionStore) *AgentSessionHandler {
	return NewAgentSessionHandler(service.NewAgentSessionService(store))
}

// newAgentSessionCtx 构造带登录用户的 echo 上下文；sessionID 为空表示列表路由。
func newAgentSessionCtx(t *testing.T, method, body string, userID int64, sessionID string) (echo.Context, *httptest.ResponseRecorder) {
	t.Helper()
	e := testutil.NewEcho()
	target := "/v1/agent/sessions"
	if sessionID != "" {
		target += "/" + sessionID
	}
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if sessionID != "" {
		c.SetPath("/v1/agent/sessions/:id")
		c.SetParamNames("id")
		c.SetParamValues(sessionID)
	} else {
		c.SetPath("/v1/agent/sessions")
	}
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: userID, Role: "USER"})
	return c, rec
}

// decodeAgentSessionData 把 R.data 重新编解码到目标结构。
func decodeAgentSessionData(t *testing.T, rec *httptest.ResponseRecorder, out any) {
	t.Helper()
	r, err := testutil.ParseResponse(rec)
	if err != nil {
		t.Fatalf("parse response: %v (body=%s)", err, rec.Body.String())
	}
	raw, err := json.Marshal(r.Data)
	if err != nil {
		t.Fatalf("re-marshal data: %v", err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("decode data: %v (data=%s)", err, raw)
	}
}

const agentSessionTestBody = `{
	"title": "往返测试",
	"mode": "chat",
	"modelId": "gpt-4o",
	"providerCode": "openai",
	"modelParams": {"temperature": 0.7, "reasoning_effort": "high"},
	"pinned": true,
	"contextBreakId": "msg_a000000001",
	"draft": "未发送草稿",
	"createdAt": 1734000000000,
	"updatedAt": 1734000002000,
	"messages": [
		{"id": "msg_a000000001", "role": "user", "content": "你好",
		 "createdAt": 1734000000000,
		 "payload": {"requestSnapshot": {"schemaVersion": 1, "articleIds": null, "tagSlugs": null}}},
		{"id": "msg_a000000002", "role": "assistant", "content": "你好！",
		 "createdAt": 1734000001000,
		 "payload": {"think": "用户在打招呼", "modelId": "gpt-4o",
			"usage": {"promptTokens": 1, "completionTokens": 2, "totalTokens": 3, "estimated": false},
			"sources": [{"title": "文章", "slug": "post-a"}]}}
	]
}`

func TestAgentSessionPutRejectsInvalidID(t *testing.T) {
	for _, id := range []string{
		"short",                 // 长度不足 8
		"bad*chars!",            // 非法字符
		strings.Repeat("a", 65), // 超长
		"sess%20injected",       // URL 编码残留
	} {
		t.Run(id, func(t *testing.T) {
			h := newAgentSessionHandlerForTest(newFakeAgentSessionStore())
			c, rec := newAgentSessionCtx(t, http.MethodPut, agentSessionTestBody, 1, id)
			if err := h.Put(c); err != nil {
				t.Fatalf("Put error: %v", err)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestAgentSessionUpsertRoundTrip(t *testing.T) {
	store := newFakeAgentSessionStore()
	h := newAgentSessionHandlerForTest(store)
	const sid = "sess_roundtrip_01"

	// PUT 落库。
	c, rec := newAgentSessionCtx(t, http.MethodPut, agentSessionTestBody, 1, sid)
	if err := h.Put(c); err != nil {
		t.Fatalf("Put error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("put status = %d (body=%s)", rec.Code, rec.Body.String())
	}
	var meta dto.AgentSessionMetaVO
	decodeAgentSessionData(t, rec, &meta)
	if meta.ID != sid || meta.MessageCount != 2 || meta.UpdatedAt != 1734000002000 || !meta.Pinned {
		t.Fatalf("put meta = %+v", meta)
	}

	// GET 详情往返一致。
	c, rec = newAgentSessionCtx(t, http.MethodGet, "", 1, sid)
	if err := h.Get(c); err != nil {
		t.Fatalf("Get error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d (body=%s)", rec.Code, rec.Body.String())
	}
	var vo dto.AgentSessionVO
	decodeAgentSessionData(t, rec, &vo)
	if vo.Title != "往返测试" || vo.Mode != "chat" || vo.Draft != "未发送草稿" ||
		vo.ModelID == nil || *vo.ModelID != "gpt-4o" ||
		vo.ContextBreakID == nil || *vo.ContextBreakID != "msg_a000000001" ||
		vo.CreatedAt != 1734000000000 || vo.UpdatedAt != 1734000002000 {
		t.Fatalf("session meta mismatch: %+v", vo.AgentSessionMetaVO)
	}
	if len(vo.Messages) != 2 ||
		vo.Messages[0].ID != "msg_a000000001" || vo.Messages[0].Role != "user" ||
		vo.Messages[1].ID != "msg_a000000002" || vo.Messages[1].Role != "assistant" {
		t.Fatalf("messages mismatch: %+v", vo.Messages)
	}
	// payload 语义往返一致（think / usage / sources 原样回传）。
	var gotPayload, wantPayload map[string]any
	if err := json.Unmarshal(vo.Messages[1].Payload, &gotPayload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	wantJSON := `{"think": "用户在打招呼", "modelId": "gpt-4o",
		"usage": {"promptTokens": 1, "completionTokens": 2, "totalTokens": 3, "estimated": false},
		"sources": [{"title": "文章", "slug": "post-a"}]}`
	if err := json.Unmarshal([]byte(wantJSON), &wantPayload); err != nil {
		t.Fatalf("decode want payload: %v", err)
	}
	if !reflect.DeepEqual(gotPayload, wantPayload) {
		t.Fatalf("payload roundtrip mismatch:\n got  %v\n want %v", gotPayload, wantPayload)
	}
	var params map[string]any
	if err := json.Unmarshal(vo.ModelParams, &params); err != nil || params["temperature"] != 0.7 {
		t.Fatalf("modelParams roundtrip mismatch: %s (err=%v)", vo.ModelParams, err)
	}

	// List 含 messageCount、不含消息正文。
	c, rec = newAgentSessionCtx(t, http.MethodGet, "", 1, "")
	if err := h.List(c); err != nil {
		t.Fatalf("List error: %v", err)
	}
	var list []dto.AgentSessionMetaVO
	decodeAgentSessionData(t, rec, &list)
	if len(list) != 1 || list[0].ID != sid || list[0].MessageCount != 2 {
		t.Fatalf("list = %+v", list)
	}
	if strings.Contains(rec.Body.String(), `"messages"`) {
		t.Fatal("list must not include message bodies")
	}
}

func TestAgentSessionCrossUserIsNotFound(t *testing.T) {
	store := newFakeAgentSessionStore()
	h := newAgentSessionHandlerForTest(store)
	const sid = "sess_owned_by_u1"

	// user 1 建会话。
	c, rec := newAgentSessionCtx(t, http.MethodPut, agentSessionTestBody, 1, sid)
	if err := h.Put(c); err != nil {
		t.Fatalf("seed Put error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("seed status = %d", rec.Code)
	}

	// user 2 GET / PUT / DELETE 一律 404，且不改动 user 1 的数据。
	c, rec = newAgentSessionCtx(t, http.MethodGet, "", 2, sid)
	if err := h.Get(c); err != nil {
		t.Fatalf("Get error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-user get status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}

	hijack := strings.Replace(agentSessionTestBody, `"往返测试"`, `"越权覆盖"`, 1)
	c, rec = newAgentSessionCtx(t, http.MethodPut, hijack, 2, sid)
	if err := h.Put(c); err != nil {
		t.Fatalf("Put error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-user put status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}

	c, rec = newAgentSessionCtx(t, http.MethodDelete, "", 2, sid)
	if err := h.Delete(c); err != nil {
		t.Fatalf("Delete error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-user delete status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}

	if got := store.sessions[sid]; got == nil || got.UserID != 1 || got.Title != "往返测试" {
		t.Fatalf("owner data must be untouched, got %+v", got)
	}
}

// TestAgentSessionQuotaRejectsNewSessionAt500 会话数配额（P2-G）：
// 库中已有 500 个会话时，新 id 的 PUT 必须 400；已有会话的更新仍放行。
func TestAgentSessionQuotaRejectsNewSessionAt500(t *testing.T) {
	store := newFakeAgentSessionStore()
	for i := 0; i < 500; i++ {
		id := "sess_quota_" + strconv.Itoa(10000+i)
		store.sessions[id] = &model.AgentChatSession{
			ID: id, UserID: 1, Mode: model.AgentSessionModeChat,
			ClientCreatedAt: 1734000000000, ClientUpdatedAt: 1734000000000,
		}
	}
	h := newAgentSessionHandlerForTest(store)

	// 新会话 id → 400 + 配额文案。
	c, rec := newAgentSessionCtx(t, http.MethodPut, agentSessionTestBody, 1, "sess_quota_new_01")
	if err := h.Put(c); err != nil {
		t.Fatalf("Put error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("quota put status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "会话数量已达上限") {
		t.Fatalf("quota message missing, body=%s", rec.Body.String())
	}
	if len(store.sessions) != 500 {
		t.Fatalf("session count = %d, want unchanged 500", len(store.sessions))
	}

	// 配额满时更新已有会话必须仍然成功（否则清理前无法正常同步）。
	c, rec = newAgentSessionCtx(t, http.MethodPut, agentSessionTestBody, 1, "sess_quota_10000")
	if err := h.Put(c); err != nil {
		t.Fatalf("update Put error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("update-at-quota status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	// 其他用户不受 user 1 的配额影响。
	c, rec = newAgentSessionCtx(t, http.MethodPut, agentSessionTestBody, 2, "sess_other_user1")
	if err := h.Put(c); err != nil {
		t.Fatalf("other-user Put error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("other-user status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
}

// TestAgentSessionPutRejectsOversizedContentAndDraft 单条消息 content 64K 字符 /
// draft 16K 字符上限（P2-G）：超限 400。
func TestAgentSessionPutRejectsOversizedContentAndDraft(t *testing.T) {
	oversizedContent := strings.Repeat("字", 64*1024+1)
	contentBody := strings.Replace(agentSessionTestBody, `"content": "你好"`,
		`"content": "`+oversizedContent+`"`, 1)
	oversizedDraft := strings.Repeat("d", 16*1024+1)
	draftBody := strings.Replace(agentSessionTestBody, `"draft": "未发送草稿"`,
		`"draft": "`+oversizedDraft+`"`, 1)

	for name, body := range map[string]string{
		"content 超限": contentBody,
		"draft 超限":   draftBody,
	} {
		t.Run(name, func(t *testing.T) {
			store := newFakeAgentSessionStore()
			h := newAgentSessionHandlerForTest(store)
			c, rec := newAgentSessionCtx(t, http.MethodPut, body, 1, "sess_too_large_1")
			if err := h.Put(c); err != nil {
				t.Fatalf("Put error: %v", err)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%.200s)", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "超过上限") {
				t.Fatalf("limit message missing, body=%.200s", rec.Body.String())
			}
			if len(store.sessions) != 0 {
				t.Fatalf("oversized payload must not be persisted, sessions=%d", len(store.sessions))
			}
		})
	}

	// 边界：恰好 64K 字符 content 必须放行。
	boundaryBody := strings.Replace(agentSessionTestBody, `"content": "你好"`,
		`"content": "`+strings.Repeat("字", 64*1024)+`"`, 1)
	store := newFakeAgentSessionStore()
	h := newAgentSessionHandlerForTest(store)
	c, rec := newAgentSessionCtx(t, http.MethodPut, boundaryBody, 1, "sess_boundary_ok")
	if err := h.Put(c); err != nil {
		t.Fatalf("boundary Put error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("boundary status = %d, want 200 (body=%.200s)", rec.Code, rec.Body.String())
	}
}

func TestAgentSessionLWWConflictReturnsServerVersion(t *testing.T) {
	store := newFakeAgentSessionStore()
	h := newAgentSessionHandlerForTest(store)
	const sid = "sess_lww_conflict"

	// 设备 A：updatedAt=2000ms 版本先落库。
	newer := strings.Replace(agentSessionTestBody, `"updatedAt": 1734000002000`, `"updatedAt": 1734000002000`, 1)
	c, rec := newAgentSessionCtx(t, http.MethodPut, newer, 1, sid)
	if err := h.Put(c); err != nil {
		t.Fatalf("seed Put error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("seed status = %d", rec.Code)
	}

	// 设备 B：携带更旧的 updatedAt → 409 + data=服务端版本（含 messages）。
	stale := strings.Replace(agentSessionTestBody, `"updatedAt": 1734000002000`, `"updatedAt": 1734000001000`, 1)
	stale = strings.Replace(stale, `"往返测试"`, `"过期覆盖"`, 1)
	c, rec = newAgentSessionCtx(t, http.MethodPut, stale, 1, sid)
	if err := h.Put(c); err != nil {
		t.Fatalf("stale Put error: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale put status = %d, want 409 (body=%s)", rec.Code, rec.Body.String())
	}
	r, err := testutil.ParseResponse(rec)
	if err != nil {
		t.Fatalf("parse conflict response: %v", err)
	}
	if r.Code != http.StatusConflict {
		t.Fatalf("conflict business code = %d, want 409", r.Code)
	}
	var server dto.AgentSessionVO
	decodeAgentSessionData(t, rec, &server)
	if server.Title != "往返测试" || server.UpdatedAt != 1734000002000 || len(server.Messages) != 2 {
		t.Fatalf("conflict server version = %+v", server.AgentSessionMetaVO)
	}
	// 库内仍是新版本。
	if store.sessions[sid].Title != "往返测试" || store.sessions[sid].ClientUpdatedAt != 1734000002000 {
		t.Fatalf("store must keep newer version, got %+v", store.sessions[sid])
	}

	// 同一 updatedAt 重放（幂等重试）应被接受。
	c, rec = newAgentSessionCtx(t, http.MethodPut, agentSessionTestBody, 1, sid)
	if err := h.Put(c); err != nil {
		t.Fatalf("replay Put error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("equal-timestamp replay status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
}
