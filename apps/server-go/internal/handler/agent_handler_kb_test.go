package handler

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type fakeAgentKBService struct {
	userContext *service.KBUserContext
	buildErr    error
	filtered    []int64
	pickerRows  []dto.AgentKnowledgeBaseVO
	pickerErr   error

	buildCalls  int
	filterCalls int
	pickerCalls int
	filterInput []int64
}

func (f *fakeAgentKBService) BuildUserContext(_ context.Context, userID int64, legacyRole string) (*service.KBUserContext, error) {
	f.buildCalls++
	if f.buildErr != nil {
		return nil, f.buildErr
	}
	if f.userContext != nil {
		return f.userContext, nil
	}
	return &service.KBUserContext{UserID: userID, Role: legacyRole}, nil
}

func (f *fakeAgentKBService) FilterAuthorizedKBIDs(_ context.Context, ids []int64, _ *service.KBUserContext) []int64 {
	f.filterCalls++
	f.filterInput = append([]int64(nil), ids...)
	if f.filtered != nil {
		return f.filtered
	}
	return ids
}

func (f *fakeAgentKBService) ListForPicker(_ context.Context, _ *service.KBUserContext, keyword string) ([]dto.AgentKnowledgeBaseVO, error) {
	f.pickerCalls++
	if keyword != "" {
		return nil, errors.New("unexpected keyword")
	}
	if f.pickerErr != nil {
		return nil, f.pickerErr
	}
	return f.pickerRows, nil
}

func TestAgentHandlerFilterBodyKBIDsAutoInjectsUsableKnowledgeBases(t *testing.T) {
	profile := dto.KBProfileVO{ID: 21, KBID: 2, Code: "active", Status: model.KBProfileStatusActive}
	fakeKB := &fakeAgentKBService{
		pickerRows: []dto.AgentKnowledgeBaseVO{
			{ID: 1, Kind: model.KBKindSystemPosts, Name: "博客文章"},
			{ID: 2, Kind: model.KBKindCustom, Name: "产品知识库", ActiveProfile: &profile, ChunkCount: 8},
			{ID: 3, Kind: model.KBKindCustom, Name: "尚未向量化", ActiveProfile: &profile, ChunkCount: 0},
			{ID: 4, Kind: model.KBKindCustom, Name: "无 active profile", ChunkCount: 5},
		},
	}
	h := &AgentHandler{kbSvc: fakeKB}

	body, err := h.filterBodyKBIDs(t.Context(), []byte(`{"messages":[]}`), 7, "user")
	if err != nil {
		t.Fatalf("filterBodyKBIDs returned error: %v", err)
	}
	if body == nil {
		t.Fatal("filterBodyKBIDs returned nil body, want auto kbIds rewrite")
	}

	var out struct {
		KBIDs []int64 `json:"kbIds"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("parse rewritten body: %v", err)
	}
	if want := []int64{1, 2}; !reflect.DeepEqual(out.KBIDs, want) {
		t.Fatalf("kbIds = %#v, want %#v", out.KBIDs, want)
	}
	if fakeKB.buildCalls != 1 || fakeKB.pickerCalls != 1 || fakeKB.filterCalls != 0 {
		t.Fatalf("calls = build:%d picker:%d filter:%d, want 1/1/0", fakeKB.buildCalls, fakeKB.pickerCalls, fakeKB.filterCalls)
	}
}

func TestAgentHandlerFilterBodyKBIDsKeepsExplicitNullSelection(t *testing.T) {
	fakeKB := &fakeAgentKBService{
		pickerRows: []dto.AgentKnowledgeBaseVO{
			{ID: 1, Kind: model.KBKindSystemPosts, Name: "博客文章"},
		},
	}
	h := &AgentHandler{kbSvc: fakeKB}

	body, err := h.filterBodyKBIDs(t.Context(), []byte(`{"messages":[],"kbIds":null}`), 7, "user")
	if err != nil {
		t.Fatalf("filterBodyKBIDs returned error: %v", err)
	}
	if body != nil {
		t.Fatalf("filterBodyKBIDs returned %s, want nil body for explicit null kbIds", string(body))
	}
	if fakeKB.buildCalls != 0 || fakeKB.pickerCalls != 0 || fakeKB.filterCalls != 0 {
		t.Fatalf("calls = build:%d picker:%d filter:%d, want 0/0/0", fakeKB.buildCalls, fakeKB.pickerCalls, fakeKB.filterCalls)
	}
}

func TestAgentHandlerFilterBodyKBIDsKeepsExplicitEmptySelection(t *testing.T) {
	fakeKB := &fakeAgentKBService{
		pickerRows: []dto.AgentKnowledgeBaseVO{
			{ID: 1, Kind: model.KBKindSystemPosts, Name: "博客文章"},
		},
	}
	h := &AgentHandler{kbSvc: fakeKB}

	body, err := h.filterBodyKBIDs(t.Context(), []byte(`{"messages":[],"kbIds":[]}`), 7, "user")
	if err != nil {
		t.Fatalf("filterBodyKBIDs returned error: %v", err)
	}
	if body != nil {
		t.Fatalf("filterBodyKBIDs returned %s, want nil body for explicit empty kbIds", string(body))
	}
	if fakeKB.buildCalls != 0 || fakeKB.pickerCalls != 0 || fakeKB.filterCalls != 0 {
		t.Fatalf("calls = build:%d picker:%d filter:%d, want 0/0/0", fakeKB.buildCalls, fakeKB.pickerCalls, fakeKB.filterCalls)
	}
}

func TestAgentHandlerFilterBodyKBIDsFiltersExplicitIDsWithoutAutoPicker(t *testing.T) {
	fakeKB := &fakeAgentKBService{filtered: []int64{2}}
	h := &AgentHandler{kbSvc: fakeKB}

	body, err := h.filterBodyKBIDs(t.Context(), []byte(`{"messages":[],"kbIds":[1,2]}`), 7, "user")
	if err != nil {
		t.Fatalf("filterBodyKBIDs returned error: %v", err)
	}
	if body == nil {
		t.Fatal("filterBodyKBIDs returned nil body, want filtered rewrite")
	}

	var out struct {
		KBIDs []int64 `json:"kbIds"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("parse rewritten body: %v", err)
	}
	if want := []int64{2}; !reflect.DeepEqual(out.KBIDs, want) {
		t.Fatalf("kbIds = %#v, want %#v", out.KBIDs, want)
	}
	if fakeKB.pickerCalls != 0 {
		t.Fatalf("pickerCalls = %d, want 0 for explicit kbIds", fakeKB.pickerCalls)
	}
	if !reflect.DeepEqual(fakeKB.filterInput, []int64{1, 2}) {
		t.Fatalf("filterInput = %#v, want [1 2]", fakeKB.filterInput)
	}
}

