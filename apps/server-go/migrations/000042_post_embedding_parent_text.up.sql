-- ref: parent_child chunker（follow-up to 000041）
--
-- parent_child 策略：post 切成 child(小, 高精度) + parent(大, 高上下文)。
-- child 嵌入用于召回，parent 文本召回时回显给 RAG / UI 提供完整上下文。
-- 其他 chunker_kind（recursive/fixed/markdown/qa）下该列为 NULL。
--
-- 不破坏存量数据：纯加列，可空，无默认填充。
-- ADD COLUMN IF NOT EXISTS 在 PG 17 上是 instant DDL（不重写表），
-- 即使 post_embeddings 已经有几百万行也不会触发长锁。

ALTER TABLE post_embeddings
    ADD COLUMN IF NOT EXISTS parent_text TEXT;

COMMENT ON COLUMN post_embeddings.parent_text IS
    'parent_child chunker 策略下的父段原文。child 命中后用 parent_text 提供完整上下文；'
    '其他策略 NULL。父段长度由 search_profiles.chunk_size_tokens × 4 经验值决定，'
    '在 chunker.py 的 _split_parent_child 实现里固化。';
