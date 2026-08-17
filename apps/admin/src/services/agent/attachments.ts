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

// ---------------------------------------------------------------------------
// 超限图片压缩 —— canvas 降采样 + 重编码
// ---------------------------------------------------------------------------

/** 压缩目标：最长边 2048px（聊天 / 多模态识别场景足够），编码质量 0.85。 */
export const COMPRESS_MAX_EDGE = 2048;
export const COMPRESS_QUALITY = 0.85;

/** 可注入的压缩实现 —— vitest（node 无 canvas）注入 stub 只测纯逻辑分支。 */
export type ImageCompressor = (
  file: File,
  options: { maxEdge: number; quality: number },
) => Promise<File>;

/** 解码图片为可绘制源：优先 createImageBitmap（免 objectURL、可解 EXIF 方向），
 *  回退 HTMLImageElement。两者都不可用（SSR / node）直接抛错，由上层回退原文件。 */
async function loadImageSource(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    throw new Error('图片解码环境不可用');
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 默认 canvas 压缩实现。任何一步失败都抛错 —— compressImageIfNeeded 捕获后
 *  回退原文件，让原有 5MB 校验给出明确报错，而不是静默吞掉异常。 */
const canvasCompressImage: ImageCompressor = async (file, { maxEdge, quality }) => {
  if (typeof document === 'undefined') throw new Error('canvas 环境不可用');
  const source = await loadImageSource(file);
  const srcWidth = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const srcHeight = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!(srcWidth > 0) || !(srcHeight > 0)) throw new Error('图片尺寸不可用');
  const scale = Math.min(1, maxEdge / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 上下文不可用');
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source && typeof source.close === 'function') source.close();
  // 输出格式取舍：JPEG 原图继续走 JPEG（本就无透明）；PNG / WebP 统一转 WebP
  // —— 保留 alpha 通道的同时体积远小于 PNG 重编码（JPEG 会把透明底涂黑）。
  // 浏览器不支持 WebP 编码时 toBlob 按规范回退 PNG，仍是合法附件类型，只是
  // 可能压不下去 —— 随后被 5MB 校验拦下并明确报错。
  const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, quality),
  );
  if (!blob) throw new Error('图片编码失败');
  const finalType = blob.type || outputType;
  const ext =
    finalType === 'image/webp' ? '.webp' : finalType === 'image/png' ? '.png' : '.jpg';
  const baseName = file.name.replace(/\.[^.]*$/, '') || 'image';
  return new File([blob], `${baseName}${ext}`, { type: finalType });
};

/**
 * 超过单图上限（5MB）时先降采样压缩，压不动 / 压不了再交回原文件让校验拒绝。
 *
 * 策略：
 *  · ≤5MB 原样通过 —— 不做无谓的重编码劣化；
 *  · GIF 旁路 —— canvas 只能取首帧，重编码等于把动图压成静态图（丢帧）；
 *  · 非受支持格式旁路 —— 交给 validateImageFile 报「格式不支持」，避免把
 *    任意格式偷偷转成 WebP 的意外行为；
 *  · 压缩失败（解码 / 编码异常、SSR 无 canvas）或压完反而更大 → 返回原文件，
 *    调用方按原规则校验，用户拿到明确的 5MB 报错而不是静默异常。
 */
export async function compressImageIfNeeded(
  file: File,
  compressor: ImageCompressor = canvasCompressImage,
): Promise<File> {
  if (file.size <= MAX_IMAGE_BYTES) return file;
  if (file.type === 'image/gif') return file;
  if (!(ACCEPTED_IMAGE_MIME as readonly string[]).includes(file.type)) return file;
  try {
    const compressed = await compressor(file, {
      maxEdge: COMPRESS_MAX_EDGE,
      quality: COMPRESS_QUALITY,
    });
    return compressed.size < file.size ? compressed : file;
  } catch {
    return file;
  }
}
