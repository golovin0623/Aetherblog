package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/labstack/echo/v4"
)

func decodeAgentContextBody(t *testing.T, body []byte) map[string]json.RawMessage {
	t.Helper()
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("decode normalized body: %v", err)
	}
	return raw
}

func TestNormalizeAgentKnowledgeContextBodyValidatesExplicitModes(t *testing.T) {
	tests := []struct {
		name          string
		body          string
		wantMode      dto.AgentKnowledgeContextMode
		wantKBJSON    string
		wantAtlasJSON string
		wantKBRefs    bool
		wantAtlasRefs bool
	}{
		{
			name:          "auto keeps discovery fields empty for later permission injection",
			body:          `{"messages":[],"knowledgeContextMode":"auto","atlasScope":{"kpIds":[],"carrierIds":[],"semanticRecall":true}}`,
			wantMode:      dto.AgentKnowledgeContextModeAuto,
			wantAtlasJSON: `{"kpIds":[],"carrierIds":[],"semanticRecall":true}`,
		},
		{
			name:          "none carries explicit null sentinels",
			body:          `{"messages":[],"knowledgeContextMode":"none","kbIds":null,"atlasScope":null}`,
			wantMode:      dto.AgentKnowledgeContextModeNone,
			wantKBJSON:    `null`,
			wantAtlasJSON: `null`,
		},
		{
			name:          "selected kb prevents atlas fallback",
			body:          `{"messages":[],"knowledgeContextMode":"selected","kbIds":[7]}`,
			wantMode:      dto.AgentKnowledgeContextModeSelected,
			wantKBJSON:    `[7]`,
			wantAtlasJSON: `null`,
			wantKBRefs:    true,
		},
		{
			name:          "selected atlas prevents automatic kb injection",
			body:          `{"messages":[],"knowledgeContextMode":"selected","atlasScope":{"kpIds":[9],"carrierIds":[]}}`,
			wantMode:      dto.AgentKnowledgeContextModeSelected,
			wantKBJSON:    `null`,
			wantAtlasJSON: `{"carrierIds":[],"kpIds":[9],"neighborhoodDepth":0,"semanticRecall":false}`,
			wantAtlasRefs: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			normalized, err := normalizeAgentKnowledgeContextBody([]byte(tc.body))
			if err != nil {
				t.Fatalf("normalize returned error: %v", err)
			}
			if normalized.Mode != tc.wantMode {
				t.Fatalf("mode = %q, want %q", normalized.Mode, tc.wantMode)
			}
			if normalized.HasKnowledgeBaseRefs != tc.wantKBRefs || normalized.HasAtlasRefs != tc.wantAtlasRefs {
				t.Fatalf(
					"refs = kb:%v atlas:%v, want kb:%v atlas:%v",
					normalized.HasKnowledgeBaseRefs,
					normalized.HasAtlasRefs,
					tc.wantKBRefs,
					tc.wantAtlasRefs,
				)
			}

			raw := decodeAgentContextBody(t, normalized.Body)
			if string(raw["knowledgeContextMode"]) != `"`+string(tc.wantMode)+`"` {
				t.Fatalf("knowledgeContextMode = %s", raw["knowledgeContextMode"])
			}
			if tc.wantKBJSON != "" && string(raw["kbIds"]) != tc.wantKBJSON {
				t.Fatalf("kbIds = %s, want %s", raw["kbIds"], tc.wantKBJSON)
			}
			if tc.wantAtlasJSON != "" && string(raw["atlasScope"]) != tc.wantAtlasJSON {
				t.Fatalf("atlasScope = %s, want %s", raw["atlasScope"], tc.wantAtlasJSON)
			}
		})
	}
}

func TestNormalizeAgentKnowledgeContextBodyRejectsContradictoryModes(t *testing.T) {
	for _, body := range []string{
		`{"messages":[],"knowledgeContextMode":"invalid"}`,
		`{"messages":[],"knowledgeContextMode":"selected","kbIds":null,"atlasScope":null}`,
		`{"messages":[],"knowledgeContextMode":"none","kbIds":[7],"atlasScope":null}`,
		`{"messages":[],"knowledgeContextMode":"auto","kbIds":[7]}`,
		`{"messages":[],"knowledgeContextMode":"selected","atlasScope":{"kpIds":[],"carrierIds":[],"semanticRecall":true}}`,
	} {
		if normalized, err := normalizeAgentKnowledgeContextBody([]byte(body)); err == nil {
			t.Fatalf("normalize(%s) = %#v, want error", body, normalized)
		}
	}
}

func TestNormalizeAgentKnowledgeContextBodyInfersLegacyModesConservatively(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantMode dto.AgentKnowledgeContextMode
	}{
		{name: "omitted context remains automatic", body: `{"messages":[]}`, wantMode: dto.AgentKnowledgeContextModeAuto},
		{name: "old explicit opt out remains none", body: `{"messages":[],"kbIds":null,"atlasScope":null}`, wantMode: dto.AgentKnowledgeContextModeNone},
		{name: "old explicit kb selection becomes selected", body: `{"messages":[],"kbIds":[7]}`, wantMode: dto.AgentKnowledgeContextModeSelected},
		{name: "old automatic atlas scope remains auto", body: `{"messages":[],"atlasScope":{"kpIds":[],"carrierIds":[],"semanticRecall":true}}`, wantMode: dto.AgentKnowledgeContextModeAuto},
		{name: "ambiguous empty atlas scope fails toward none", body: `{"messages":[],"atlasScope":{"kpIds":[],"carrierIds":[],"semanticRecall":false}}`, wantMode: dto.AgentKnowledgeContextModeNone},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			normalized, err := normalizeAgentKnowledgeContextBody([]byte(tc.body))
			if err != nil {
				t.Fatalf("normalize returned error: %v", err)
			}
			if normalized.Mode != tc.wantMode {
				t.Fatalf("mode = %q, want %q", normalized.Mode, tc.wantMode)
			}
			if !normalized.LegacyInferred {
				t.Fatal("LegacyInferred = false, want true")
			}
		})
	}
}

