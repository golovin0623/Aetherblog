package handler

import (
	"context"
	"testing"
	"time"

	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
)

func TestAtlasSearchKnowledgePointsOrdersSemanticHitsFirst(t *testing.T) {
	now := time.Now()
	keywordRows := []atlasmodel.KnowledgePoint{
		{
			ID:           1,
			UUID:         "kp-1",
			Title:        "Keyword first",
			Type:         "claim",
			Confidence:   0.7,
			Status:       "seed",
			Provenance:   "user",
			CreatedAt:    now,
			UpdatedAt:    now,
			BodyMarkdown: "keyword body",
		},
		{
			ID:           2,
			UUID:         "kp-2",
			Title:        "Semantic first",
			Type:         "concept",
			Confidence:   0.8,
			Status:       "evergreen",
			Provenance:   "user",
			CreatedAt:    now,
			UpdatedAt:    now,
			BodyMarkdown: "semantic body",
		},
	}
	scoreOne := 0.71
	scoreTwo := 0.93

	got, err := (&KPHandler{}).toSearchKnowledgePoints(
		context.Background(),
		&atlasScope{CanAdmin: true},
		keywordRows,
		[]atlassvc.AtlasSemanticKnowledgePointHit{
			{ID: 2, Similarity: &scoreTwo, RecallSource: "semantic"},
			{ID: 1, Similarity: &scoreOne, RecallSource: "semantic"},
		},
		true,
		10,
	)
	if err != nil {
		t.Fatalf("toSearchKnowledgePoints returned error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].ID != 2 || got[1].ID != 1 {
		t.Fatalf("order = [%d %d], want [2 1]", got[0].ID, got[1].ID)
	}
	if got[0].SearchSource != "keyword_semantic" || got[0].SearchScore == nil || *got[0].SearchScore != scoreTwo {
		t.Fatalf("first search metadata = source %q score %#v", got[0].SearchSource, got[0].SearchScore)
	}
}

func TestAtlasSearchKnowledgePointsKeepsKeywordOrderWhenSemanticUnavailable(t *testing.T) {
	now := time.Now()
	keywordRows := []atlasmodel.KnowledgePoint{
		{ID: 1, UUID: "kp-1", Title: "One", Type: "claim", Status: "seed", Provenance: "user", CreatedAt: now, UpdatedAt: now},
		{ID: 2, UUID: "kp-2", Title: "Two", Type: "claim", Status: "seed", Provenance: "user", CreatedAt: now, UpdatedAt: now},
	}

	got, err := (&KPHandler{}).toSearchKnowledgePoints(
		context.Background(),
		&atlasScope{CanAdmin: true},
		keywordRows,
		nil,
		false,
		10,
	)
	if err != nil {
		t.Fatalf("toSearchKnowledgePoints returned error: %v", err)
	}
	if got[0].ID != 1 || got[1].ID != 2 {
		t.Fatalf("order = [%d %d], want [1 2]", got[0].ID, got[1].ID)
	}
	if got[0].SearchSource != "keyword" || got[0].SearchScore != nil {
		t.Fatalf("keyword metadata = source %q score %#v", got[0].SearchSource, got[0].SearchScore)
	}
}
