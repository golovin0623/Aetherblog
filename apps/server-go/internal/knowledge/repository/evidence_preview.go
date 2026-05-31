package repository

// EvidencePreviewRow is the first accessible evidence annotation joined with
// its carrier for a graph subject such as a KP or typed relation.
type EvidencePreviewRow struct {
	SubjectID          int64   `db:"subject_id"`
	AnnotationID       int64   `db:"annotation_id"`
	CarrierID          int64   `db:"carrier_id"`
	Selectors          []byte  `db:"selectors"`
	BodyText           *string `db:"body_text"`
	AnnotationAuthorID *int64  `db:"annotation_author_id"`
	CarrierType        string  `db:"carrier_type"`
	CarrierTitle       string  `db:"carrier_title"`
	CarrierOwnerID     *int64  `db:"carrier_owner_id"`
}
