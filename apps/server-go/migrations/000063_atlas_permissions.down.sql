-- 回滚 000063: 移除 Atlas 权限码与 ADMIN 绑定。

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE code IN (
        'content.atlas.read', 'content.atlas.write', 'content.atlas.admin'
    )
);

DELETE FROM permissions WHERE code IN (
    'content.atlas.read', 'content.atlas.write', 'content.atlas.admin'
);
