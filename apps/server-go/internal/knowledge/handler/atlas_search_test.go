package handler

import (
	"context"
	"testing"
	"time"

	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	atlasrepo "github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
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

func TestAtlasSearchEvidencePreviewUsesTextQuoteSelector(t *testing.T) {
	note := "review note for this evidence"
	got := toSearchEvidencePreview(
		&atlasmodel.Annotation{
			ID:        7,
			CarrierID: 3,
			Selectors: []byte(`[
				{"type":"TextPositionSelector","start":10,"end":32},
				{"type":"TextQuoteSelector","exact":"Atlas evidence quote"},
				{"type":"FragmentSelector","value":"page=1"}
			]`),
			BodyText: &note,
		},
		&atlasmodel.Carrier{ID: 3, Type: "blog_post", Title: "Draft post"},
	)
	if got == nil {
		t.Fatal("preview = nil, want evidence preview")
	}
	if got.AnnotationID != 7 || got.CarrierID != 3 || got.CarrierType != "blog_post" || got.CarrierTitle != "Draft post" {
		t.Fatalf("unexpected preview identity: %+v", got)
	}
	if got.Quote != "Atlas evidence quote" {
		t.Fatalf("quote = %q, want TextQuoteSelector exact", got.Quote)
	}
	if got.Note == nil || *got.Note != note {
		t.Fatalf("note = %#v, want %q", got.Note, note)
	}
}

func TestAtlasSearchEvidencePreviewFallsBackToBodyText(t *testing.T) {
	note := "body text fallback"
	got := toSearchEvidencePreview(
		&atlasmodel.Annotation{
			ID:        8,
			CarrierID: 4,
			Selectors: []byte(`[
				{"type":"TextPositionSelector","start":1,"end":5},
				{"type":"FragmentSelector","value":"page=2"}
			]`),
			BodyText: &note,
		},
		&atlasmodel.Carrier{ID: 4, Type: "pdf", Title: "Research PDF"},
	)
	if got == nil {
		t.Fatal("preview = nil, want fallback preview")
	}
	if got.Quote != note {
		t.Fatalf("quote = %q, want bodyText fallback", got.Quote)
	}
	if got.Note != nil {
		t.Fatalf("note = %#v, want nil when note duplicates fallback quote", got.Note)
	}
}

func TestAtlasGraphEvidencePreviewMapUsesSubjectIDs(t *testing.T) {
	note := "extra graph note"
	got := toGraphEvidencePreviewMap([]atlasrepo.EvidencePreviewRow{
		{
			SubjectID:    42,
			AnnotationID: 77,
			CarrierID:    9,
			CarrierType:  "markdown",
			CarrierTitle: "Graph Note",
			Selectors: []byte(`[
				{"type":"TextQuoteSelector","exact":"Graph evidence quote"}
			]`),
			BodyText: &note,
		},
	})
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	preview := got[42]
	if preview == nil {
		t.Fatal("preview for subject 42 = nil")
	}
	if preview.AnnotationID != 77 || preview.CarrierID != 9 {
		t.Fatalf("unexpected preview identity: %+v", preview)
	}
	if preview.Quote != "Graph evidence quote" {
		t.Fatalf("quote = %q, want graph quote", preview.Quote)
	}
	if preview.Note == nil || *preview.Note != note {
		t.Fatalf("note = %#v, want %q", preview.Note, note)
	}
}
