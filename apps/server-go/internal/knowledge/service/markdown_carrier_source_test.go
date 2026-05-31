package service

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestMarkdownCarrierServiceSourceScope(t *testing.T) {
	ownerID := int64(10)
	otherID := int64(11)
	notes := &fakeMarkdownNotes{
		notes: map[int64]*NoteSnapshot{
			7: {ID: 7, Title: "Scoped Note", Content: "body", AuthorID: &ownerID},
		},
	}
	svc := NewMarkdownCarrierService(nil, notes)

	note, err := svc.GetNoteSourceAs(context.Background(), 7, ownerID, false)
	if err != nil {
		t.Fatalf("owner read returned error: %v", err)
	}
	if note.ID != 7 || note.Title != "Scoped Note" {
		t.Fatalf("unexpected owner note: %#v", note)
	}

	_, err = svc.GetNoteSourceAs(context.Background(), 7, otherID, false)
	if !errors.Is(err, ErrAtlasForbidden) {
		t.Fatalf("other user error = %v, want ErrAtlasForbidden", err)
	}

	note, err = svc.GetNoteSourceAs(context.Background(), 7, otherID, true)
	if err != nil {
		t.Fatalf("admin read returned error: %v", err)
	}
	if note.ID != 7 {
		t.Fatalf("unexpected admin note: %#v", note)
	}
}

func TestMarkdownCarrierServiceCreateSource(t *testing.T) {
	notes := &fakeMarkdownNotes{nextID: 40, notes: map[int64]*NoteSnapshot{}}
	svc := NewMarkdownCarrierService(nil, notes)

	note, err := svc.CreateNoteSourceAs(context.Background(), " Atlas Source ", "  Reader content  ", 12)
	if err != nil {
		t.Fatalf("create source returned error: %v", err)
	}
	if note.ID != 40 || note.Title != "Atlas Source" || note.Content != "Reader content" {
		t.Fatalf("unexpected created note: %#v", note)
	}
	if note.AuthorID == nil || *note.AuthorID != 12 {
		t.Fatalf("created note author = %#v, want 12", note.AuthorID)
	}

	_, err = svc.CreateNoteSourceAs(context.Background(), "", "   ", 12)
	if err == nil || !strings.Contains(err.Error(), "contentMarkdown") {
		t.Fatalf("blank content error = %v, want contentMarkdown validation", err)
	}
}

type fakeMarkdownNotes struct {
	nextID int64
	notes  map[int64]*NoteSnapshot
}

func (f *fakeMarkdownNotes) GetNoteSnapshot(_ context.Context, noteID int64) (*NoteSnapshot, error) {
	note, ok := f.notes[noteID]
	if !ok {
		return nil, nil
	}
	copy := *note
	return &copy, nil
}

func (f *fakeMarkdownNotes) CreateNoteSnapshot(_ context.Context, title string, content string, authorID int64) (*NoteSnapshot, error) {
	if f.nextID == 0 {
		f.nextID = 1
	}
	id := f.nextID
	f.nextID++
	authorIDCopy := authorID
	note := &NoteSnapshot{
		ID:       id,
		Title:    title,
		Content:  content,
		AuthorID: &authorIDCopy,
	}
	f.notes[id] = note
	copy := *note
	return &copy, nil
}
