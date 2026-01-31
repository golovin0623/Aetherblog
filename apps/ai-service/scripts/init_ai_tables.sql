-- ============================================================
-- AI Provider Configuration Tables
-- ============================================================
-- Run this script in the aetherblog database to create AI config tables
-- Author: AetherBlog Team
-- Date: 2026-01-29
-- ============================================================

-- ============================================================
-- PART 1: AI Providers
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_providers (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(100),
    api_type VARCHAR(30) NOT NULL DEFAULT 'openai_compat',
    base_url VARCHAR(500),
    doc_url VARCHAR(500),
    icon VARCHAR(200),
    is_enabled BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 0,
    capabilities JSONB DEFAULT '{}',
    config_schema JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_ai_provider_api_type CHECK (
        api_type IN ('openai_compat', 'anthropic', 'google', 'azure', 'custom')
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_code ON ai_providers(code);
CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled ON ai_providers(is_enabled);

-- ============================================================
-- PART 2: AI Models
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_models (
    id BIGSERIAL PRIMARY KEY,
    provider_id BIGINT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    model_id VARCHAR(100) NOT NULL,
    display_name VARCHAR(100),
    model_type VARCHAR(30) NOT NULL DEFAULT 'chat',
    context_window INT,
    max_output_tokens INT,
    input_cost_per_1k DECIMAL(12, 8),
    output_cost_per_1k DECIMAL(12, 8),
    capabilities JSONB DEFAULT '{}',
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(provider_id, model_id),
    CONSTRAINT chk_ai_model_type CHECK (
        model_type IN (
            'chat',
            'embedding',
            'image',
            'audio',
            'reasoning',
            'tts',
            'stt',
            'realtime',
            'text2video',
            'text2music'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_type ON ai_models(model_type);
CREATE INDEX IF NOT EXISTS idx_ai_models_enabled ON ai_models(is_enabled);

-- ============================================================
-- PART 3: AI Credentials
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_credentials (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    provider_id BIGINT NOT NULL REFERENCES ai_providers(id),
    name VARCHAR(100),
    api_key_encrypted TEXT NOT NULL,
    api_key_hint VARCHAR(20),
    base_url_override VARCHAR(500),
    extra_config JSONB DEFAULT '{}',
    is_default BOOLEAN DEFAULT FALSE,
    is_enabled BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_credentials_user ON ai_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_credentials_provider ON ai_credentials(provider_id);

-- ============================================================
-- PART 4: AI Task Types
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_task_types (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    default_model_type VARCHAR(30) DEFAULT 'chat',
    default_temperature DECIMAL(3, 2) DEFAULT 0.7,
    default_max_tokens INT,
    config_schema JSONB,
    prompt_template TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- PART 5: AI Task Routing
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_task_routing (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    task_type_id BIGINT NOT NULL REFERENCES ai_task_types(id),
    primary_model_id BIGINT REFERENCES ai_models(id),
    fallback_model_id BIGINT REFERENCES ai_models(id),
    credential_id BIGINT REFERENCES ai_credentials(id),
    config_override JSONB DEFAULT '{}',
    prompt_template TEXT,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_task_routing_user ON ai_task_routing(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_task_routing_task ON ai_task_routing(task_type_id);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_ai_task_routing_user_task'
    ) THEN
        ALTER TABLE ai_task_routing
            ADD CONSTRAINT uq_ai_task_routing_user_task UNIQUE NULLS NOT DISTINCT (user_id, task_type_id);
    END IF;
END $$;

-- ============================================================
-- PART 6: Triggers for updated_at
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_providers_updated_at') THEN
        CREATE TRIGGER update_ai_providers_updated_at 
            BEFORE UPDATE ON ai_providers 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_models_updated_at') THEN
        CREATE TRIGGER update_ai_models_updated_at 
            BEFORE UPDATE ON ai_models 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_credentials_updated_at') THEN
        CREATE TRIGGER update_ai_credentials_updated_at 
            BEFORE UPDATE ON ai_credentials 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_task_routing_updated_at') THEN
        CREATE TRIGGER update_ai_task_routing_updated_at 
            BEFORE UPDATE ON ai_task_routing 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ============================================================
-- PART 7: Seed Data
-- ============================================================

-- Insert default providers
INSERT INTO ai_providers (code, name, display_name, api_type, base_url, doc_url, capabilities, priority) VALUES
    ('openai', 'OpenAI', 'OpenAI', 'openai_compat', 'https://api.openai.com/v1', 'https://platform.openai.com/docs',
     '{"chat": true, "embedding": true, "vision": true, "function_call": true}', 100),
    ('deepseek', 'DeepSeek', 'DeepSeek AI', 'openai_compat', 'https://api.deepseek.com/v1', 'https://platform.deepseek.com/docs',
     '{"chat": true, "embedding": false, "vision": false, "function_call": true, "reasoning": true}', 95),
    ('qwen', 'Aliyun Qwen', '通义千问', 'openai_compat', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://help.aliyun.com/zh/model-studio/',
     '{"chat": true, "embedding": true, "vision": true, "function_call": true}', 90),
    ('anthropic', 'Anthropic', 'Claude', 'anthropic', 'https://api.anthropic.com', 'https://docs.anthropic.com/',
     '{"chat": true, "embedding": false, "vision": true, "function_call": true}', 85),
    ('openai_compat', 'OpenAI Compatible', '兼容接口', 'openai_compat', NULL, NULL,
     '{"chat": true, "embedding": true}', 50)
ON CONFLICT (code) DO NOTHING;

-- Insert models
INSERT INTO ai_models (provider_id, model_id, display_name, model_type, context_window, max_output_tokens, input_cost_per_1k, output_cost_per_1k, capabilities) VALUES
    -- OpenAI
    ((SELECT id FROM ai_providers WHERE code = 'openai'), 'gpt-4o', 'GPT-4o', 'chat', 128000, 16384, 0.0025, 0.01, '{"vision": true, "function_call": true}'),
    ((SELECT id FROM ai_providers WHERE code = 'openai'), 'gpt-5-mini', 'GPT-4o Mini', 'chat', 128000, 16384, 0.00015, 0.0006, '{"vision": true, "function_call": true}'),
    ((SELECT id FROM ai_providers WHERE code = 'openai'), 'text-embedding-3-small', 'Embedding 3 Small', 'embedding', 8191, NULL, 0.00002, 0, '{}'),
    ((SELECT id FROM ai_providers WHERE code = 'openai'), 'text-embedding-3-large', 'Embedding 3 Large', 'embedding', 8191, NULL, 0.00013, 0, '{}'),
    -- DeepSeek
    ((SELECT id FROM ai_providers WHERE code = 'deepseek'), 'deepseek-chat', 'DeepSeek V3', 'chat', 64000, 8192, 0.00027, 0.0011, '{"function_call": true}'),
    ((SELECT id FROM ai_providers WHERE code = 'deepseek'), 'deepseek-reasoner', 'DeepSeek R1', 'reasoning', 64000, 8192, 0.00055, 0.00219, '{"reasoning": true}'),
    -- Qwen
    ((SELECT id FROM ai_providers WHERE code = 'qwen'), 'qwen-plus', 'Qwen Plus', 'chat', 131072, 8192, 0.0004, 0.0012, '{"function_call": true}'),
    ((SELECT id FROM ai_providers WHERE code = 'qwen'), 'qwen-turbo', 'Qwen Turbo', 'chat', 131072, 8192, 0.0002, 0.0006, '{}'),
    ((SELECT id FROM ai_providers WHERE code = 'qwen'), 'text-embedding-v3', 'Qwen Embedding V3', 'embedding', 8192, NULL, 0.00007, 0, '{}'),
    -- Anthropic
    ((SELECT id FROM ai_providers WHERE code = 'anthropic'), 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 'chat', 200000, 8192, 0.003, 0.015, '{"vision": true, "function_call": true}'),
    ((SELECT id FROM ai_providers WHERE code = 'anthropic'), 'claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', 'chat', 200000, 8192, 0.0008, 0.004, '{"vision": true, "function_call": true}')
ON CONFLICT (provider_id, model_id) DO NOTHING;

-- Insert task types
INSERT INTO ai_task_types (code, name, description, default_model_type, default_temperature, default_max_tokens, prompt_template) VALUES
    ('summary', '文章摘要', '自动生成文章摘要', 'chat', 0.3, 500, '请为以下内容生成摘要（{max_length}字以内）：\n{content}'),
    ('tags', '标签推荐', '智能推荐文章标签', 'chat', 0.2, 200, '请为以下内容推荐{max_tags}个标签，逗号分隔：\n{content}'),
    ('titles', '标题生成', '生成文章标题建议', 'chat', 0.7, 300, '请为以下内容生成{max_titles}个标题建议，逗号分隔：\n{content}'),
    ('polish', '文章润色', '优化文章内容表达', 'chat', 0.5, 4000, '请根据【{tone}】的语气润色以下内容：\n{content}'),
    ('outline', '大纲生成', '生成文章大纲', 'chat', 0.5, 2000, '请为主题【{topic}】生成层级深度为{depth}的{style}风格大纲。{context}'),
    ('embedding', '向量嵌入', '生成文本向量用于语义搜索', 'embedding', 0, NULL, NULL),
    ('qa', '智能问答', '基于博客内容的问答', 'chat', 0.3, 2000, '你是一个博客助手，请基于以下参考内容回答用户问题：\n\n参考内容：\n{context}\n\n用户问题：{query}')
ON CONFLICT (code) DO UPDATE SET 
    prompt_template = EXCLUDED.prompt_template,
    description = EXCLUDED.description,
    name = EXCLUDED.name;

-- Insert system default routing (user_id = NULL means system default)
INSERT INTO ai_task_routing (user_id, task_type_id, primary_model_id, fallback_model_id, config_override)
SELECT 
    NULL,
    tt.id,
    pm.id,
    fm.id,
    cfg::jsonb
FROM (VALUES
    ('summary', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.3}'),
    ('tags', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.2}'),
    ('titles', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.7}'),
    ('polish', 'gpt-4o', 'deepseek-chat', '{"temperature": 0.5}'),
    ('outline', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.5}'),
    ('embedding', 'text-embedding-3-small', NULL, '{}'),
    ('qa', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.3}')
) AS v(task_code, primary_model, fallback_model, cfg)
JOIN ai_task_types tt ON tt.code = v.task_code
LEFT JOIN ai_models pm ON pm.model_id = v.primary_model
LEFT JOIN ai_models fm ON fm.model_id = v.fallback_model
ON CONFLICT ON CONSTRAINT uq_ai_task_routing_user_task
DO UPDATE SET
    primary_model_id = EXCLUDED.primary_model_id,
    fallback_model_id = EXCLUDED.fallback_model_id,
    config_override = EXCLUDED.config_override,
    is_enabled = TRUE,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================
-- End of Init Script
-- ============================================================
