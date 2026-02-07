-- ============================================================
-- Fix AI Model Type Constraint
-- ============================================================
-- Add missing model types (stt, realtime, text2video, text2music) to the
-- chk_ai_model_type constraint. This fixes the error when inserting
-- models like whisper-1 (stt type) fetched from remote providers.
-- ============================================================

-- Drop the existing constraint and recreate with all model types
DO $$
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_ai_model_type'
          AND conrelid = 'ai_models'::regclass
    ) THEN
        ALTER TABLE ai_models DROP CONSTRAINT chk_ai_model_type;
    END IF;

    -- Add updated constraint with all model types
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
                'text2music',
                'code',
                'completion'
            )
        );
END $$;
