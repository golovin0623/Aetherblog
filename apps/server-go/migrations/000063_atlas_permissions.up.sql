-- 000063: Atlas 权限码 seed
--
-- 在 RBAC 体系中注册 Atlas 子产品的权限命名空间。沿用 000054 / 000058 的 INSERT...ON CONFLICT 模式。
--
-- 权限语义:
--   content.atlas.read   读载体/标注/KP/关系（不含管理）
--   content.atlas.write  创建/编辑/删除自己的载体/标注/KP/关系
--   content.atlas.admin  管理任意用户的 Atlas 数据 + 删除任意 KP/Relation
--
-- 默认绑定：ADMIN 角色拥有全部 3 个权限；普通用户角色在 Phase 1 通过 admin UI 按需授权。

INSERT INTO permissions (code, module, action, name, description) VALUES
    ('content.atlas.read', 'content', 'atlas.read', 'Atlas 读权限',
     '读取自有及共享载体、标注、知识点、关系'),
    ('content.atlas.write', 'content', 'atlas.write', 'Atlas 写权限',
     '创建、编辑、删除自有载体、标注、知识点、关系；接受/拒绝 AI 建议'),
    ('content.atlas.admin', 'content', 'atlas.admin', 'Atlas 管理权限',
     '管理任意用户的 Atlas 数据；删除任意知识点和关系；调整可见性')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    action = EXCLUDED.action,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- 把 3 个权限授给 ADMIN 角色
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('content.atlas.read', 'content.atlas.write', 'content.atlas.admin')
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;
