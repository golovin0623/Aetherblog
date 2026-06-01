package service

import (
	"strings"
	"testing"
)

func TestWebClipSourceURIAndText(t *testing.T) {
	uri, err := NormalizeWebClipSourceURI("HTTPS://Example.COM/articles/atlas?q=1#section")
	if err != nil {
		t.Fatalf("NormalizeWebClipSourceURI returned error: %v", err)
	}
	if uri != "https://example.com/articles/atlas?q=1" {
		t.Fatalf("source uri = %q, want normalized https URL without fragment", uri)
	}
	if got := WebTextLayerStorageURI(9, uri, "abc123"); !strings.HasPrefix(got, "atlas-text-layer://web/9/") || !strings.HasSuffix(got, "/abc123") {
		t.Fatalf("web text layer uri = %q, want owner/source/hash URI", got)
	}

	for _, raw := range []string{"javascript:alert(1)", "ftp://example.com/file", "/relative/path", "https://"} {
		if got, err := NormalizeWebClipSourceURI(raw); err == nil {
			t.Fatalf("NormalizeWebClipSourceURI(%q) = %q, want error", raw, got)
		}
	}

	text := WebClipText(WebClipInput{
		Title:           "Atlas Web Clip",
		ContentMarkdown: "## Heading\n\nThis is **web** content from a page.",
	})
	for _, want := range []string{"Atlas Web Clip", "Heading", "web content"} {
		if !strings.Contains(text, want) {
			t.Fatalf("WebClipText() = %q, want it to contain %q", text, want)
		}
	}
	if strings.Contains(text, "**") {
		t.Fatalf("WebClipText() should normalize markdown syntax, got %q", text)
	}
}

func TestAtlasServiceAttachWebClips(t *testing.T) {
	web := NewWebClipCarrierService(nil)
	svc := NewAtlasService(nil, nil)
	svc.AttachWebClips(web)
	if svc.WebClips() != web {
		t.Fatalf("WebClips() did not return attached service")
	}
}
