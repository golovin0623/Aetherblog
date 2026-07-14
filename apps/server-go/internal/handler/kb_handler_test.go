package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type fakeKBRetrieveAccess struct {
	permission string
	err        error
}

func (f fakeKBRetrieveAccess) BuildUserContext(_ context.Context, userID int64, role string) (*service.KBUserContext, error) {
	return &service.KBUserContext{UserID: userID, Role: role}, nil
}

func (f fakeKBRetrieveAccess) GetByIDForUser(_ context.Context, id int64, _ *service.KBUserContext) (*dto.KnowledgeBaseVO, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &dto.KnowledgeBaseVO{ID: id, EffectivePermission: f.permission}, nil
}

type fakeKBRetriever struct {
	called  bool
	kbID    int64
	payload service.KBRetrievePayload
	result  *dto.KBRetrieveResponse
	err     error
}

func (f *fakeKBRetriever) Retrieve(_ context.Context, kbID int64, payload service.KBRetrievePayload) (*dto.KBRetrieveResponse, error) {
	f.called = true
	f.kbID = kbID
	f.payload = payload
	return f.result, f.err
}

func newKBRetrieveContext(t *testing.T, body string) (echo.Context, *httptest.ResponseRecorder) {
	t.Helper()
	e := testutil.NewEcho()
	req := httptest.NewRequest(http.MethodPost, "/v1/admin/kbs/7/retrieve", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetPath("/v1/admin/kbs/:id/retrieve")
	c.SetParamNames("id")
	c.SetParamValues("7")
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 9, Role: "USER"})
	return c, rec
}

func TestKBRetrieveRequiresUsePermissionAndDoesNotLeakExistence(t *testing.T) {
	for _, tc := range []struct {
		name   string
		access fakeKBRetrieveAccess
	}{
		{name: "view cannot retrieve", access: fakeKBRetrieveAccess{permission: "VIEW"}},
		{name: "missing is indistinguishable", access: fakeKBRetrieveAccess{err: service.ErrKBNotFound}},
		{name: "forbidden is indistinguishable", access: fakeKBRetrieveAccess{err: service.ErrKBPermission}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := &fakeKBRetriever{}
			h := &KBHandler{retrieveAccess: tc.access, retriever: upstream}
			c, rec := newKBRetrieveContext(t, `{"query":"退款规则是什么？","limit":5}`)

			if err := h.Retrieve(c); err != nil {
				t.Fatalf("Retrieve error: %v", err)
			}
			if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "无权使用该知识库进行检索") {
				t.Fatalf("status/body = %d %s", rec.Code, rec.Body.String())
			}
			if upstream.called {
				t.Fatal("upstream must not be called")
			}
		})
	}
}

func TestKBRetrieveAllowsUseAndTurnsUpstreamFailureIntoUnavailable(t *testing.T) {
	upstream := &fakeKBRetriever{err: errors.New("internal host secret")}
	h := &KBHandler{retrieveAccess: fakeKBRetrieveAccess{permission: "USE"}, retriever: upstream}
	c, rec := newKBRetrieveContext(t, `{"query":"退款规则是什么？","limit":5}`)

	if err := h.Retrieve(c); err != nil {
		t.Fatalf("Retrieve error: %v", err)
	}
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"unavailable"`) {
		t.Fatalf("status/body = %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "internal host secret") {
		t.Fatalf("response leaked upstream error: %s", rec.Body.String())
	}
}

func TestKBRetrieveForwardsOnlyAuthorizedPathKBAndBoundedRequest(t *testing.T) {
	upstream := &fakeKBRetriever{result: &dto.KBRetrieveResponse{
		Status: "empty", Query: "退款规则是什么？", Hits: []dto.KBRetrieveHit{},
	}}
	h := &KBHandler{retrieveAccess: fakeKBRetrieveAccess{permission: "EDIT"}, retriever: upstream}
	c, rec := newKBRetrieveContext(t, `{"query":" 退款规则是什么？ ","limit":3}`)

	if err := h.Retrieve(c); err != nil {
		t.Fatalf("Retrieve error: %v", err)
	}
	if rec.Code != http.StatusOK || !upstream.called {
		t.Fatalf("status=%d called=%v body=%s", rec.Code, upstream.called, rec.Body.String())
	}
	if upstream.kbID != 7 || upstream.payload.Query != "退款规则是什么？" || upstream.payload.Limit != 3 {
		t.Fatalf("kbID=%d payload=%+v", upstream.kbID, upstream.payload)
	}
}

func TestKBRetrieveValidatesQueryAndLimitBeforeCallingUpstream(t *testing.T) {
	for _, body := range []string{
		`{"query":" ","limit":5}`,
		`{"query":"valid question","limit":11}`,
	} {
		upstream := &fakeKBRetriever{}
		h := &KBHandler{retrieveAccess: fakeKBRetrieveAccess{permission: "USE"}, retriever: upstream}
		c, rec := newKBRetrieveContext(t, body)

		if err := h.Retrieve(c); err != nil {
			t.Fatalf("Retrieve error: %v", err)
		}
		if rec.Code != http.StatusBadRequest || upstream.called {
			t.Fatalf("status=%d called=%v body=%s", rec.Code, upstream.called, rec.Body.String())
		}
	}
}

func TestKBHandlerHandleSvcErrMapsProfileBadConfigToBadRequest(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/kbs/1/profiles/2", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	h := &KBHandler{}

	err := h.handleSvcErr(
		c,
		fmt.Errorf("%w: chunk_overlap_tokens (512) 必须小于 chunk_size_tokens (512)", service.ErrKBProfileBadConfig),
	)
	if err != nil {
		t.Fatalf("handleSvcErr returned error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "chunk_overlap_tokens") {
		t.Fatalf("response should include validation detail, body=%s", rec.Body.String())
	}
}
