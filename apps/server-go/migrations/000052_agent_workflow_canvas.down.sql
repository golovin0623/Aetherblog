-- 回滚 000052：删除 Agent Workflow Canvas 相关表

DROP INDEX IF EXISTS idx_agent_publications_enabled;
DROP INDEX IF EXISTS idx_agent_publications_workflow;
DROP TABLE IF EXISTS agent_publications;

DROP INDEX IF EXISTS idx_agent_schedules_workflow;
DROP INDEX IF EXISTS idx_agent_schedules_next;
DROP TABLE IF EXISTS agent_schedules;

DROP INDEX IF EXISTS idx_agent_node_logs_run_node;
DROP INDEX IF EXISTS uq_agent_node_logs_run_sequence;
DROP TABLE IF EXISTS agent_workflow_node_logs;

DROP INDEX IF EXISTS idx_agent_workflow_runs_user_status;
DROP INDEX IF EXISTS idx_agent_workflow_runs_workflow;
DROP TABLE IF EXISTS agent_workflow_runs;

DROP INDEX IF EXISTS idx_agent_variables_user;
DROP INDEX IF EXISTS idx_agent_variables_workflow;
DROP TABLE IF EXISTS agent_variables;

DROP TABLE IF EXISTS agent_workflow_versions;

DROP INDEX IF EXISTS idx_agent_workflows_template;
DROP INDEX IF EXISTS idx_agent_workflows_public;
DROP INDEX IF EXISTS idx_agent_workflows_owner_updated;
DROP TABLE IF EXISTS agent_workflows;

DROP INDEX IF EXISTS idx_agent_agents_owner_enabled;
DROP TABLE IF EXISTS agent_agents;

DROP INDEX IF EXISTS idx_agent_tools_connector;
DROP INDEX IF EXISTS idx_agent_tools_public;
DROP INDEX IF EXISTS idx_agent_tools_owner_enabled;
DROP INDEX IF EXISTS uq_agent_tools_system_code;
DROP INDEX IF EXISTS uq_agent_tools_user_code;
DROP TABLE IF EXISTS agent_tools;

DROP INDEX IF EXISTS idx_agent_connectors_protocol;
DROP INDEX IF EXISTS uq_agent_connectors_system_code;
DROP INDEX IF EXISTS uq_agent_connectors_user_code;
DROP TABLE IF EXISTS agent_connectors;
