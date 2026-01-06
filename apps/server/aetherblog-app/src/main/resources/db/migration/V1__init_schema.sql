-- ============================================================
-- AetherBlog Complete Schema
-- ============================================================
-- Flyway Migration: V1__init_schema.sql
-- Author: AetherBlog Team
-- Date: 2026-01-06
-- Description: 完整的企业级数据库架构，与设计文档 §2.5 完全对齐
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SECTION 1: 用户与认证
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50),
    avatar VARCHAR(500),
    bio TEXT,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    last_login_at TIMESTAMP,
    last_login_ip VARCHAR(50),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_users_role CHECK (role IN ('ADMIN', 'AUTHOR', 'USER')),
    CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'BANNED'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================================
-- SECTION 2: 博客内容核心
-- ============================================================

-- 分类表
CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    cover_image VARCHAR(500),
    icon VARCHAR(100),
    parent_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    sort_order INT NOT NULL DEFAULT 0,
    post_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);

-- 标签表
CREATE TABLE IF NOT EXISTS tags (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    color VARCHAR(20) DEFAULT '#6366f1',
    post_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
CREATE INDEX IF NOT EXISTS idx_tags_post_count ON tags(post_count DESC);

-- 文章表 (核心表)
CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL UNIQUE,
    content_markdown TEXT,
    content_html TEXT,
    summary VARCHAR(500),
    cover_image VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    view_count BIGINT NOT NULL DEFAULT 0,
    comment_count BIGINT NOT NULL DEFAULT 0,
    like_count BIGINT NOT NULL DEFAULT 0,
    word_count INT DEFAULT 0,
    reading_time INT DEFAULT 0,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    allow_comment BOOLEAN NOT NULL DEFAULT TRUE,
    password VARCHAR(100),
    seo_title VARCHAR(200),
    seo_description VARCHAR(300),
    seo_keywords VARCHAR(200),
    embedding_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    scheduled_at TIMESTAMP,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_posts_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'SCHEDULED')),
    CONSTRAINT chk_posts_embedding_status CHECK (embedding_status IN ('PENDING', 'INDEXED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted);
CREATE INDEX IF NOT EXISTS idx_posts_embedding_status ON posts(embedding_status);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts(is_pinned DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_fulltext ON posts USING gin(to_tsvector('simple', title || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content_markdown, '')));

-- 文章标签关联表
CREATE TABLE IF NOT EXISTS post_tags (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);

-- ============================================================
-- SECTION 3: 评论系统
-- ============================================================

CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    parent_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    nickname VARCHAR(50) NOT NULL,
    email VARCHAR(100),
    website VARCHAR(200),
    avatar VARCHAR(200),
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ip VARCHAR(50),
    user_agent VARCHAR(500),
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    like_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_comments_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SPAM'))
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at DESC);

-- ============================================================
-- SECTION 4: 友情链接
-- ============================================================

CREATE TABLE IF NOT EXISTS friend_links (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    logo VARCHAR(500),
    description VARCHAR(500),
    email VARCHAR(100),
    rss_url VARCHAR(500),
    theme_color VARCHAR(20) DEFAULT '#6366f1',
    is_online BOOLEAN DEFAULT TRUE,
    last_check_at TIMESTAMP,
    sort_order INT NOT NULL DEFAULT 0,
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_friend_links_visible ON friend_links(visible);
CREATE INDEX IF NOT EXISTS idx_friend_links_sort ON friend_links(sort_order);

-- ============================================================
-- SECTION 5: 站点设置
-- ============================================================

CREATE TABLE IF NOT EXISTS site_settings (
    id BIGSERIAL PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT,
    setting_type VARCHAR(20) NOT NULL DEFAULT 'STRING',
    description VARCHAR(500),
    group_name VARCHAR(50) DEFAULT 'general',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_setting_type CHECK (setting_type IN ('STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'TEXT'))
);

CREATE INDEX IF NOT EXISTS idx_site_settings_key ON site_settings(setting_key);
CREATE INDEX IF NOT EXISTS idx_site_settings_group ON site_settings(group_name);

-- ============================================================
-- SECTION 6: AI 向量存储
-- ============================================================

CREATE TABLE IF NOT EXISTS post_embeddings (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    chunk_content TEXT NOT NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_embeddings_post ON post_embeddings(post_id);
CREATE INDEX IF NOT EXISTS idx_post_embeddings_vector ON post_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ============================================================
-- SECTION 7: Prompt 模板
-- ============================================================

CREATE TABLE IF NOT EXISTS prompt_templates (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500),
    template TEXT NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'CUSTOM',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    usage_count INT NOT NULL DEFAULT 0,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates(category);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_active ON prompt_templates(active);

-- ============================================================
-- SECTION 8: 统计与日志
-- ============================================================

-- 访问记录表
CREATE TABLE IF NOT EXISTS visit_records (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
    page_url VARCHAR(500),
    page_title VARCHAR(200),
    visitor_hash VARCHAR(64) NOT NULL,
    ip VARCHAR(50),
    country VARCHAR(50),
    region VARCHAR(50),
    city VARCHAR(50),
    user_agent VARCHAR(500),
    device_type VARCHAR(20),
    browser VARCHAR(50),
    os VARCHAR(50),
    referer VARCHAR(500),
    session_id VARCHAR(100),
    duration INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_visit_records_post ON visit_records(post_id);
CREATE INDEX IF NOT EXISTS idx_visit_records_visitor ON visit_records(visitor_hash);
CREATE INDEX IF NOT EXISTS idx_visit_records_created ON visit_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visit_records_date ON visit_records(DATE(created_at));

-- 每日统计汇总表
CREATE TABLE IF NOT EXISTS daily_stats (
    id BIGSERIAL PRIMARY KEY,
    stat_date DATE NOT NULL UNIQUE,
    pv BIGINT NOT NULL DEFAULT 0,
    uv BIGINT NOT NULL DEFAULT 0,
    new_posts INT NOT NULL DEFAULT 0,
    new_comments INT NOT NULL DEFAULT 0,
    post_views JSONB,
    country_stats JSONB,
    device_stats JSONB,
    browser_stats JSONB,
    referer_stats JSONB,
    avg_duration INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date DESC);

-- 操作日志表
CREATE TABLE IF NOT EXISTS sys_operation_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(50),
    module VARCHAR(50) NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    method VARCHAR(10),
    request_url VARCHAR(500),
    request_params TEXT,
    response_data TEXT,
    ip VARCHAR(50),
    user_agent VARCHAR(500),
    cost_time INT,
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_operation_log_status CHECK (status IN ('SUCCESS', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_operation_log_user ON sys_operation_log(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_log_module ON sys_operation_log(module);
CREATE INDEX IF NOT EXISTS idx_operation_log_created ON sys_operation_log(created_at DESC);

-- ============================================================
-- SECTION 9: 媒体文件
-- ============================================================

CREATE TABLE IF NOT EXISTS media_files (
    id BIGSERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    storage_type VARCHAR(20) NOT NULL DEFAULT 'LOCAL',
    width INT,
    height INT,
    uploader_id BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_media_storage_type CHECK (storage_type IN ('LOCAL', 'TENCENT_COS', 'ALIYUN_OSS', 'MINIO', 'AWS_S3'))
);

CREATE INDEX IF NOT EXISTS idx_media_files_uploader ON media_files(uploader_id);
CREATE INDEX IF NOT EXISTS idx_media_files_type ON media_files(mime_type);
CREATE INDEX IF NOT EXISTS idx_media_files_created ON media_files(created_at DESC);

-- 附件表 (文章附件/下载)
CREATE TABLE IF NOT EXISTS attachments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT REFERENCES posts(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    storage_type VARCHAR(20) NOT NULL DEFAULT 'LOCAL',
    storage_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    download_count INT NOT NULL DEFAULT 0,
    encryption_key VARCHAR(100),
    uploader_id BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_attachments_storage_type CHECK (storage_type IN ('LOCAL', 'TENCENT_COS', 'ALIYUN_OSS', 'MINIO', 'AWS_S3'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploader_id);

-- ============================================================
-- SECTION 10: 触发器
-- ============================================================

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tags_updated_at BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_friend_links_updated_at BEFORE UPDATE ON friend_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_site_settings_updated_at BEFORE UPDATE ON site_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_prompt_templates_updated_at BEFORE UPDATE ON prompt_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_daily_stats_updated_at BEFORE UPDATE ON daily_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 分类/标签计数同步触发器
CREATE OR REPLACE FUNCTION update_post_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        IF NEW.status = 'PUBLISHED' AND NEW.deleted = FALSE THEN
            IF NEW.category_id IS NOT NULL THEN
                UPDATE categories SET post_count = (
                    SELECT COUNT(*) FROM posts 
                    WHERE category_id = NEW.category_id AND status = 'PUBLISHED' AND deleted = FALSE
                ) WHERE id = NEW.category_id;
            END IF;
        END IF;
    END IF;
    
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (OLD.status != NEW.status OR OLD.deleted != NEW.deleted)) THEN
        IF OLD.category_id IS NOT NULL THEN
            UPDATE categories SET post_count = (
                SELECT COUNT(*) FROM posts 
                WHERE category_id = OLD.category_id AND status = 'PUBLISHED' AND deleted = FALSE
            ) WHERE id = OLD.category_id;
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_post_counts AFTER INSERT OR UPDATE OR DELETE ON posts FOR EACH ROW EXECUTE FUNCTION update_post_counts();

-- ============================================================
-- SECTION 11: 常用视图
-- ============================================================

CREATE OR REPLACE VIEW v_published_posts AS
SELECT 
    p.*,
    u.username as author_username,
    u.nickname as author_nickname,
    u.avatar as author_avatar,
    c.name as category_name,
    c.slug as category_slug
FROM posts p
LEFT JOIN users u ON p.author_id = u.id
LEFT JOIN categories c ON p.category_id = c.id
WHERE p.status = 'PUBLISHED' AND p.deleted = FALSE;

CREATE OR REPLACE VIEW v_post_archives AS
SELECT 
    EXTRACT(YEAR FROM published_at)::INT as year,
    EXTRACT(MONTH FROM published_at)::INT as month,
    COUNT(*) as post_count
FROM posts
WHERE status = 'PUBLISHED' AND deleted = FALSE
GROUP BY year, month
ORDER BY year DESC, month DESC;

-- ============================================================
-- End of Schema
-- ============================================================
