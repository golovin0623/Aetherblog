package handler

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

type fakeAtlasReadChecker struct {
	ok     bool
	err    error
	called bool
}

func (f *fakeAtlasReadChecker) UserHasPermission(_ context.Context, _ int64, _ string, permissionCode string) (bool, error) {
	f.called = true
	if permissionCode != "content.atlas.read" {
		return false, errors.New("unexpected permission code")
	}
	return f.ok, f.err
}

func TestAgentHandlerFilterBodyAtlasScopeRequiresReadPermission(t *testing.T) {
	checker := &fakeAtlasReadChecker{ok: false}
	h := &AgentHandler{atlasPerm: checker}

	_, err := h.filterBodyAtlasScope(context.Background(), []byte(`{"messages":[],"atlasScope":{"kpIds":[1]}}`), 7, "AUTHOR")
	if !errors.Is(err, errAgentAtlasReadDenied) {
		t.Fatalf("error = %v, want errAgentAtlasReadDenied", err)
	}
	if !checker.called {
		t.Fatal("atlas permission checker was not called")
	}
}

func TestAgentHandlerFilterBodyAtlasScopeSkipsWhenScopeAbsent(t *testing.T) {
	checker := &fakeAtlasReadChecker{ok: false}
	h := &AgentHandler{atlasPerm: checker}

	body, err := h.filterBodyAtlasScope(context.Background(), []byte(`{"messages":[]}`), 7, "AUTHOR")
	if err != nil {
		t.Fatalf("filterBodyAtlasScope returned error: %v", err)
	}
	if body != nil {
		t.Fatalf("body = %s, want nil rewrite", body)
	}
	if checker.called {
		t.Fatal("atlas permission checker was called without atlasScope")
	}
}

func TestAgentHandlerFilterBodyAtlasScopeDropsAutomaticScopeWithoutPermission(t *testing.T) {
	checker := &fakeAtlasReadChecker{ok: false}
	h := &AgentHandler{atlasPerm: checker}

	body, err := h.filterBodyAtlasScope(
		context.Background(),
		[]byte(`{"messages":[{"role":"user","content":"hello"}],"atlasScope":{"kpIds":[],"carrierIds":[],"semanticRecall":true}}`),
		7,
		"AUTHOR",
	)
	if err != nil {
		t.Fatalf("filterBodyAtlasScope returned error: %v", err)
	}
	if body == nil {
		t.Fatal("body = nil, want rewrite without automatic atlasScope")
	}
	if !checker.called {
		t.Fatal("atlas permission checker was not called")
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("rewritten body is invalid JSON: %v", err)
	}
	if _, exists := raw["atlasScope"]; exists {
		t.Fatalf("rewritten body still contains atlasScope: %s", body)
	}
	if _, exists := raw["messages"]; !exists {
		t.Fatalf("rewritten body lost messages: %s", body)
	}
}

func TestAgentHandlerFilterBodyAtlasScopeStillRejectsExplicitSelectionWithoutPermission(t *testing.T) {
	for _, body := range []string{
		`{"messages":[],"atlasScope":{"kpIds":[1],"carrierIds":[],"semanticRecall":true}}`,
		`{"messages":[],"atlasScope":{"kpIds":[],"carrierIds":[2],"semanticRecall":true}}`,
	} {
		checker := &fakeAtlasReadChecker{ok: false}
		h := &AgentHandler{atlasPerm: checker}

		_, err := h.filterBodyAtlasScope(context.Background(), []byte(body), 7, "AUTHOR")
		if !errors.Is(err, errAgentAtlasReadDenied) {
			t.Fatalf("error = %v, want errAgentAtlasReadDenied for %s", err, body)
		}
	}
}
