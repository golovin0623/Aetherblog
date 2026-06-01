package service

import (
	"strings"
	"testing"
)

func TestImageCarrierTextAndType(t *testing.T) {
	text := ImageCarrierText(ImageCarrierInput{
		DescriptionMarkdown: "## Diagram\n\nA **Knowledge Atlas** screenshot with labels.",
	})
	for _, want := range []string{"Diagram", "Knowledge Atlas screenshot", "labels"} {
		if !strings.Contains(text, want) {
			t.Fatalf("ImageCarrierText() = %q, want it to contain %q", text, want)
		}
	}
	if strings.Contains(text, "**") {
		t.Fatalf("ImageCarrierText() should normalize markdown syntax, got %q", text)
	}

	for _, tt := range []struct {
		media ImageMediaSnapshot
		want  string
	}{
		{media: ImageMediaSnapshot{FileType: "IMAGE", MimeType: "application/octet-stream"}, want: "image"},
		{media: ImageMediaSnapshot{FileType: "OTHER", MimeType: "image/png"}, want: "image"},
	} {
		got, ok := imageCarrierType(&tt.media)
		if !ok || got != tt.want {
			t.Fatalf("imageCarrierType(%+v) = %q,%v want %q,true", tt.media, got, ok, tt.want)
		}
	}

	if got, ok := imageCarrierType(&ImageMediaSnapshot{FileType: "VIDEO", MimeType: "video/mp4"}); ok || got != "" {
		t.Fatalf("video media should not be accepted as image carrier, got %q,%v", got, ok)
	}
}

func TestImageTextLayerStorageURI(t *testing.T) {
	if got := ImageTextLayerStorageURI(42, "abc123"); got != "atlas-text-layer://image/42/abc123" {
		t.Fatalf("ImageTextLayerStorageURI() = %q", got)
	}
}

func TestAtlasServiceAttachImageMedia(t *testing.T) {
	images := NewImageCarrierService(nil, nil)
	svc := NewAtlasService(nil, nil)
	svc.AttachImageMedia(images)
	if svc.ImageMedia() != images {
		t.Fatalf("ImageMedia() did not return attached service")
	}
}
