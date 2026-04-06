package repository

import (
	"strings"
	"testing"
)

func TestBuildPricedLogsCTEIncludesArchiveColumnsWhenSupported(t *testing.T) {
	query := buildPricedLogsCTE("WHERE 1=1", true)

	for _, needle := range []string{
		"l.cost_archive_status",
		"l.cost_archive_amount",
		"l.cost_archive_error",
	} {
		if !strings.Contains(query, needle) {
			t.Fatalf("query missing %q:\n%s", needle, query)
		}
	}
}

func TestBuildPricedLogsCTEOmitsArchiveColumnsWhenUnsupported(t *testing.T) {
	query := buildPricedLogsCTE("WHERE 1=1", false)

	for _, needle := range []string{
		"l.cost_archive_status",
		"l.cost_archive_amount",
		"l.cost_archive_error",
	} {
		if strings.Contains(query, needle) {
			t.Fatalf("query unexpectedly contains %q:\n%s", needle, query)
		}
	}

	for _, needle := range []string{
		"pricing.pricing_missing THEN 'missing'",
		"pricing.pricing_missing THEN pricing.missing_fields",
	} {
		if !strings.Contains(query, needle) {
			t.Fatalf("query missing fallback fragment %q:\n%s", needle, query)
		}
	}
}
