package service

import (
	"context"
	"strings"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
)

func TestAISuggestionCreateRejectsUnboundKPSuggestion(t *testing.T) {
	svc := &AISuggestionService{}
	title := "没有来源的建议"

	_, err := svc.Create(context.Background(), CreateSuggestionInput{
		Kind:          "kp",
		ProposedTitle: &title,
	})
	if err == nil {
		t.Fatal("Create returned nil error, want source binding error")
	}
	if !strings.Contains(err.Error(), "carrier 或 annotation") {
		t.Fatalf("Create error = %q, want carrier/annotation message", err.Error())
	}
}

func TestAISuggestionCreateRejectsInvalidProposedKPType(t *testing.T) {
	svc := &AISuggestionService{}
	title := "错误类型"
	kpType := "made_up"
	carrierID := int64(11)

	_, err := svc.Create(context.Background(), CreateSuggestionInput{
		Kind:           "kp",
		CarrierID:      &carrierID,
		ProposedTitle:  &title,
		ProposedKPType: &kpType,
	})
	if err == nil {
		t.Fatal("Create returned nil error, want invalid kp type error")
	}
	if !strings.Contains(err.Error(), "kp type") {
		t.Fatalf("Create error = %q, want kp type message", err.Error())
	}
}

func TestFingerprintSuggestionIncludesSourceAndProposal(t *testing.T) {
	carrierID := int64(1)
	annotationID := int64(2)
	title := "系统一"
	a := &model.AISuggestion{
		Kind:          "kp",
		CarrierID:     &carrierID,
		AnnotationID:  &annotationID,
		ProposedTitle: &title,
	}
	b := &model.AISuggestion{
		Kind:          "kp",
		CarrierID:     &carrierID,
		AnnotationID:  &annotationID,
		ProposedTitle: &title,
	}
	if got, want := fingerprintSuggestion(a), fingerprintSuggestion(b); got != want {
		t.Fatalf("same suggestion fingerprint mismatch: got %s want %s", got, want)
	}
	otherTitle := "系统二"
	b.ProposedTitle = &otherTitle
	if fingerprintSuggestion(a) == fingerprintSuggestion(b) {
		t.Fatal("fingerprint did not change after proposal title changed")
	}
}
