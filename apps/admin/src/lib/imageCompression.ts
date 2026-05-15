export const IMAGE_COMPRESSION_THRESHOLD = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_MAX_SIZE = 20 * 1024 * 1024;

export type CompressionProfile = 'avatar' | 'editor';

export interface SmartCompressionMetrics {
  profile: CompressionProfile;
  originalName: string;
  originalSize: number;
  compressedSize: number;
  savedBytes: number;
  savingsPercent: number;
  compressionRatio: number;
  mimeType: string;
}

interface CompressImageOptions {
  profile: CompressionProfile;
  targetBytes?: number;
}

const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const QUALITY_STEPS = [0.92, 0.88, 0.84, 0.82];

const PROFILE_MAX_DIMENSION: Record<CompressionProfile, number> = {
  avatar: 1600,
  editor: 3200,
};

export function isCompressibleImage(file: File): boolean {
  return COMPRESSIBLE_TYPES.has(file.type);
}

function getOutputName(name: string, mimeType: string): string {
  const baseName = name.replace(/\.[^.]+$/, '') || 'image';
  const extension = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/jpeg' ? 'jpg' : 'png';
  return `${baseName}.${extension}`;
}

function getOutputTypes(file: File): string[] {
  if (file.type === 'image/jpeg') return ['image/webp', 'image/jpeg'];
  if (file.type === 'image/png') return ['image/webp', 'image/png'];
  if (file.type === 'image/webp') return ['image/webp'];
  return [];
}

function calculateSize(width: number, height: number, maxDimension: number) {
  const largest = Math.max(width, height);
  if (largest <= maxDimension) return { width, height };
  const ratio = maxDimension / largest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    image.src = url;
  });
}

function imageDimensions(image: ImageBitmap | HTMLImageElement) {
  if ('naturalWidth' in image) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return { width: image.width, height: image.height };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

export async function compressImageFile(
  file: File,
  { profile, targetBytes = IMAGE_COMPRESSION_THRESHOLD }: CompressImageOptions
): Promise<{ file: File; metrics: SmartCompressionMetrics } | null> {
  if (!isCompressibleImage(file)) return null;

  const image = await loadImage(file);
  const { width, height } = imageDimensions(image);
  const size = calculateSize(width, height, PROFILE_MAX_DIMENSION[profile]);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d', { alpha: file.type !== 'image/jpeg' });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, size.width, size.height);

  if ('close' in image) {
    image.close();
  }

  let bestBlob: Blob | null = null;
  let bestType = '';

  for (const mimeType of getOutputTypes(file)) {
    const qualitySteps = mimeType === 'image/png' ? [undefined] : QUALITY_STEPS;
    for (const quality of qualitySteps) {
      const blob = await canvasToBlob(canvas, mimeType, quality);
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
        bestType = mimeType;
      }
      if (blob.size <= targetBytes && blob.size < file.size) {
        bestBlob = blob;
        bestType = mimeType;
        break;
      }
    }
    if (bestBlob && bestBlob.size <= targetBytes && bestBlob.size < file.size) break;
  }

  if (!bestBlob || bestBlob.size >= file.size) return null;

  const compressedFile = new File([bestBlob], getOutputName(file.name, bestType), {
    type: bestType,
    lastModified: Date.now(),
  });
  const savedBytes = file.size - compressedFile.size;
  const compressionRatio = compressedFile.size / file.size;

  return {
    file: compressedFile,
    metrics: {
      profile,
      originalName: file.name,
      originalSize: file.size,
      compressedSize: compressedFile.size,
      savedBytes,
      savingsPercent: Number(((savedBytes / file.size) * 100).toFixed(1)),
      compressionRatio: Number(compressionRatio.toFixed(3)),
      mimeType: bestType,
    },
  };
}
