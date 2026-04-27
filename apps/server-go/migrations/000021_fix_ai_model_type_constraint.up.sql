-- ============================================================
-- 修复 AI Model Type 约束
-- ============================================================
-- 向 chk_ai_model_type constraint 补齐缺失的 model type（stt、realtime、
-- text2video、text2music）。修复从远程 provider 拉取并插入 whisper-1
-- 等 stt 类型模型时报错的问题。
-- ============================================================

-- 删除旧 constraint，按完整 model type 列表重建
DO $$
BEGIN
    -- 若已存在则删除旧 constraint
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_ai_model_type'
          AND conrelid = 'ai_models'::regclass
    ) THEN
        ALTER TABLE ai_models DROP CONSTRAINT chk_ai_model_type;
    END IF;

    -- 按完整 model type 列表重新添加 constraint
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
