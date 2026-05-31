package handler

import (
	"net/http"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestCarrierHandlerMountsPostCarrierRoute(t *testing.T) {
	e := echo.New()
	h := &CarrierHandler{}
	h.Mount(e.Group("/atlas"), func(next echo.HandlerFunc) echo.HandlerFunc { return next })

	for _, route := range e.Routes() {
		if route.Method == http.MethodPost && route.Path == "/atlas/carriers/post" {
			return
		}
	}
	t.Fatalf("POST /atlas/carriers/post route was not mounted")
}

func TestCarrierHandlerMountsWebCarrierRoute(t *testing.T) {
	e := echo.New()
	h := &CarrierHandler{}
	h.Mount(e.Group("/atlas"), func(next echo.HandlerFunc) echo.HandlerFunc { return next })

	for _, route := range e.Routes() {
		if route.Method == http.MethodPost && route.Path == "/atlas/carriers/web" {
			return
		}
	}
	t.Fatalf("POST /atlas/carriers/web route was not mounted")
}
