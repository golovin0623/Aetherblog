// 图片发送管线（发送前半程）—— 设计规范 §5：
//   捕获(按钮/粘贴/拖拽) → 压缩(canvas ≤2560px WebP) → 均色占位 → 上传(XHR 进度)。
// 压缩通过 createImageBitmap + canvas 重采样完成；EXIF 方向由 imageOrientation:
// 'from-image' 纠正后自然剥离（重编码不携带元数据，隐私友好）。

export interface PreparedImage {
  /** 压缩后的待上传数据（或小图原文件）。 */
  blob: Blob;
  fileName: string;
  mime: string;
  width: number;
  height: number;
  /** 本地预览 URL（objectURL，发送后由调用方 revoke）。 */
  previewUrl: string;
  /** 平均色占位（#rrggbb），写入 attachmentMeta.ph，接收端先铺色块再淡入原图。 */
  placeholder: string;
}

const MAX_EDGE = 2560;
const WEBP_QUALITY = 0.82;
/** 小于 1MB 的图不值得重编码（可能反而变大），原样直传。 */
const COMPRESS_THRESHOLD = 1024 * 1024;

export function isImageFile(file: File): boolean {
  return /^image\//.test(file.type);
}

/** 从 canvas 上下文取平均色（缩到 1px 采样，成本可忽略）。 */
function averageColor(bitmap: ImageBitmap): string {
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d');
    if (!ctx) return '#818CF8';
    ctx.drawImage(bitmap, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return '#818CF8';
  }
}

/**
 * 压缩并度量一张图片。GIF / SVG 不重编码（会丢动画 / 矢量），只度量尺寸。
 * 失败时退化为原文件直传（宽高未知交给接收端自适应）。
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const previewUrl = URL.createObjectURL(file);
  const fallback: PreparedImage = {
    blob: file,
    fileName: file.name || 'image',
    mime: file.type || 'application/octet-stream',
    width: 0,
    height: 0,
    previewUrl,
    placeholder: '#818CF8',
  };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const placeholder = averageColor(bitmap);
    const skipReencode =
      file.size < COMPRESS_THRESHOLD || file.type === 'image/gif' || file.type === 'image/svg+xml';
    if (skipReencode) {
      return { ...fallback, width: bitmap.width, height: bitmap.height, placeholder };
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ...fallback, width: bitmap.width, height: bitmap.height, placeholder };
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
    );
    if (!blob || blob.size >= file.size) {
      // WebP 不可用或压缩无收益 → 原图直传。
      return { ...fallback, width: bitmap.width, height: bitmap.height, placeholder };
    }
    const base = (file.name || 'image').replace(/\.[a-z0-9]+$/i, '');
    return {
      blob,
      fileName: `${base}.webp`,
      mime: 'image/webp',
      width: w,
      height: h,
      previewUrl,
      placeholder,
    };
  } catch {
    return fallback;
  }
}

/** 从粘贴 / 拖拽事件里抽取图片与其他文件。 */
export function splitFiles(files: FileList | File[]): { images: File[]; others: File[] } {
  const images: File[] = [];
  const others: File[] = [];
  Array.from(files).forEach((f) => (isImageFile(f) ? images.push(f) : others.push(f)));
  return { images, others };
}
