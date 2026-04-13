-- 搜索配置：使用 site_settings 存储搜索相关开关和限流参数
-- ref: 搜索功能落地方案 v2 Phase 0

INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES
    ('search.keyword_enabled', 'true', 'BOOLEAN', 'search', '关键词搜索开关'),
    ('search.semantic_enabled', 'false', 'BOOLEAN', 'search', '语义搜索开关（需先配置向量化模型）'),
    ('search.ai_qa_enabled', 'false', 'BOOLEAN', 'search', 'AI 问答开关（需向量化模型 + QA 路由就绪）'),
    ('search.anon_search_rate_per_min', '10', 'NUMBER', 'search', '匿名用户每分钟搜索次数限制'),
    ('search.anon_qa_rate_per_min', '3', 'NUMBER', 'search', '匿名用户每分钟 AI 问答次数限制'),
    ('search.auto_index_on_publish', 'true', 'BOOLEAN', 'search', '文章发布或更新时自动生成向量索引')
ON CONFLICT (setting_key) DO NOTHING;
