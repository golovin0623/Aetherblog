// Package testutil provides shared test infrastructure for handler tests.
package testutil

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

const TestJWTSecret = "test-secret-for-unit-tests-only"

type echoValidator struct{ v *validator.Validate }

func (ev *echoValidator) Validate(i any) error { return ev.v.Struct(i) }

// NewEcho creates a fresh Echo instance with validator, matching server setup.
func NewEcho() *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Validator = &echoValidator{v: validator.New()}
	return e
}

// DoRequest sends a request to the given Echo instance and returns the response.
func DoRequest(e *echo.Echo, method, path string, body string, headers ...http.Header) *httptest.ResponseRecorder {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	if len(headers) > 0 {
		for k, vs := range headers[0] {
			for _, v := range vs {
				req.Header.Set(k, v)
			}
		}
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// DoAuthRequest sends a request with a valid JWT Authorization header.
func DoAuthRequest(e *echo.Echo, method, path, body string, userID int64) *httptest.ResponseRecorder {
	token, _ := jwtutil.GenerateToken(userID, "admin", "ADMIN", TestJWTSecret, time.Hour)
	h := http.Header{}
	h.Set("Authorization", "Bearer "+token)
	return DoRequest(e, method, path, body, h)
}

// ParseResponse extracts the response.R from a recorder's body.
func ParseResponse(rec *httptest.ResponseRecorder) (*response.R, error) {
	var r response.R
	if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
		return nil, err
	}
	return &r, nil
}
