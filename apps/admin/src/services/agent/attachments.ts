/**
 * 消息图片附件 —— 校验、编码与用量估算。
 *
 * MVP 不走对象存储：图片直接读成 dataURL 内联在消息里持久化（localStorage
 * 配额有限，所以单图 5MB / 单条 4 张双限制）。宽高在入库前用 Image 预探测，
 * 供消息气泡按真实比例占位，避免加载期跳动；探测失败不阻塞发送。
 */

import type { AgentAttachment } from './sessions';

export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/**
 * 单条消息全部附件 dataUrl 的总量预算（16MB）。
 *
 * 为什么不是 4 × 5MB：dataUrl 是 base64 编码，5MB 原图编码后 ≈6.67MB，
 * 4 张满额图总量 ≈26.7MB，会撞上后端 24MB 请求体上限——用户直到点发送才
 * 收到一个不透明的 4xx。16MB 把体积包络在选图阶段就收敛到后端上限之内
 * （给文本与 JSON 结构留足余量），让「加不进去」发生在能解释原因的时刻。
 */
export const MAX_TOTAL_ATTACHMENT_DATAURL_BYTES = 16 * 1024 * 1024;

/**
 * 判断把 next 加入 existing 后，全部附件 dataUrl 总长是否仍在预算内。
 *
 * dataUrl 是纯 ASCII（`data:` 前缀 + base64），`length` 即字节数。纯函数，
 * 不做副作用——Composer 在选图回调里调用，超预算时拒绝加入并提示用户。
 */
export function attachmentsWithinBudget(existing: AgentAttachment[], next: AgentAttachment): boolean {
  const total = existing.reduce((sum, item) => sum + item.dataUrl.length, 0) + next.dataUrl.length;
  return total <= MAX_TOTAL_ATTACHMENT_DATAURL_BYTES;
}

function newAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `att_${crypto.randomUUID()}`;
  }
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 不合法返回中文错误文案（直接可入 toast），合法返回 null。 */
export function validateImageFile(file: File): string | null {
  if (!(ACCEPTED_IMAGE_MIME as readonly string[]).includes(file.type)) {
    return '仅支持 PNG / JPEG / WebP / GIF 格式的图片';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return '单张图片不能超过 5MB';
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('图片读取失败'));
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 宽高探测 —— 失败返回 null（如 SSR 无 Image、图片损坏），不向上抛错阻塞发送。 */
function probeImageSize(dataUrl: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function fileToAttachment(file: File): Promise<AgentAttachment> {
  const dataUrl = await readFileAsDataUrl(file);
  const dims = await probeImageSize(dataUrl);
  return {
    id: newAttachmentId(),
    kind: 'image',
    mime: file.type,
    name: file.name,
    size: file.size,
    dataUrl,
    ...(dims ? { width: dims.width, height: dims.height } : {}),
  };
}

/** 图片按 ~800 token 估（主流多模态模型中等分辨率图片的经验均值），
 *  供上下文用量计一并计入 —— 与文本一样只是估算，展示时带 "~" 前缀。 */
export function attachmentTokenEstimate(a: AgentAttachment): number {
  return a.kind === 'image' ? 800 : 0;
}
