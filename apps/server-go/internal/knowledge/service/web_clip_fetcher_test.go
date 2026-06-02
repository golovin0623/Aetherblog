package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/netip"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestWebClipFetcherExtractsReadableSnapshot(t *testing.T) {
	fetcher := &WebClipFetcher{
		client: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if req.URL.String() != "https://example.com/articles/atlas?q=1" {
				t.Fatalf("unexpected fetch URL %s", req.URL.String())
			}
			html := `<!doctype html>
<html lang="en">
  <head>
    <title>Atlas Capture</title>
    <meta name="author" content="Ada">
  </head>
  <body>
    <nav>Navigation should not appear</nav>
    <article>
      <h1>Atlas Capture</h1>
      <p>Readable knowledge graph context.</p>
      <script>window.secret = true</script>
      <p>Second paragraph with evidence.</p>
    </article>
  </body>
</html>`
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
				Body:       io.NopCloser(bytes.NewBufferString(html)),
			}, nil
		})},
		lookupIP: func(ctx context.Context, host string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
		},
		maxBytes: 64 * 1024,
	}

	snapshot, err := fetcher.Fetch(context.Background(), "HTTPS://Example.COM/articles/atlas?q=1#section")
	if err != nil {
		t.Fatalf("Fetch returned error: %v", err)
	}
	if snapshot.SourceURL != "https://example.com/articles/atlas?q=1" {
		t.Fatalf("SourceURL = %q", snapshot.SourceURL)
	}
	if snapshot.Title != "Atlas Capture" {
		t.Fatalf("Title = %q", snapshot.Title)
	}
	if snapshot.Author == nil || *snapshot.Author != "Ada" {
		t.Fatalf("Author = %#v", snapshot.Author)
	}
	if snapshot.Language == nil || *snapshot.Language != "en" {
		t.Fatalf("Language = %#v", snapshot.Language)
	}
	for _, want := range []string{"# Atlas Capture", "Readable knowledge graph context.", "Second paragraph with evidence."} {
		if !strings.Contains(snapshot.ContentMarkdown, want) {
			t.Fatalf("ContentMarkdown = %q, want %q", snapshot.ContentMarkdown, want)
		}
	}
	for _, notWant := range []string{"Navigation should not appear", "window.secret"} {
		if strings.Contains(snapshot.ContentMarkdown, notWant) {
			t.Fatalf("ContentMarkdown leaked %q: %q", notWant, snapshot.ContentMarkdown)
		}
	}
}

func TestWebClipFetcherRejectsPrivateTargets(t *testing.T) {
	fetcher := &WebClipFetcher{
		client: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			t.Fatalf("private targets must be rejected before HTTP request")
			return nil, nil
		})},
		lookupIP: func(ctx context.Context, host string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		},
		maxBytes: 64 * 1024,
	}

	if _, err := fetcher.Fetch(context.Background(), "http://localhost/admin"); err == nil {
		t.Fatalf("Fetch should reject loopback/private target")
	}
}

func TestExtractReadableWebSnapshotRejectsWeakContent(t *testing.T) {
	if _, err := ExtractReadableWebSnapshot("https://example.com", strings.NewReader("<html><body><script>1</script></body></html>"), "text/html"); err == nil {
		t.Fatalf("weak HTML with no readable text should be rejected")
	}
}
