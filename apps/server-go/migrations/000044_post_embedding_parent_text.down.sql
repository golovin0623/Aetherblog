-- 回滚 000044：删除 parent_text 列。
-- parent_child 策略下的索引数据会同时丢失父段上下文；如需保留，先迁出再 down。

ALTER TABLE post_embeddings DROP COLUMN IF EXISTS parent_text;
