import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Image, Loader2 } from 'lucide-react';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  url?: string;
  error?: string;
}

export interface UploadProgressProps {
  uploads: UploadItem[];
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  onClearCompleted?: () => void;
}

/**
 * 单个上传项组件 - 使用 useEffect 管理 Blob URL 防止内存泄漏
 */
function UploadItemRow({
  upload,
  onRemove,
  onRetry
}: {
  upload: UploadItem;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string>('');

  // 管理 Blob URL 生命周期
  useEffect(() => {
    if (upload.file.type.startsWith('image/')) {
      const url = URL.createObjectURL(upload.file);
      setPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [upload.file]);

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        {/* Thumbnail or Icon */}
        <div className="w-8 h-8 flex-shrink-0 rounded bg-white/5 flex items-center justify-center overflow-hidden">
          {upload.file.type.startsWith('image/') && previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <Image className="w-4 h-4 text-gray-500" />
          )}
        </div>

        {/* File Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-300 truncate" title={upload.file.name}>
            {upload.file.name}
          </p>
          <p className="text-[10px] text-gray-500">
            {(upload.file.size / 1024).toFixed(1)} KB
          </p>
        </div>

        {/* Status */}
        <div className="flex-shrink-0">
          {upload.status === 'uploading' && (
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          )}
          {upload.status === 'success' && (
            <CheckCircle className="w-4 h-4 text-green-500" />
          )}
          {upload.status === 'error' && (
            <div className="flex items-center gap-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              {onRetry && (
                <button
                  onClick={() => onRetry(upload.id)}
                  className="text-[10px] text-primary hover:underline"
                >
                  重试
                </button>
              )}
            </div>
          )}
        </div>

        {/* Remove Button */}
        {onRemove && upload.status !== 'uploading' && (
          <button
            onClick={() => onRemove(upload.id)}
            className="p-1 text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Progress Bar */}
      {upload.status === 'uploading' && (
        <div className="mt-1.5 h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
            style={{ width: `${upload.progress}%` }}
          />
        </div>
      )}

      {/* Error Message */}
      {upload.status === 'error' && upload.error && (
        <p className="mt-1 text-[10px] text-red-400">{upload.error}</p>
      )}
    </div>
  );
}

/**
 * 上传进度组件 - 显示图片上传状态和进度
 */
export function UploadProgress({ uploads, onRemove, onRetry, onClearCompleted }: UploadProgressProps) {
  if (uploads.length === 0) return null;

  const hasCompleted = uploads.some(u => u.status !== 'uploading');

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-h-96 overflow-y-auto bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/5">
        <span className="text-sm font-medium text-gray-200">
          上传中({uploads.filter(u => u.status === 'uploading').length}/{uploads.length})
        </span>
        {hasCompleted && onClearCompleted && (
          <button
            onClick={onClearCompleted}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            清除完成
          </button>
        )}
      </div>

      {/* Upload Items */}
      <div className="divide-y divide-white/5">
        {uploads.map((upload) => (
          <UploadItemRow key={upload.id} upload={upload} onRemove={onRemove} onRetry={onRetry} />
        ))}
      </div>
    </div>
  );
}
