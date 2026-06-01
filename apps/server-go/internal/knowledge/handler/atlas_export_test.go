package handler

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
)

func TestKPHandlerMountsAtlasExportRoute(t *testing.T) {
	e := echo.New()
	h := &KPHandler{}
	h.Mount(e.Group("/atlas"), func(next echo.HandlerFunc) echo.HandlerFunc { return next })

	for _, route := range e.Routes() {
		if route.Method == http.MethodGet && route.Path == "/atlas/export" {
			return
		}
	}
	t.Fatalf("GET /atlas/export route was not mounted")
}

func TestBuildAtlasGraphML(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	body := "Evidence <quote> & note"
	graph := atlasdto.GraphResponse{
		Nodes: []atlasdto.KnowledgePointResponse{
			{
				ID:           1,
				UUID:         "kp-1",
				Title:        "Typed <claim> & graph",
				BodyMarkdown: "Body should be escaped & exported",
				Type:         "claim",
				Confidence:   0.92,
				Status:       "evergreen",
				Provenance:   "user",
				CreatedAt:    now,
				UpdatedAt:    now,
			},
		},
		Edges: []atlasdto.TypedRelationResponse{
			{
				ID:           2,
				FromKPID:     1,
				ToKPID:       1,
				Type:         "supports",
				Strength:     0.8,
				BodyMarkdown: &body,
				Provenance:   "user",
				CreatedAt:    now,
				UpdatedAt:    now,
			},
		},
		KPEvidenceCounts:       map[int64]int64{1: 3},
		RelationEvidenceCounts: map[int64]int64{2: 1},
	}

	got := buildAtlasGraphML(graph, "mine", now)
	if strings.Index(got, `<graph id="aether-atlas" edgedefault="directed">`) > strings.Index(got, `<data key="scope">mine</data>`) {
		t.Fatalf("GraphML scope metadata should be inside the graph element\n%s", got)
	}
	for _, want := range []string{
		`<graphml xmlns="http://graphml.graphdrawing.org/xmlns">`,
		`<key id="title" for="all" attr.name="title" attr.type="string"/>`,
		`<graph id="aether-atlas" edgedefault="directed">`,
		`<data key="scope">mine</data>`,
		`<node id="kp-1">`,
		`<data key="title">Typed &lt;claim&gt; &amp; graph</data>`,
		`<data key="bodyMarkdown">Body should be escaped &amp; exported</data>`,
		`<data key="evidenceCount">3</data>`,
		`<edge id="rel-2" source="kp-1" target="kp-1">`,
		`<data key="bodyMarkdown">Evidence &lt;quote&gt; &amp; note</data>`,
		`<data key="evidenceCount">1</data>`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("GraphML missing %q\n%s", want, got)
		}
	}
}
