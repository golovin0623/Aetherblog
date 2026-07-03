package repository

// EvidencePreviewRow 是第一个可访问的证据注释
// 它是图形主题的载体，例如 KP 或类型化关系。
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
