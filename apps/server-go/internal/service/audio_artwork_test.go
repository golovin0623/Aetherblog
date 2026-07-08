package service

import (
	"bytes"
	"encoding/binary"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

func TestExtractAudioArtworkID3v2APIC(t *testing.T) {
	artworkJPEG := []byte{0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9}
	payload := buildID3v23APICPayload("image/jpeg", artworkJPEG)

	artwork, err := extractAudioArtwork(bytes.NewReader(payload), int64(len(payload)), "audio/mpeg")
	if err != nil {
		t.Fatalf("extractAudioArtwork returned error: %v", err)
	}
	if artwork == nil {
		t.Fatal("expected embedded artwork, got nil")
	}
	if artwork.MimeType != "image/jpeg" {
		t.Fatalf("artwork MIME = %q, want image/jpeg", artwork.MimeType)
	}
	if !bytes.Equal(artwork.Data, artworkJPEG) {
		t.Fatalf("artwork bytes mismatch: got %x want %x", artwork.Data, artworkJPEG)
	}
	if artwork.Extension != ".jpg" {
		t.Fatalf("artwork extension = %q, want .jpg", artwork.Extension)
	}
}

func TestExtractAudioArtworkNoPictureIsNonFatal(t *testing.T) {
	payload := append([]byte("ID3\x03\x00\x00\x00\x00\x00\x00"), []byte("audio body")...)

	artwork, err := extractAudioArtwork(bytes.NewReader(payload), int64(len(payload)), "audio/mpeg")
	if err != nil {
		t.Fatalf("extractAudioArtwork returned error for no-artwork audio: %v", err)
	}
	if artwork != nil {
		t.Fatalf("expected no artwork, got %#v", artwork)
	}
}

func TestAudioMimeFallbackCoversCommonPlayableExtensions(t *testing.T) {
	cases := []struct {
		filename string
		want     string
	}{
		{"song.flac", "audio/flac"},
		{"song.m4a", "audio/x-m4a"},
		{"song.aac", "audio/aac"},
		{"song.opus", "audio/ogg"},
		{"song.oga", "audio/ogg"},
		{"song.weba", "audio/webm"},
	}
	for _, tc := range cases {
		t.Run(tc.filename, func(t *testing.T) {
			got := resolveMimeWithFallback("application/octet-stream", tc.filename)
			if got != tc.want {
				t.Fatalf("resolveMimeWithFallback(..., %q) = %q, want %q", tc.filename, got, tc.want)
			}
			if !allowedMimeTypes[got] {
				t.Fatalf("%q must be allowed for upload", got)
			}
			if classifyFileType(got) != "AUDIO" {
				t.Fatalf("%q must classify as AUDIO", got)
			}
		})
	}
}

func TestMediaFileVOIncludesDerivativeThumbnailURL(t *testing.T) {
	thumb := "/api/uploads/thumbnails/audio/2026/07/song.jpg"
	vo := toMediaFileVOWithThumbnail(testMediaFile(7, "AUDIO"), thumb)

	if vo.ThumbnailURL != thumb {
		t.Fatalf("ThumbnailURL = %q, want %q", vo.ThumbnailURL, thumb)
	}
}

func buildID3v23APICPayload(mime string, image []byte) []byte {
	frameBody := bytes.NewBuffer(nil)
	frameBody.WriteByte(0)      // text encoding: ISO-8859-1
	frameBody.WriteString(mime) // MIME
	frameBody.WriteByte(0)      // MIME terminator
	frameBody.WriteByte(3)      // front cover
	frameBody.WriteByte(0)      // empty description terminator
	frameBody.Write(image)

	frame := bytes.NewBuffer(nil)
	frame.WriteString("APIC")
	var frameSize [4]byte
	binary.BigEndian.PutUint32(frameSize[:], uint32(frameBody.Len()))
	frame.Write(frameSize[:])
	frame.Write([]byte{0, 0}) // flags
	frame.Write(frameBody.Bytes())

	tag := bytes.NewBuffer(nil)
	tag.WriteString("ID3")
	tag.Write([]byte{3, 0, 0})
	tag.Write(syncSafeSize(frame.Len()))
	tag.Write(frame.Bytes())
	return tag.Bytes()
}

func syncSafeSize(n int) []byte {
	return []byte{
		byte((n >> 21) & 0x7f),
		byte((n >> 14) & 0x7f),
		byte((n >> 7) & 0x7f),
		byte(n & 0x7f),
	}
}

func testMediaFile(id int64, fileType string) model.MediaFile {
	mime := "audio/mpeg"
	return model.MediaFile{
		ID:           id,
		Filename:     "song.mp3",
		OriginalName: "song.mp3",
		FilePath:     "2026/07/song.mp3",
		FileURL:      "2026/07/song.mp3",
		FileSize:     1024,
		MimeType:     &mime,
		FileType:     fileType,
		StorageType:  "LOCAL",
	}
}
