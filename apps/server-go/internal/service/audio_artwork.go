package service

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/dhowden/tag"
)

const maxEmbeddedAudioArtworkBytes = 12 * 1024 * 1024

type audioArtwork struct {
	Data      []byte
	MimeType  string
	Extension string
}

func extractAudioArtwork(r io.ReadSeeker, size int64, mimeType string) (*audioArtwork, error) {
	if r == nil || !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/") {
		return nil, nil
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	defer func() {
		_, _ = r.Seek(0, io.SeekStart)
	}()

	metadata, err := tag.ReadFrom(r)
	if err != nil {
		if errors.Is(err, tag.ErrNoTagsFound) {
			return nil, nil
		}
		return nil, nil
	}
	picture := metadata.Picture()
	if picture == nil || len(picture.Data) == 0 || len(picture.Data) > maxEmbeddedAudioArtworkBytes {
		return nil, nil
	}

	pictureMime := normalizeArtworkMime(picture.MIMEType, picture.Data)
	if pictureMime == "" {
		return nil, nil
	}
	return &audioArtwork{
		Data:      picture.Data,
		MimeType:  pictureMime,
		Extension: artworkExtension(pictureMime),
	}, nil
}

func normalizeArtworkMime(raw string, data []byte) string {
	mime := strings.ToLower(strings.TrimSpace(raw))
	switch mime {
	case "image/jpg":
		mime = "image/jpeg"
	case "":
		mime = strings.ToLower(http.DetectContentType(data))
	}
	switch mime {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff":
		return mime
	default:
		return ""
	}
}

func artworkExtension(mime string) string {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/bmp":
		return ".bmp"
	case "image/tiff":
		return ".tiff"
	default:
		return ".jpg"
	}
}
