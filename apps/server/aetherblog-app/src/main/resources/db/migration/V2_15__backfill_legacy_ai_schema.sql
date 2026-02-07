-- ============================================================
-- Backfill legacy AI schema to match current ai-service queries
-- ============================================================

-- ------------------------------------------------------------
-- ai_providers: add columns expected by ai-service
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS api_type VARCHAR(30) DEFAULT 'openai_compat';
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS base_url VARCHAR(500);
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS doc_url VARCHAR(500);
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS icon VARCHAR(200);
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS priority INT DEFAULT 0;
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS config_schema JSONB;
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE IF EXISTS ai_providers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ai_providers'
          AND column_name = 'api_base_url'
    ) THEN
        EXECUTE 'UPDATE ai_providers SET base_url = COALESCE(base_url, api_base_url)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ai_providers'
          AND column_name = 'sort_order'
    ) THEN
        EXECUTE 'UPDATE ai_providers SET priority = COALESCE(priority, sort_order)';
    END IF;
END $$;

UPDATE ai_providers
SET display_name = COALESCE(display_name, name)
WHERE display_name IS NULL;

UPDATE ai_providers
SET api_type = CASE
    WHEN code = 'anthropic' THEN 'anthropic'
    WHEN code = 'google' THEN 'google'
    WHEN code = 'azure' THEN 'azure'
    ELSE 'openai_compat'
END
WHERE api_type IS NULL OR btrim(api_type) = '';

UPDATE ai_providers
SET capabilities = '{}'::jsonb
WHERE capabilities IS NULL;

UPDATE ai_providers
SET priority = 0
WHERE priority IS NULL;

UPDATE ai_providers
SET created_at = CURRENT_TIMESTAMP
WHERE created_at IS NULL;

UPDATE ai_providers
SET updated_at = CURRENT_TIMESTAMP
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_providers_code ON ai_providers(code);
CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled ON ai_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_ai_providers_priority ON ai_providers(priority DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_ai_provider_api_type'
          AND conrelid = 'ai_providers'::regclass
    ) THEN
        ALTER TABLE ai_providers
            ADD CONSTRAINT chk_ai_provider_api_type CHECK (
                api_type IN ('openai_compat', 'anthropic', 'google', 'azure', 'custom')
            );
    END IF;
END $$;

-- ------------------------------------------------------------
-- ai_models: add columns expected by ai-service
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS ai_models ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN;
ALTER TABLE IF EXISTS ai_models ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE IF EXISTS ai_models ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE IF EXISTS ai_models ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ai_models'
          AND column_name = 'is_available'
    ) THEN
        EXECUTE 'UPDATE ai_models SET is_enabled = COALESCE(is_enabled, is_available, TRUE)';
    ELSE
        EXECUTE 'UPDATE ai_models SET is_enabled = COALESCE(is_enabled, TRUE)';
    END IF;
END $$;

UPDATE ai_models
SET capabilities = '{}'::jsonb
WHERE capabilities IS NULL;

UPDATE ai_models
SET created_at = CURRENT_TIMESTAMP
WHERE created_at IS NULL;

UPDATE ai_models
SET updated_at = CURRENT_TIMESTAMP
WHERE updated_at IS NULL;

ALTER TABLE ai_models ALTER COLUMN is_enabled SET DEFAULT TRUE;
ALTER TABLE ai_models ALTER COLUMN capabilities SET DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_type ON ai_models(model_type);
CREATE INDEX IF NOT EXISTS idx_ai_models_enabled ON ai_models(is_enabled);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_ai_models_provider_model'
          AND conrelid = 'ai_models'::regclass
    ) THEN
        ALTER TABLE ai_models
            ADD CONSTRAINT uq_ai_models_provider_model UNIQUE (provider_id, model_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_ai_model_type'
          AND conrelid = 'ai_models'::regclass
    ) THEN
        ALTER TABLE ai_models
            ADD CONSTRAINT chk_ai_model_type CHECK (
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
            );
    END IF;
END $$;

-- ------------------------------------------------------------
-- Missing tables on legacy databases
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_credentials (
    id SERIAL PRIMARY KEY,
    user_id BIGINT,
    provider_id BIGINT NOT NULL,
    name VARCHAR(100),
    api_key_encrypted TEXT NOT NULL,
    api_key_hint VARCHAR(20),
    base_url_override VARCHAR(500),
    extra_config JSONB DEFAULT '{}'::jsonb,
    is_default BOOLEAN DEFAULT FALSE,
    is_enabled BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_task_types (
    id SERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS ai_task_routing (
    id SERIAL PRIMARY KEY,
    user_id BIGINT,
    task_type_id BIGINT NOT NULL,
    primary_model_id BIGINT,
    fallback_model_id BIGINT,
    credential_id BIGINT,
    config_override JSONB DEFAULT '{}'::jsonb,
    prompt_template TEXT,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_credentials_user ON ai_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_credentials_provider ON ai_credentials(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_task_routing_user ON ai_task_routing(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_task_routing_task ON ai_task_routing(task_type_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_ai_task_routing_user_task'
          AND conrelid = 'ai_task_routing'::regclass
    ) THEN
        ALTER TABLE ai_task_routing
            ADD CONSTRAINT uq_ai_task_routing_user_task UNIQUE NULLS NOT DISTINCT (user_id, task_type_id);
    END IF;
END $$;

-- ------------------------------------------------------------
-- updated_at triggers
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_providers')
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_providers_updated_at') THEN
        CREATE TRIGGER update_ai_providers_updated_at
            BEFORE UPDATE ON ai_providers
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_models')
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_models_updated_at') THEN
        CREATE TRIGGER update_ai_models_updated_at
            BEFORE UPDATE ON ai_models
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_credentials')
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_credentials_updated_at') THEN
        CREATE TRIGGER update_ai_credentials_updated_at
            BEFORE UPDATE ON ai_credentials
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_task_routing')
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_task_routing_updated_at') THEN
        CREATE TRIGGER update_ai_task_routing_updated_at
            BEFORE UPDATE ON ai_task_routing
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
