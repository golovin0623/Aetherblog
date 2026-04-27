-- ============================================================
-- 将基础 AI 模型升级为 gpt-5-mini
-- ref: §5.1
-- ============================================================
-- 作者：AetherBlog 团队
-- 日期：2026-02-01
-- ============================================================

-- 1. 若 gpt-5-mini 不存在则插入
INSERT INTO ai_models (provider_id, model_id, display_name, model_type, context_window, max_output_tokens, input_cost_per_1k, output_cost_per_1k, capabilities)
SELECT 
    id, 'gpt-5-mini', 'GPT-5 Mini', 'chat', 128000, 16384, 0.00015, 0.0006, '{"vision": true, "function_call": true}'
FROM ai_providers 
WHERE code = 'openai'
ON CONFLICT (provider_id, model_id) DO NOTHING;

-- 2. 更新 task routing：将 gpt-4o-mini 替换为 gpt-5-mini
DO $$
DECLARE
    v_gpt5_id BIGINT;
    v_gpt4o_mini_id BIGINT;
BEGIN
    SELECT id INTO v_gpt5_id FROM ai_models WHERE model_id = 'gpt-5-mini' AND provider_id = (SELECT id FROM ai_providers WHERE code = 'openai');
    SELECT id INTO v_gpt4o_mini_id FROM ai_models WHERE model_id = 'gpt-4o-mini' AND provider_id = (SELECT id FROM ai_providers WHERE code = 'openai');

    IF v_gpt5_id IS NOT NULL AND v_gpt4o_mini_id IS NOT NULL THEN
        -- 更新主模型
        UPDATE ai_task_routing
        SET primary_model_id = v_gpt5_id
        WHERE primary_model_id = v_gpt4o_mini_id;

        -- 更新 fallback 模型
        UPDATE ai_task_routing 
        SET fallback_model_id = v_gpt5_id 
        WHERE fallback_model_id = v_gpt4o_mini_id;
    END IF;
END $$;
