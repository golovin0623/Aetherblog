-- ============================================================
-- Fix AI Model Type Constraint
-- Add support for tts, stt, reasoning and other model types
-- ref: §5.1
-- ============================================================
-- Author: AetherBlog Team
-- Date: 2026-02-05
-- ============================================================

-- 1. Drop existing constraint if it exists
ALTER TABLE ai_models DROP CONSTRAINT IF EXISTS chk_ai_model_type;

-- 2. Add updated constraint with full list of types
ALTER TABLE ai_models ADD CONSTRAINT chk_ai_model_type CHECK (
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
