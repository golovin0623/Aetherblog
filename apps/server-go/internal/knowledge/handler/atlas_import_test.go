package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestKPHandlerMountsAtlasImportRoute(t *testing.T) {
	e := echo.New()
	h := &KPHandler{}
	h.Mount(e.Group("/atlas"), func(next echo.HandlerFunc) echo.HandlerFunc { return next })

	for _, route := range e.Routes() {
		if route.Method == http.MethodPost && route.Path == "/atlas/import" {
			return
		}
	}
	t.Fatalf("POST /atlas/import route was not mounted")
}

func TestParseObsidianMarkdownImport(t *testing.T) {
	content := "# Source Claim\n\nThis claim cites [[Target Concept]] and keeps body text.\n\n## Target Concept\n\nTarget body."

	parsed := parseObsidianMarkdownImport(content, "source")

	if len(parsed.KnowledgePoints) != 2 {
		t.Fatalf("expected 2 knowledge points, got %d: %#v", len(parsed.KnowledgePoints), parsed.KnowledgePoints)
	}
	if got := parsed.KnowledgePoints[0].Title; got != "Source Claim" {
		t.Fatalf("unexpected first KP title: %q", got)
	}
	if got := parsed.KnowledgePoints[0].BodyMarkdown; got != "This claim cites [[Target Concept]] and keeps body text." {
		t.Fatalf("unexpected first KP body: %q", got)
	}
	if parsed.KnowledgePoints[0].StartOffset != 0 || parsed.KnowledgePoints[0].EndOffset <= parsed.KnowledgePoints[0].StartOffset {
		t.Fatalf("unexpected source offsets: %#v", parsed.KnowledgePoints[0])
	}
	if len(parsed.Relations) != 1 {
		t.Fatalf("expected 1 relation, got %d: %#v", len(parsed.Relations), parsed.Relations)
	}
	rel := parsed.Relations[0]
	if rel.FromIndex != 0 || rel.ToIndex != 1 || rel.Type != "cites" {
		t.Fatalf("unexpected wiki-link relation: %#v", rel)
	}
	if len(parsed.Warnings) != 0 {
		t.Fatalf("expected no warnings, got %#v", parsed.Warnings)
	}
}

func TestParseObsidianMarkdownImportFallsBackToSingleNote(t *testing.T) {
	parsed := parseObsidianMarkdownImport("Loose note body with no heading.", "concept")

	if len(parsed.KnowledgePoints) != 1 {
		t.Fatalf("expected fallback KP, got %d", len(parsed.KnowledgePoints))
	}
	if parsed.KnowledgePoints[0].Title != "Imported Markdown" {
		t.Fatalf("unexpected fallback title: %q", parsed.KnowledgePoints[0].Title)
	}
	if parsed.KnowledgePoints[0].Type != "concept" {
		t.Fatalf("unexpected fallback type: %q", parsed.KnowledgePoints[0].Type)
	}
}

func TestParseReadwiseCSVImport(t *testing.T) {
	content := strings.Join([]string{
		`Book Title,Book Author,Text,Highlight Note,Source URL,Location Type,Location`,
		`Designing Data-Intensive Applications,Martin Kleppmann,"Reliable systems need explicit tradeoffs.","Use in architecture note.",https://readwise.io/bookreview,Page,42`,
		`Designing Data-Intensive Applications,Martin Kleppmann,"Batch and stream processing often converge.",,https://readwise.io/bookreview,Page,319`,
	}, "\n")

	parsed := parseReadwiseCSVImport(content, "claim")

	if len(parsed.KnowledgePoints) != 2 {
		t.Fatalf("expected 2 imported highlights, got %d: %#v", len(parsed.KnowledgePoints), parsed.KnowledgePoints)
	}
	if parsed.SourceMarkdown == "" {
		t.Fatalf("expected generated source markdown")
	}
	for _, want := range []string{
		"# Readwise Import",
		"## Designing Data-Intensive Applications - Highlight 1",
		"> Reliable systems need explicit tradeoffs.",
		"- Note: Use in architecture note.",
		"- URL: https://readwise.io/bookreview",
		"- Location: Page 42",
	} {
		if !strings.Contains(parsed.SourceMarkdown, want) {
			t.Fatalf("source markdown missing %q\n%s", want, parsed.SourceMarkdown)
		}
	}
	first := parsed.KnowledgePoints[0]
	if first.Title != "Designing Data-Intensive Applications - Reliable systems need explicit tradeoffs." {
		t.Fatalf("unexpected first title: %q", first.Title)
	}
	if first.Type != "claim" {
		t.Fatalf("unexpected first type: %q", first.Type)
	}
	if first.StartOffset <= 0 || first.EndOffset <= first.StartOffset || first.EndOffset > len(parsed.SourceMarkdown) {
		t.Fatalf("unexpected offsets for generated source markdown: %#v", first)
	}
	if !strings.Contains(first.BodyMarkdown, "> Reliable systems need explicit tradeoffs.") {
		t.Fatalf("unexpected first body: %q", first.BodyMarkdown)
	}
	if !strings.Contains(first.BodyMarkdown, "Author: Martin Kleppmann") {
		t.Fatalf("expected author metadata in first body: %q", first.BodyMarkdown)
	}
	if len(parsed.Relations) != 0 {
		t.Fatalf("expected Readwise import to avoid invented relations, got %#v", parsed.Relations)
	}
}
