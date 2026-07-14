package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

func TestNoteKnowledgeEndpointsFailClosedForNonOwner(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := repository.NewNoteRepo(sqlx.NewDb(db, "sqlmock"))
	handler := NewNoteHandler(service.NewNoteService(repo, nil))

	endpoints := []struct {
		name   string
		method string
		run    echo.HandlerFunc
	}{
		{name: "readiness", method: http.MethodGet, run: handler.KnowledgeReadiness},
		{name: "prepare", method: http.MethodPost, run: handler.PrepareKnowledgeSource},
	}

	for _, endpoint := range endpoints {
		t.Run(endpoint.name, func(t *testing.T) {
			mock.ExpectQuery("SELECT author_id FROM notes").
				WithArgs(int64(11)).
				WillReturnRows(sqlmock.NewRows([]string{"author_id"}).AddRow(int64(9)))

			e := echo.New()
			req := httptest.NewRequest(endpoint.method, "/api/v1/admin/notes/11", nil)
			rec := httptest.NewRecorder()
			ctx := e.NewContext(req, rec)
			ctx.SetPath("/api/v1/admin/notes/:id")
			ctx.SetParamNames("id")
			ctx.SetParamValues("11")
			ctx.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "user"})

			if err := endpoint.run(ctx); err != nil {
				t.Fatalf("handler returned error: %v", err)
			}
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
			}
		})
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
