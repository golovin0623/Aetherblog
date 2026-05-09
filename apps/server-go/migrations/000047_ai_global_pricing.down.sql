-- 回滚 000047：删除全局模型价格表
DROP INDEX IF EXISTS idx_ai_global_pricing_model_id;
DROP TABLE IF EXISTS ai_global_pricing;
