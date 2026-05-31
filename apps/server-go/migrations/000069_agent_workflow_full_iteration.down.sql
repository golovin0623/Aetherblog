DROP TABLE IF EXISTS agent_workflow_notifications;
DROP TABLE IF EXISTS agent_cowork_tasks;
DROP TABLE IF EXISTS agent_workflow_human_inputs;
DROP TABLE IF EXISTS agent_workflow_error_bindings;
DROP TABLE IF EXISTS agent_workflow_marketplace_items;
DROP TABLE IF EXISTS agent_workflow_eval_cases;
DROP TABLE IF EXISTS agent_publication_invocations;
DROP TABLE IF EXISTS agent_workflow_approvals;

ALTER TABLE agent_publications
    DROP COLUMN IF EXISTS trusted_internal_only;

ALTER TABLE agent_schedules
    DROP COLUMN IF EXISTS last_error,
    DROP COLUMN IF EXISTS missed_run_policy;

ALTER TABLE agent_workflow_node_logs
    DROP COLUMN IF EXISTS metadata_json;

ALTER TABLE agent_workflow_runs
    DROP COLUMN IF EXISTS canonicalized_workflow_id,
    DROP COLUMN IF EXISTS retryable,
    DROP COLUMN IF EXISTS error_category,
    DROP COLUMN IF EXISTS error_code,
    DROP COLUMN IF EXISTS max_nodes,
    DROP COLUMN IF EXISTS max_duration_ms,
    DROP COLUMN IF EXISTS max_cost_usd,
    DROP COLUMN IF EXISTS max_tokens,
    DROP COLUMN IF EXISTS redaction_policy,
    DROP COLUMN IF EXISTS source_ref,
    DROP COLUMN IF EXISTS source_type,
    DROP COLUMN IF EXISTS cancel_requested,
    DROP COLUMN IF EXISTS resume_from_node,
    DROP COLUMN IF EXISTS retry_of_run_id;
