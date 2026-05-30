ALTER TABLE agent_workflow_runs
    ADD COLUMN IF NOT EXISTS simulated BOOLEAN;

UPDATE agent_workflow_runs
SET simulated = TRUE
WHERE simulated IS NULL;

ALTER TABLE agent_workflow_runs
    ALTER COLUMN simulated SET DEFAULT FALSE,
    ALTER COLUMN simulated SET NOT NULL;

COMMENT ON COLUMN agent_workflow_runs.simulated IS 'Whether this run explicitly used simulated external executors instead of real runtime adapters.';
