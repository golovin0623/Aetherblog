import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KNOWLEDGE_DETAIL_TAB,
  getKnowledgeDetailConfirmationCopy,
  getKnowledgeDetailTabs,
  parseKnowledgeDetailTab,
} from './KnowledgeBaseDetailPage';
import { getKnowledgeBaseDetailPath } from './KnowledgeBasePage';

describe('knowledge base detail product navigation', () => {
  it('opens on verification and uses task language instead of implementation terms', () => {
    expect(DEFAULT_KNOWLEDGE_DETAIL_TAB).toBe('verify');
    expect(getKnowledgeDetailTabs(false).map((item) => item.label)).toEqual([
      '验证效果',
      '资料',
      '高级设置',
      '权限',
    ]);
    expect(getKnowledgeDetailTabs(true).map((item) => item.label)).toEqual([
      '验证效果',
      '资料',
      '高级设置',
    ]);
  });

  it('deep-links view-only users to files while keeping usable libraries task-first', () => {
    expect(getKnowledgeBaseDetailPath('team-handbook', 'VIEW')).toBe(
      '/intelligence/knowledge/team-handbook?tab=files',
    );
    expect(getKnowledgeBaseDetailPath('team-handbook', 'USE')).toBe(
      '/intelligence/knowledge/team-handbook',
    );
    expect(parseKnowledgeDetailTab('files')).toBe('files');
    expect(parseKnowledgeDetailTab('unknown')).toBe(DEFAULT_KNOWLEDGE_DETAIL_TAB);
  });
});

describe('knowledge base detail confirmation copy', () => {
  it('keeps restore, migration, and deletion actions visibly distinct', () => {
    const restore = getKnowledgeDetailConfirmationCopy({
      kind: 'restore-profile',
      targetName: '旧版高精度',
    });
    const migrate = getKnowledgeDetailConfirmationCopy({
      kind: 'migrate-profile',
      targetName: '新版高精度',
    });
    const remove = getKnowledgeDetailConfirmationCopy({
      kind: 'delete-profile',
      targetName: '废弃档案',
    });

    expect(restore).toMatchObject({
      title: '切回旧索引档案？',
      confirmText: '确认切回',
      variant: 'warning',
    });
    expect(migrate).toMatchObject({
      title: '开始蓝绿迁移？',
      confirmText: '开始迁移',
      variant: 'warning',
    });
    expect(remove).toMatchObject({
      title: '永久删除索引档案？',
      confirmText: '确认删除',
      variant: 'danger',
    });
    expect(restore.message).toContain('旧版高精度');
    expect(migrate.message).toContain('后台');
    expect(remove.message).toContain('无法恢复');
  });

  it('states that file deletion is permanent and member removal only revokes access', () => {
    const fileDelete = getKnowledgeDetailConfirmationCopy({
      kind: 'delete-file',
      targetName: '产品规范.pdf',
    });
    const revokeMember = getKnowledgeDetailConfirmationCopy({
      kind: 'revoke-member',
      targetName: '研发团队',
    });

    expect(fileDelete).toMatchObject({
      confirmText: '永久删除',
      variant: 'danger',
    });
    expect(fileDelete.message).toContain('无法恢复');
    expect(revokeMember).toMatchObject({
      confirmText: '撤销权限',
      variant: 'warning',
    });
    expect(revokeMember.message).toContain('不会删除');
  });
});
