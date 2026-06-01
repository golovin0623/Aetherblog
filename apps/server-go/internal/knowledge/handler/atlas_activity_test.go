package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	appmodel "github.com/golovin0623/aetherblog-server/internal/model"
)

type fakeAtlasActivityRecorder struct {
	events []*appmodel.ActivityEvent
}

func (f *fakeAtlasActivityRecorder) Create(_ context.Context, a *appmodel.ActivityEvent) error {
	cp := *a
	f.events = append(f.events, &cp)
	return nil
}

func TestAtlasEventHandlerRecordAllowsGraphSearch(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(
		http.MethodPost,
		"/atlas/events",
		strings.NewReader(`{"eventType":"atlas.graph_search","title":"Graph search","description":"keyword=atlas"}`),
	)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	res := httptest.NewRecorder()
	c := e.NewContext(req, res)
	recorder := &fakeAtlasActivityRecorder{}

	if err := NewAtlasEventHandler(recorder).Record(c); err != nil {
		t.Fatalf("Record returned error: %v", err)
	}
	if len(recorder.events) != 1 {
		t.Fatalf("events recorded = %d, want 1", len(recorder.events))
	}
	got := recorder.events[0]
	if got.EventType != "atlas.graph_search" {
		t.Fatalf("event type = %q, want atlas.graph_search", got.EventType)
	}
	if got.EventCategory == nil || *got.EventCategory != "system" {
		t.Fatalf("event category = %v, want system", got.EventCategory)
	}
	if got.Status == nil || *got.Status != "INFO" {
		t.Fatalf("status = %v, want INFO", got.Status)
	}
}

func TestAtlasEventHandlerMountRequiresWritePermission(t *testing.T) {
	e := echo.New()
	handler := NewAtlasEventHandler(&fakeAtlasActivityRecorder{})
	writeCalled := false
	handler.Mount(e.Group("/atlas"), func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			writeCalled = true
			return next(c)
		}
	})

	req := httptest.NewRequest(http.MethodPost, "/atlas/events", strings.NewReader(`{"eventType":"atlas.search"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if !writeCalled {
		t.Fatal("POST /atlas/events did not pass through write middleware")
	}
}
