DELETE FROM ai_task_routing
WHERE task_type_id IN (
    SELECT id FROM ai_task_types WHERE code IN ('atlas_claims', 'atlas_relations')
);

DELETE FROM ai_task_types
WHERE code IN ('atlas_claims', 'atlas_relations');
