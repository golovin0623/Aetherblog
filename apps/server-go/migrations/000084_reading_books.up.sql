-- 000084_reading_books.up.sql
-- 拟真阅读（Simulated Reading）模块：把文章 / 学习笔记 / 知识库文件预处理成
-- 一份「已转换的成书格式」（预渲染、已净化的 HTML + 目录），落库缓存。
-- 之后前台 3D 翻书阅读器直接读取该缓存，无需重新解析 Markdown / 重新渲染。
--
-- 幂等：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS（遵循 §3.8 铁律）。

CREATE TABLE IF NOT EXISTS reading_books (
    id            BIGSERIAL PRIMARY KEY,
    slug          VARCHAR(160) NOT NULL UNIQUE,
    title         VARCHAR(300) NOT NULL,
    author        VARCHAR(160),
    cover_image   VARCHAR(500),
    -- 来源类型：POST（文章）/ NOTE（学习笔记）/ KB_FILE（知识库文件）
    source_type   VARCHAR(20)  NOT NULL,
    source_id     BIGINT       NOT NULL,
    -- 来源附加引用（例如知识库 slug / 名称），用于后台展示
    source_ref    VARCHAR(200),
    -- 预渲染并净化后的成书 HTML（即「转换后的格式文件」缓存）
    content_html  TEXT,
    -- 章节目录：[{ "id": "...", "text": "...", "level": 2 }]
    toc           JSONB        NOT NULL DEFAULT '[]'::jsonb,
    word_count    INT          NOT NULL DEFAULT 0,
    reading_time  INT          NOT NULL DEFAULT 0,
    -- 处理状态：PENDING（待生成）/ READY（已就绪可直接打开）/ FAILED（生成失败）
    status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    error         TEXT,
    -- 阅读器主题样式：paper / sepia / night
    theme         VARCHAR(20)  NOT NULL DEFAULT 'paper',
    created_by    BIGINT,
    generated_at  TIMESTAMP,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 同一来源最多生成一本书（重新导入即更新该行）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_reading_books_source
    ON reading_books (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_reading_books_status
    ON reading_books (status);

CREATE INDEX IF NOT EXISTS idx_reading_books_created_at
    ON reading_books (created_at DESC);
