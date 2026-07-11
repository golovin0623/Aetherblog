package handler

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type systemMonitorHTTPDoerFunc func(*http.Request) (*http.Response, error)

func (f systemMonitorHTTPDoerFunc) Do(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestRunConcurrentlyStartsEveryTaskAndPreservesInputOrder(t *testing.T) {
	started := make(chan int, 3)
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer func() { releaseOnce.Do(func() { close(release) }) }()

	tasks := make([]func() int, 3)
	for i := range tasks {
		index := i
		tasks[i] = func() int {
			started <- index
			<-release
			return index + 10
		}
	}

	resultCh := make(chan []int, 1)
	go func() { resultCh <- runConcurrently(tasks...) }()

	seen := make(map[int]bool, 3)
	for range 3 {
		select {
		case index := <-started:
			seen[index] = true
		case <-time.After(500 * time.Millisecond):
			t.Fatalf("tasks did not all start concurrently; started=%v", seen)
		}
	}
	releaseOnce.Do(func() { close(release) })

	select {
	case got := <-resultCh:
		want := []int{10, 11, 12}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("result[%d] = %d, want %d; full result=%v", i, got[i], want[i], got)
			}
		}
	case <-time.After(time.Second):
		t.Fatal("concurrent tasks did not finish")
	}
}

func TestCheckAIServiceHealthRejectsNonOKStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/health" {
			t.Errorf("request path = %q, want /health", req.URL.Path)
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("not ready"))
	}))
	defer server.Close()

	got := checkAIServiceHealth(context.Background(), server.Client(), server.URL+"/")

	if got.Name != "ai" || got.Status != "down" || got.Latency != 0 || got.Message != "unexpected AI health status: 503" {
		t.Fatalf("health = %#v, want ai/down/0/unexpected AI health status: 503", got)
	}
}

func TestCheckAIServiceHealthUsesContextTimeoutAndAcceptsOK(t *testing.T) {
	client := systemMonitorHTTPDoerFunc(func(req *http.Request) (*http.Response, error) {
		deadline, ok := req.Context().Deadline()
		if !ok {
			t.Fatal("AI health request has no context deadline")
		}
		remaining := time.Until(deadline)
		if remaining <= 0 || remaining > 3*time.Second {
			t.Fatalf("AI health request deadline remaining = %s, want (0, 3s]", remaining)
		}
		if got := req.URL.String(); got != "http://ai.internal/health" {
			t.Fatalf("request URL = %q, want http://ai.internal/health", got)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("ok")),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})

	got := checkAIServiceHealth(context.Background(), client, "http://ai.internal/")

	if got.Name != "ai" || got.Status != "up" || got.Message != "" {
		t.Fatalf("health = %#v, want ai/up", got)
	}
}
