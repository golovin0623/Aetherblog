-- 回滚 000057：把 kb_embeddings.embedding 回滚为 vector(3072)。
--
-- 若表中已有非 3072 维度的行，ALTER 会失败。先把那些行清掉再降级。

DELETE FROM kb_embeddings WHERE embedding_dim <> 3072;

ALTER TABLE kb_embeddings
    ALTER COLUMN embedding TYPE vector(3072) USING embedding::vector(3072);
