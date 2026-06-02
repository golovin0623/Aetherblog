-- ============================================================
-- Seed Atlas AI task types and inherit default chat routing.
-- ============================================================

INSERT INTO ai_task_types (
    code,
    name,
    description,
    default_model_type,
    default_temperature,
    default_max_tokens,
    prompt_template
) VALUES
    (
        'atlas_claims',
        'Atlas 知识点抽取',
        '从 Atlas carrier / annotation 文本中抽取可入 Inbox 的结构化知识点候选',
        'chat',
        0.2,
        900,
$prompt$You extract grounded Knowledge Atlas candidates from the provided text.

Return only one JSON object with this exact shape:
{"candidates":[{"title":"short claim title","body":"grounded body copied or paraphrased from text","type":"claim|concept|question|definition|method|example|person|source","confidence":0.0,"rationale":"why this is grounded"}]}

Rules:
- Do not invent facts outside the text.
- Prefer concrete claims, definitions, methods, examples, and questions.
- Keep title concise.
- Use only the allowed type values.
- Return at most {max_candidates} candidates.

Text:
{content}$prompt$
    ),
    (
        'atlas_relations',
        'Atlas 关系建议',
        '为两条 Atlas knowledge points 生成一条可解释的 typed relation 候选',
        'chat',
        0.2,
        500,
$prompt$You choose one typed Knowledge Atlas relation between two knowledge points.

Return only one JSON object with this exact shape:
{"relation_type":"supports|refutes|specializes|generalizes|precedes|causes|similar_to|cites|instance_of","strength":0.0,"rationale":"grounded explanation"}

Rules:
- Choose exactly one relation_type from the allowed list.
- Use strength between 0 and 1.
- Do not invent facts.
- If the evidence is weak but the two points are related, use "cites" or "similar_to".

From KP #{from_kp_id}:
{from_text}

To KP #{to_kp_id}:
{to_text}$prompt$
    )
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    default_model_type = EXCLUDED.default_model_type,
    default_temperature = EXCLUDED.default_temperature,
    default_max_tokens = EXCLUDED.default_max_tokens,
    prompt_template = EXCLUDED.prompt_template;

-- Inherit the site's existing system chat routing instead of hard-coding a
-- provider/model. This keeps Atlas aligned with admin-configured defaults while
-- still making a fresh deployment route Atlas tasks without manual SQL.
INSERT INTO ai_task_routing (
    user_id,
    task_type_id,
    primary_model_id,
    fallback_model_id,
    credential_id,
    config_override,
    prompt_template,
    is_enabled
)
SELECT
    NULL,
    dst.id,
    COALESCE(src_route.primary_model_id, default_chat_model.id),
    src_route.fallback_model_id,
    src_route.credential_id,
    COALESCE(src_route.config_override, '{}'::jsonb) || inherited.override_config,
    NULL,
    TRUE
FROM (
    VALUES
        ('atlas_claims', 'summary', '{"temperature": 0.2, "max_tokens": 900}'::jsonb),
        ('atlas_relations', 'qa', '{"temperature": 0.2, "max_tokens": 500}'::jsonb)
) AS inherited(task_code, source_task_code, override_config)
JOIN ai_task_types dst ON dst.code = inherited.task_code
LEFT JOIN ai_task_types src_task ON src_task.code = inherited.source_task_code
LEFT JOIN ai_task_routing src_route
    ON src_route.task_type_id = src_task.id
   AND src_route.user_id IS NULL
   AND src_route.is_enabled = TRUE
CROSS JOIN LATERAL (
    SELECT m.id
    FROM ai_models m
    JOIN ai_providers p ON p.id = m.provider_id
    WHERE m.is_enabled = TRUE
      AND p.is_enabled = TRUE
      AND m.model_type IN ('chat', 'reasoning', 'completion', 'code')
    ORDER BY p.priority DESC, m.id ASC
    LIMIT 1
) default_chat_model
WHERE COALESCE(src_route.primary_model_id, default_chat_model.id) IS NOT NULL
ON CONFLICT ON CONSTRAINT uq_ai_task_routing_user_task
DO NOTHING;
