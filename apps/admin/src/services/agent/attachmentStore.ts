/**
 * 附件原图 IndexedDB 持久层。
 *
 * 会话（localStorage，~5MB 配额）里只存去掉 dataUrl 的附件元信息；原图落
 * IndexedDB（配额以百 MB 计），刷新 / 重启后消息里的图片仍可显示。三级降级：
 * 内存缓存 → IndexedDB → 占位卡片。
 *
 * 全部接口异常静默：IndexedDB 不可用（node / 隐私模式 / 被用户禁用）或单次
 * 操作失败时 put/delete 变 no-op、get 返回 null —— 图片持久化是体验增强，
 * 任何失败都不允许影响发送主链路。
 */

import { IndexedDBWrapper } from '@aetherblog/utils';
import type { AgentMessage } from './sessions';

const DB_NAME = 'aetherblog.agent.attachments';
const STORE_NAME = 'attachments';

interface AttachmentRecord {
  id: string;
  dataUrl: string;
  createdAt: number;
}

/** undefined = 尚未初始化；null = 环境无 IndexedDB（永久降级为 no-op）。 */
let wrapper: IndexedDBWrapper | null | undefined;

function getWrapper(): IndexedDBWrapper | null {
  if (wrapper !== undefined) return wrapper;
  if (typeof indexedDB === 'undefined') {
    wrapper = null;
    return null;
  }
  wrapper = new IndexedDBWrapper({
    name: DB_NAME,
    version: 1,
    stores: [{ name: STORE_NAME, keyPath: 'id' }],
  });
  return wrapper;
}

/** 写入附件原图。失败静默（隐私模式 open 被拒 / 配额满）。 */
export async function putAttachmentData(id: string, dataUrl: string): Promise<void> {
  const db = getWrapper();
  if (!db || !id || !dataUrl) return;
  try {
    await db.put<AttachmentRecord>(STORE_NAME, { id, dataUrl, createdAt: Date.now() });
  } catch {
    // 静默降级：拿不到持久层时该图退回「仅发送当次可见」的旧行为
  }
}

/** 读取附件原图；未命中或环境不可用返回 null。 */
export async function getAttachmentData(id: string): Promise<string | null> {
  const db = getWrapper();
  if (!db || !id) return null;
  try {
    const record = await db.get<AttachmentRecord>(STORE_NAME, id);
    return typeof record?.dataUrl === 'string' && record.dataUrl ? record.dataUrl : null;
  } catch {
    return null;
  }
}

/** 批量删除附件原图（删会话 / 截断消息时回收空间）。best-effort，失败静默。 */
export async function deleteAttachmentData(ids: readonly string[]): Promise<void> {
  const db = getWrapper();
  if (!db || ids.length === 0) return;
  await Promise.all(
    ids.map(async (id) => {
      if (!id) return;
      try {
        await db.delete(STORE_NAME, id);
      } catch {
        // 单条删除失败不影响其余 —— 残留记录只是占空间，不会被再次引用
      }
    }),
  );
}

/** 纯函数：收集一组消息携带的全部附件 id（供删除会话 / 截断消息时回收）。 */
export function collectAttachmentIds(
  messages: readonly Pick<AgentMessage, 'attachments'>[],
): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.id) ids.push(attachment.id);
    }
  }
  return ids;
}

/**
 * 纯函数：对候选附件 id 做全会话引用计数，仅返回「变更后不再被任何存活消息
 * 引用」的可回收 id（去重、剔除空 id）。
 *
 * 为什么必须数引用：分支会话按产品语义复制消息（含附件 id），原会话与分支
 * 共享同一批附件 —— 删除任一方时无条件回收会连坐另一方的图片。所有回收入口
 * （删会话 / 删消息截断 / 编辑截断 / 清空消息）统一先过这里。
 *
 * @param candidateIds 本次变更移除的消息所携带的附件 id（collectAttachmentIds 产物）
 * @param sessionsAfterChange 应用本次变更之后的全部会话（即存活消息的全集）
 */
export function collectReclaimableAttachmentIds(
  candidateIds: readonly string[],
  sessionsAfterChange: readonly { messages: readonly Pick<AgentMessage, 'attachments'>[] }[],
): string[] {
  if (candidateIds.length === 0) return [];
  const stillReferenced = new Set<string>();
  for (const session of sessionsAfterChange) {
    for (const id of collectAttachmentIds(session.messages)) stillReferenced.add(id);
  }
  const seen = new Set<string>();
  const reclaimable: string[] = [];
  for (const id of candidateIds) {
    if (!id || seen.has(id) || stillReferenced.has(id)) continue;
    seen.add(id);
    reclaimable.push(id);
  }
  return reclaimable;
}
