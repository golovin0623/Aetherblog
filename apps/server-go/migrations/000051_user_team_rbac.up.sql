-- ============================================================
-- User / Team RBAC and Content Sharing
-- ============================================================
-- 目标:
--   1. 在旧 users.role 之外落地可扩展 RBAC。
--   2. 支持团队与团队成员关系。
--   3. 支持文章、媒体文件、媒体文件夹的统一共享授权。
-- ============================================================

CREATE TABLE IF NOT EXISTS permissions (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    module VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_permission_code_nonempty CHECK (btrim(code) <> '')
);

CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);

CREATE TABLE IF NOT EXISTS roles (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 100,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_role_code_nonempty CHECK (btrim(code) <> '')
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

CREATE TABLE IF NOT EXISTS teams (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_teams_visibility CHECK (visibility IN ('PRIVATE', 'INTERNAL', 'PUBLIC')),
    CONSTRAINT chk_teams_name_nonempty CHECK (btrim(name) <> ''),
    CONSTRAINT chk_teams_slug_nonempty CHECK (btrim(slug) <> '')
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_id);
CREATE INDEX IF NOT EXISTS idx_teams_visibility ON teams(visibility);

CREATE TABLE IF NOT EXISTS team_members (
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    added_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id),

    CONSTRAINT chk_team_member_role CHECK (member_role IN ('OWNER', 'MANAGER', 'MEMBER', 'VIEWER')),
    CONSTRAINT chk_team_member_status CHECK (status IN ('ACTIVE', 'INVITED', 'DISABLED'))
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_status ON team_members(status);

CREATE TABLE IF NOT EXISTS content_shares (
    id BIGSERIAL PRIMARY KEY,
    resource_type VARCHAR(20) NOT NULL,
    resource_id BIGINT NOT NULL,
    principal_type VARCHAR(20) NOT NULL,
    principal_id BIGINT NOT NULL,
    permission_level VARCHAR(20) NOT NULL,
    granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_content_share_resource CHECK (resource_type IN ('POST', 'MEDIA_FILE', 'MEDIA_FOLDER')),
    CONSTRAINT chk_content_share_principal CHECK (principal_type IN ('USER', 'TEAM', 'ROLE')),
    CONSTRAINT chk_content_share_permission CHECK (permission_level IN ('VIEW', 'COMMENT', 'EDIT', 'MANAGE')),
    CONSTRAINT uq_content_share UNIQUE (resource_type, resource_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_content_shares_resource ON content_shares(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_content_shares_principal ON content_shares(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_content_shares_expires ON content_shares(expires_at);

INSERT INTO permissions (code, module, action, name, description) VALUES
    ('system.users.view', 'system', 'users.view', '查看用户', '查看用户列表、角色和基础账号状态'),
    ('system.users.manage', 'system', 'users.manage', '管理用户', '创建用户、更新用户、重置密码与分配角色'),
    ('system.roles.manage', 'system', 'roles.manage', '管理角色权限', '查看角色与权限矩阵并维护角色授权'),
    ('system.teams.manage', 'system', 'teams.manage', '管理团队', '创建团队、维护团队成员和团队状态'),
    ('content.posts.manage', 'content', 'posts.manage', '管理文章', '创建、编辑、发布和删除文章'),
    ('content.shares.manage', 'content', 'shares.manage', '管理内容共享', '为用户、团队或角色授予内容访问权限'),
    ('media.library.manage', 'media', 'library.manage', '管理媒体库', '上传、移动、删除媒体文件和维护文件夹权限'),
    ('system.audit.view', 'system', 'audit.view', '查看审计', '查看活动记录与安全审计事件'),
    ('ai.config.manage', 'ai', 'config.manage', '管理 AI 配置', '维护 AI provider、模型、提示词和路由')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    action = EXCLUDED.action,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO roles (code, name, description, is_system, sort_order) VALUES
    ('ADMIN', '系统管理员', '拥有系统全部权限', true, 10),
    ('AUTHOR', '作者', '负责文章与媒体内容生产', true, 20),
    ('USER', '普通用户', '可登录工作台并访问被共享内容', true, 30)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'content.posts.manage',
    'content.shares.manage',
    'media.library.manage'
)
WHERE r.code = 'AUTHOR'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = u.role
ON CONFLICT DO NOTHING;
