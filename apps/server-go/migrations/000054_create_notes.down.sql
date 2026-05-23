DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'content.notes.manage');

DELETE FROM permissions WHERE code = 'content.notes.manage';

DROP TABLE IF EXISTS note_embeddings;
DROP TABLE IF EXISTS note_links;
DROP TABLE IF EXISTS note_tag_links;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS note_tags;
DROP TABLE IF EXISTS note_folders;

