package repository

import (
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func newAgentWorkflowRepoMock(t *testing.T) (*AgentWorkflowRepo, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	cleanup := func() { _ = db.Close() }
	return NewAgentWorkflowRepo(sqlx.NewDb(db, "sqlmock")), mock, cleanup
}

func agentWorkflowRunRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"workflow_id",
		"version",
		"user_id",
		"status",
		"inputs",
		"outputs",
		"current_node",
		"started_at",
		"finished_at",
		"duration_ms",
		"total_node_count",
		"error_message",
		"created_at",
	})
}

func agentPublicationRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"workflow_id",
		"version",
		"slug",
		"display_name",
		"description",
		"input_schema",
		"output_schema",
		"allowed_origins",
		"rate_limit_per_min",
		"enabled",
		"created_at",
		"updated_at",
	})
}

func TestAgentWorkflowRepoUpsertPublicationMarksWorkflowPublic(t *testing.T) {
	repo, mock, cleanup := newAgentWorkflowRepoMock(t)
	defer cleanup()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)UPDATE agent_workflows.*SET is_public = TRUE.*RETURNING id`).
		WithArgs(int64(11), int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(11)))
	mock.ExpectQuery(`(?s)INSERT INTO agent_publications.*ON CONFLICT \(workflow_id\).*RETURNING`).
		WithArgs(
			int64(11),
			3,
			"article-audit-agent",
			"Article Audit Agent",
			"desc",
			`{"post_id":{"type":"integer"}}`,
			`{}`,
			`[]`,
			30,
			true,
		).
		WillReturnRows(agentPublicationRows().AddRow(
			int64(501),
			int64(11),
			3,
			"article-audit-agent",
			"Article Audit Agent",
			"desc",
			`{"post_id":{"type":"integer"}}`,
			`{}`,
			`[]`,
			30,
			true,
			now,
			now,
		))
	mock.ExpectCommit()

	publication, err := repo.UpsertPublication(t.Context(), AgentPublicationSaveRequest{
		UserID:          7,
		WorkflowID:      11,
		Version:         3,
		Slug:            "article-audit-agent",
		DisplayName:     "Article Audit Agent",
		Description:     nullableString("desc"),
		InputSchema:     `{"post_id":{"type":"integer"}}`,
		OutputSchema:    `{}`,
		AllowedOrigins:  `[]`,
		RateLimitPerMin: 30,
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("UpsertPublication returned error: %v", err)
	}
	if publication == nil || publication.ID != 501 || publication.WorkflowID != 11 || publication.Slug != "article-audit-agent" {
		t.Fatalf("unexpected publication: %#v", publication)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestAgentWorkflowRepoFindPublishedBySlugRequiresEnabledPublicWorkflow(t *testing.T) {
	repo, mock, cleanup := newAgentWorkflowRepoMock(t)
	defer cleanup()

	now := time.Now()
	mock.ExpectQuery(`(?s)FROM agent_publications p.*JOIN agent_workflows w.*WHERE p.slug = \$1.*p.enabled = TRUE.*w.is_public = TRUE`).
		WithArgs("article-audit-agent").
		WillReturnRows(agentPublicationRows().AddRow(
			int64(501),
			int64(11),
			3,
			"article-audit-agent",
			"Article Audit Agent",
			nil,
			`{"post_id":{"type":"integer"}}`,
			`{}`,
			`[]`,
			30,
			true,
			now,
			now,
		))

	publication, err := repo.FindPublishedBySlug(t.Context(), "article-audit-agent")
	if err != nil {
		t.Fatalf("FindPublishedBySlug returned error: %v", err)
	}
	if publication == nil || publication.WorkflowID != 11 || !publication.Enabled {
		t.Fatalf("unexpected publication: %#v", publication)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestAgentWorkflowRepoListWorkflowRuns(t *testing.T) {
	repo, mock, cleanup := newAgentWorkflowRepoMock(t)
	defer cleanup()

	now := time.Now()
	mock.ExpectQuery(`(?s)FROM agent_workflow_runs r.*LIMIT \$3`).
		WithArgs(int64(11), int64(7), 50).
		WillReturnRows(agentWorkflowRunRows().AddRow(
			int64(101),
			int64(11),
			3,
			int64(7),
			"success",
			`{"post_id":171}`,
			`{"ok":true}`,
			"final_report",
			now,
			now,
			42,
			5,
			nil,
			now,
		))

	runs, err := repo.ListWorkflowRuns(t.Context(), 7, 11, 0)
	if err != nil {
		t.Fatalf("ListWorkflowRuns returned error: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("ListWorkflowRuns length = %d, want 1", len(runs))
	}
	if runs[0].ID != 101 || runs[0].WorkflowID != 11 || runs[0].Status != "success" {
		t.Fatalf("unexpected run row: %#v", runs[0])
	}
	if runs[0].Outputs == nil || *runs[0].Outputs != `{"ok":true}` {
		t.Fatalf("outputs = %#v, want JSON object", runs[0].Outputs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestAgentWorkflowRepoFindRunByIDReturnsNilWhenMissing(t *testing.T) {
	repo, mock, cleanup := newAgentWorkflowRepoMock(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)FROM agent_workflow_runs r.*WHERE r.id = \$1`).
		WithArgs(int64(404), int64(7)).
		WillReturnRows(agentWorkflowRunRows())

	run, err := repo.FindRunByID(t.Context(), 7, 404)
	if err != nil {
		t.Fatalf("FindRunByID returned error: %v", err)
	}
	if run != nil {
		t.Fatalf("FindRunByID = %#v, want nil", run)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestAgentWorkflowRepoCancelRunPersistsRetryableCancellation(t *testing.T) {
	repo, mock, cleanup := newAgentWorkflowRepoMock(t)
	defer cleanup()

	now := time.Now()
	mock.ExpectQuery(`(?s)UPDATE agent_workflow_runs r.*status = CASE.*THEN 'cancelled'.*retryable = CASE.*THEN TRUE.*RETURNING`).
		WithArgs(int64(101), int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "workflow_id", "version", "user_id", "status", "simulated",
			"inputs", "total_node_count", "retryable", "created_at",
		}).AddRow(
			int64(101), int64(11), 3, int64(7), "cancelled", false,
			`{}`, 2, true, now,
		))

	run, err := repo.CancelRun(t.Context(), 7, 101)
	if err != nil {
		t.Fatalf("CancelRun returned error: %v", err)
	}
	if run == nil || run.Status != "cancelled" || !run.Retryable {
		t.Fatalf("unexpected cancelled run: %#v", run)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestAgentWorkflowRepoListRunLogsChecksRunOwnershipAndReturnsLogs(t *testing.T) {
	repo, mock, cleanup := newAgentWorkflowRepoMock(t)
	defer cleanup()

	now := time.Now()
	mock.ExpectQuery(`(?s)FROM agent_workflow_runs r.*WHERE r.id = \$1`).
		WithArgs(int64(101), int64(7)).
		WillReturnRows(agentWorkflowRunRows().AddRow(
			int64(101),
			int64(11),
			3,
			int64(7),
			"success",
			`{"post_id":171}`,
			`{"ok":true}`,
			"final_report",
			now,
			now,
			42,
			5,
			nil,
			now,
		))
	mock.ExpectQuery(`(?s)FROM agent_workflow_node_logs.*WHERE run_id = \$1`).
		WithArgs(int64(101)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"run_id",
			"sequence",
			"node_id",
			"node_type",
			"status",
			"input_json",
			"output_json",
			"duration_ms",
			"error_message",
			"started_at",
			"finished_at",
		}).AddRow(
			int64(9001),
			int64(101),
			1,
			"input_1",
			"input",
			"success",
			`{"post_id":171}`,
			`{"post_id":171}`,
			0,
			nil,
			now,
			now,
		))

	logs, err := repo.ListRunLogs(t.Context(), 7, 101)
	if err != nil {
		t.Fatalf("ListRunLogs returned error: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("ListRunLogs length = %d, want 1", len(logs))
	}
	if logs[0].RunID != 101 || logs[0].NodeID != "input_1" || logs[0].InputJSON != `{"post_id":171}` {
		t.Fatalf("unexpected log row: %#v", logs[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
