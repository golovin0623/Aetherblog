-- 000057: 媒体文件夹增加 is_system / undeletable 标记，并 seed 系统知识库根目录。
--
-- 背景：知识库（knowledge_bases）功能需要把上传的物理文件落到媒体库受控的
-- 隐藏子树 `/root/_system_kb/<kb-slug>/<yyyy>/<mm>/<dd>/`。这些目录复用 media_files
-- 全套存储/分享/版本能力，但在媒体页 / 文件夹树中必须不可见，避免污染用户视图。
--
-- 设计：
--   * is_system     —— 应用层过滤的硬开关。所有面向 /media UI 的 list/tree 查询
--                     默认追加 `WHERE is_system = FALSE`；KB 内部调用显式 includeSystem
--                     才能读到这些目录。
--   * undeletable   —— 防呆开关。系统目录与根目录都设置为 TRUE，DELETE 操作要先
--                     检查；前端管理 UI 不渲染删除按钮。
--   * /root/_system_kb 系统目录在本 migration 一次性 seed，避免运行期再判断"是否
--                     已存在"。后续 KB 创建只在该目录下挂子目录。
--
-- 兼容性：纯加列 + 一次 seed。ADD COLUMN IF NOT EXISTS / NOT NULL DEFAULT FALSE
-- 在 PG 17 上是 instant DDL（不重写表），即使 media_folders 已有万级行也不会触发长锁。

ALTER TABLE media_folders
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS undeletable BOOLEAN NOT NULL DEFAULT FALSE;

-- 生产漂移防护：
--   1) 旧库可能没有 uq_folder_path 约束，但 path 语义仍应唯一；补齐后下面
--      ON CONFLICT (path) 才能稳定工作。
--   2) 不再硬编码 root id=1。生产库可能因历史导入/手工修复导致 /root 的 id
--      不是 1；按 path 定位 root，避免重放 000057 时 parent_id=1 触发 FK 23503。
CREATE UNIQUE INDEX IF NOT EXISTS uq_folder_path ON media_folders(path);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM media_folders WHERE path = '/root') THEN
        INSERT INTO media_folders (
            name, slug, path, depth, sort_order, visibility, is_system, undeletable
        )
        VALUES ('Root', 'root', '/root', 0, 0, 'PRIVATE', FALSE, TRUE);
    END IF;
END $$;

UPDATE media_folders
SET is_system = FALSE, undeletable = TRUE
WHERE path = '/root';

-- 系统 KB 根目录。parent_id 指向 path=/root 的实际 id，path/depth 与 000007 的根命名风格对齐。
WITH root_folder AS (
    SELECT id
    FROM media_folders
    WHERE path = '/root'
    ORDER BY id
    LIMIT 1
)
INSERT INTO media_folders (
    name, slug, path, depth, sort_order, visibility, is_system, undeletable, parent_id
)
SELECT
    '_system_kb', '_system_kb', '/root/_system_kb', 1, 9999, 'PRIVATE', TRUE, TRUE, root_folder.id
FROM root_folder
ON CONFLICT (path) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    depth = EXCLUDED.depth,
    sort_order = EXCLUDED.sort_order,
    visibility = EXCLUDED.visibility,
    is_system = TRUE,
    undeletable = TRUE,
    parent_id = EXCLUDED.parent_id;

CREATE INDEX IF NOT EXISTS idx_media_folders_is_system ON media_folders(is_system);

COMMENT ON COLUMN media_folders.is_system IS
    '系统级目录标记。媒体库 UI 默认过滤掉 is_system=TRUE 的目录；只有 KB 等内部模块通过显式 flag 访问。';
COMMENT ON COLUMN media_folders.undeletable IS
    '防呆删除保护。TRUE 表示该目录禁止任何 DELETE，应用层与 SQL 触发器各自校验一遍。';
