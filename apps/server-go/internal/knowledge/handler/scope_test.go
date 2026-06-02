package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
)

func TestAtlasScopeAuthorFilterRestrictsNonAdmin(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest("GET", "http://example.test/atlas/knowledge-points?authorId=8", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "AUTHOR"})

	scope, err := currentAtlasScope(c)
	if err != nil {
		t.Fatalf("currentAtlasScope returned error: %v", err)
	}
	_, err = scope.authorFilter(c)
	if err == nil {
		t.Fatal("expected non-admin authorId switch to fail")
	}
}

func TestAtlasScopeAuthorFilterDefaultsNonAdminToSelf(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest("GET", "http://example.test/atlas/knowledge-points", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "AUTHOR"})

	scope, err := currentAtlasScope(c)
	if err != nil {
		t.Fatalf("currentAtlasScope returned error: %v", err)
	}
	got, err := scope.authorFilter(c)
	if err != nil {
		t.Fatalf("authorFilter returned error: %v", err)
	}
	if got == nil || *got != 7 {
		t.Fatalf("authorFilter = %v, want user 7", got)
	}
}

func TestAtlasScopeAuthorFilterAllowsAdminAllAndMine(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest("GET", "http://example.test/atlas/knowledge-points", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "ADMIN"})
	c.Set(atlasScopeCanAdminKey, true)

	scope, err := currentAtlasScope(c)
	if err != nil {
		t.Fatalf("currentAtlasScope returned error: %v", err)
	}
	got, err := scope.authorFilter(c)
	if err != nil {
		t.Fatalf("authorFilter returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("authorFilter admin default = %v, want all", got)
	}

	req = httptest.NewRequest("GET", "http://example.test/atlas/knowledge-points?scope=mine", nil)
	c = e.NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 7, Role: "ADMIN"})
	c.Set(atlasScopeCanAdminKey, true)
	scope, err = currentAtlasScope(c)
	if err != nil {
		t.Fatalf("currentAtlasScope returned error: %v", err)
	}
	got, err = scope.authorFilter(c)
	if err != nil {
		t.Fatalf("authorFilter returned error: %v", err)
	}
	if got == nil || *got != 7 {
		t.Fatalf("authorFilter admin mine = %v, want user 7", got)
	}
}