func TestNormalizedAutoModeUsesOnlyPermissionScopedKBInjection(t *testing.T) {
	fakeKB := &fakeAgentKBService{
		pickerRows: []dto.AgentKnowledgeBaseVO{
			{ID: 3, Kind: "SYSTEM_POSTS", Name: "博客文章"},
		},
	}
	h := &AgentHandler{kbSvc: fakeKB}
	normalized, err := normalizeAgentKnowledgeContextBody(
		[]byte(`{"messages":[],"knowledgeContextMode":"auto","atlasScope":{"kpIds":[],"carrierIds":[],"semanticRecall":true}}`),
	)
	if err != nil {
		t.Fatalf("normalize returned error: %v", err)
	}
	filtered, err := h.filterBodyKBIDs(t.Context(), normalized.Body, 7, "AUTHOR")
	if err != nil {
		t.Fatalf("filterBodyKBIDs returned error: %v", err)
	}
	if filtered == nil {
		t.Fatal("auto mode did not inject the permission-scoped KB list")
	}
	raw := decodeAgentContextBody(t, filtered)
	if string(raw["knowledgeContextMode"]) != `"auto"` {
		t.Fatalf("knowledgeContextMode = %s, want auto", raw["knowledgeContextMode"])
	}
	if string(raw["kbIds"]) != `[3]` {
		t.Fatalf("kbIds = %s, want [3]", raw["kbIds"])
	}
	if fakeKB.buildCalls != 1 || fakeKB.pickerCalls != 1 || fakeKB.filterCalls != 0 {
		t.Fatalf("calls = build:%d picker:%d filter:%d, want 1/1/0", fakeKB.buildCalls, fakeKB.pickerCalls, fakeKB.filterCalls)
	}
}

func TestNormalizedNonAutoModesNeverTriggerAutomaticKBInjection(t *testing.T) {
	for _, body := range []string{
		`{"messages":[],"knowledgeContextMode":"none"}`,
		`{"messages":[],"knowledgeContextMode":"selected","atlasScope":{"kpIds":[9]}}`,
	} {
		fakeKB := &fakeAgentKBService{
			pickerRows: []dto.AgentKnowledgeBaseVO{{ID: 3, Kind: "SYSTEM_POSTS", Name: "博客文章"}},
		}
		h := &AgentHandler{kbSvc: fakeKB}
		normalized, err := normalizeAgentKnowledgeContextBody([]byte(body))
		if err != nil {
			t.Fatalf("normalize(%s) returned error: %v", body, err)
		}
		filtered, err := h.filterBodyKBIDs(t.Context(), normalized.Body, 7, "AUTHOR")
		if err != nil {
			t.Fatalf("filterBodyKBIDs(%s) returned error: %v", body, err)
		}
		if filtered != nil {
			t.Fatalf("filterBodyKBIDs(%s) rewrote body to %s", body, filtered)
		}
		if fakeKB.buildCalls != 0 || fakeKB.pickerCalls != 0 || fakeKB.filterCalls != 0 {
			t.Fatalf(
				"mode %q called KB discovery: build:%d picker:%d filter:%d",
				normalized.Mode,
				fakeKB.buildCalls,
				fakeKB.pickerCalls,
				fakeKB.filterCalls,
			)
		}
	}
}

func TestAgentHandlerChatFailsClosedWhenSelectedKBPermissionServiceIsUnavailable(t *testing.T) {
	h := &AgentHandler{internalToken: "test-internal-token"}
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/agent/chat",
		strings.NewReader(`{"messages":[],"knowledgeContextMode":"selected","kbIds":[7]}`),
	)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "AUTHOR"})

	if err := h.Chat(c); err != nil {
		t.Fatalf("Chat returned error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("HTTP status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	var out response.R
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("parse response: %v", err)
	}
	if out.Message != "无法使用所选知识库" {
		t.Fatalf("message = %q, want opaque permission failure", out.Message)
	}
}

func TestAgentHandlerChatFailsClosedWhenSelectedAtlasPermissionServiceIsUnavailable(t *testing.T) {
	h := &AgentHandler{internalToken: "test-internal-token"}
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/agent/chat",
		strings.NewReader(`{"messages":[],"knowledgeContextMode":"selected","atlasScope":{"kpIds":[9]}}`),
	)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "AUTHOR"})

	if err := h.Chat(c); err != nil {
		t.Fatalf("Chat returned error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("HTTP status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	var out response.R
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("parse response: %v", err)
	}
	if out.Message != "无权使用 Atlas 上下文" {
		t.Fatalf("message = %q, want opaque Atlas permission failure", out.Message)
	}
}

func TestAgentHandlerChatRejectsInvalidKnowledgeContextModeBeforeProxying(t *testing.T) {
	h := &AgentHandler{internalToken: "test-internal-token"}
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/agent/chat",
		strings.NewReader(`{"messages":[],"knowledgeContextMode":"none","kbIds":[7]}`),
	)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "AUTHOR"})

	if err := h.Chat(c); err != nil {
		t.Fatalf("Chat returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("HTTP status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
