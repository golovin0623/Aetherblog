-- ref: fix/search-active-embedding-sync-2026-04-19 · 修复孤儿 active_embedding_model
--
-- 背景:
--   000034 / 000036 seed `site_settings.search.active_embedding_model` 时使用
--       COALESCE((SELECT ... FROM post_embeddings ... LIMIT 1), 'text-embedding-3-small')
--   在 post_embeddings 为空的新部署上, seed 会落到兜底字符串 'text-embedding-3-small'.
--   但该字符串与 `ai_task_routing.embedding` 里管理员实际配置的模型(通常是
--   text-embedding-3-large)无关——结果就是:
--     · semantic_search 过滤 `model_id=active_embedding_model AND status='active'`
--       永远匹配不到任何 post_embeddings 行 → 语义搜索永远返回空
--     · admin SearchConfig 顶部显示 'text-embedding-3-small' (stale),
--       底部显示 'text-embedding-3-large' (ai_task_routing), 用户看到两值背离
--
-- 修复策略(蓝绿安全):
--   指针只应指向 post_embeddings 里**当前有 active 行**的模型, 这是语义搜索
--   零空窗的前提. 对当前 setting_value 不满足这条不变量的部署:
--     1) 若 post_embeddings 里存在任何 active 行 → 把指针对齐到行数最多的那个
--        model_id (最可能是管理员最近一次成功 reindex 的目标模型)
--     2) 若 post_embeddings 完全没有 active 行 → 把 setting_value 清空
--        (ai-service `_get_active_embedding_model` 读到空会 fallback 到 llm_router,
--         Go `GetDiagnostics` 会标 source='unset' + note='请运行全量重建索引')
--
-- 幂等性:
--   · 已经对齐的部署: WHERE 过滤掉, 不改写
--   · 新部署(000034/000036 刚建好, post_embeddings 空): 会把 seed 的
--     'text-embedding-3-small' 清成空串, 让 ai-service 正确走 fallback
--   · 已经正常跑过一轮 reindex 的部署: setting_value 必然匹配某个 active 行,
--     WHERE 过滤掉不改写

UPDATE site_settings
SET setting_value = COALESCE(
        (SELECT model_id
           FROM post_embeddings
          WHERE status = 'active'
          GROUP BY model_id
          ORDER BY COUNT(*) DESC
          LIMIT 1),
        ''
    ),
    updated_at = NOW()
WHERE setting_key = 'search.active_embedding_model'
  AND NOT EXISTS (
      SELECT 1 FROM post_embeddings pe
       WHERE pe.model_id = site_settings.setting_value
         AND pe.status = 'active'
      LIMIT 1
  );
