-- 添加文章置顶优先级字段
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pin_priority INTEGER NOT NULL DEFAULT 0;

-- 添加索引以优化置顶文章查询
CREATE INDEX IF NOT EXISTS idx_posts_pin_priority ON posts(pin_priority DESC, published_at DESC);

-- 更新注释
COMMENT ON COLUMN posts.pin_priority IS '置顶优先级 (数值越大优先级越高，0表示不置顶)';
