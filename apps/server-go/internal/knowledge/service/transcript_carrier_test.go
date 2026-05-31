package service

import (
	"strings"
	"testing"
)

func TestTranscriptCarrierTextAndType(t *testing.T) {
	text := TranscriptCarrierText(TranscriptCarrierInput{
		TranscriptMarkdown: "## Transcript\n\n[00:12] This is **spoken** Atlas context.",
	})
	for _, want := range []string{"Transcript", "[00:12]", "spoken Atlas context"} {
		if !strings.Contains(text, want) {
			t.Fatalf("TranscriptCarrierText() = %q, want it to contain %q", text, want)
		}
	}
	if strings.Contains(text, "**") {
		t.Fatalf("TranscriptCarrierText() should normalize markdown syntax, got %q", text)
	}

	for _, tt := range []struct {
		media TranscriptMediaSnapshot
		want  string
	}{
		{media: TranscriptMediaSnapshot{FileType: "VIDEO", MimeType: "application/octet-stream"}, want: "video"},
		{media: TranscriptMediaSnapshot{FileType: "OTHER", MimeType: "audio/mpeg"}, want: "audio"},
	} {
		got, ok := transcriptCarrierType(&tt.media)
		if !ok || got != tt.want {
			t.Fatalf("transcriptCarrierType(%+v) = %q,%v want %q,true", tt.media, got, ok, tt.want)
		}
	}

	if got, ok := transcriptCarrierType(&TranscriptMediaSnapshot{FileType: "DOCUMENT", MimeType: "application/pdf"}); ok || got != "" {
		t.Fatalf("document media should not be accepted as transcript carrier, got %q,%v", got, ok)
	}
}

func TestTranscriptTextLayerStorageURI(t *testing.T) {
	if got := TranscriptTextLayerStorageURI("video", 42, "abc123"); got != "atlas-text-layer://video-transcript/42/abc123" {
		t.Fatalf("TranscriptTextLayerStorageURI() = %q", got)
	}
}

func TestAtlasServiceAttachTranscriptMedia(t *testing.T) {
	transcripts := NewTranscriptCarrierService(nil, nil)
	svc := NewAtlasService(nil, nil)
	svc.AttachTranscriptMedia(transcripts)
	if svc.TranscriptMedia() != transcripts {
		t.Fatalf("TranscriptMedia() did not return attached service")
	}
}