func TestAgentHandlerFilterBodyKBIDsRejectsInvalidKBIDs(t *testing.T) {
	h := &AgentHandler{kbSvc: &fakeAgentKBService{}}

	_, err := h.filterBodyKBIDs(t.Context(), []byte(`{"messages":[],"kbIds":"not-array"}`), 7, "user")
	if err == nil {
		t.Fatal("filterBodyKBIDs returned nil error for invalid kbIds")
	}
	if got := err.Error(); got == "" || !strings.Contains(got, "parse kbIds") {
		t.Fatalf("error = %v, want parse kbIds", err)
	}
}

func TestAgentHandlerFilterBodyKBIDsRejectsNullChatBody(t *testing.T) {
	fakeKB := &fakeAgentKBService{
		pickerRows: []dto.AgentKnowledgeBaseVO{
			{ID: 1, Kind: model.KBKindSystemPosts, Name: "博客文章"},
		},
	}
	h := &AgentHandler{kbSvc: fakeKB}

	_, err := h.filterBodyKBIDs(t.Context(), []byte(`null`), 7, "user")
	if err == nil {
		t.Fatal("filterBodyKBIDs returned nil error for null chat body")
	}
	if got := err.Error(); got == "" || !strings.Contains(got, "expected JSON object") {
		t.Fatalf("error = %v, want expected JSON object", err)
	}
	if fakeKB.buildCalls != 0 || fakeKB.pickerCalls != 0 || fakeKB.filterCalls != 0 {
		t.Fatalf("calls = build:%d picker:%d filter:%d, want 0/0/0", fakeKB.buildCalls, fakeKB.pickerCalls, fakeKB.filterCalls)
	}
}
