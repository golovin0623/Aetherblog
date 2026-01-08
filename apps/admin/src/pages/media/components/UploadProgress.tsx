/**
 * @file UploadProgress.tsx
 * @description 上传进度组件
 * @ref §3.2.4 - 媒体管理模块
 */

import { motion } from 'framer-motion';
import { X, FileUp, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadingFile {
  file: File;
  progress: number;
  id: string;
  error?: string;
}

interface UploadProgressProps {
  files: UploadingFile[];
  onCancel: (id: string) => void;
}

/**
 * 上传进度组件
 */
export function UploadProgress({ files, onCancel }: UploadProgressProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        'rounded-xl overflow-hidden',
        'bg-white/5 backdrop-blur-sm border border-white/10'
      )}
    >
      <div className="p-4 border-b border-white/10">
        <h3 className="text-sm font-medium text-white">
          正在上传 ({files.length} 个文件)
        </h3>
      </div>

      <div className="divide-y divide-white/5 max-h-48 overflow-y-auto">
        {files.map((item) => {
          const isComplete = item.progress >= 100;
          const hasError = !!item.error;

          return (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 hover:bg-white/5"
            >
              {/* 图标 */}
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center',
                  hasError
                    ? 'bg-red-500/20'
                    : isComplete
                    ? 'bg-green-500/20'
                    : 'bg-primary/20'
                )}
              >
                {isComplete ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <FileUp className="w-4 h-4 text-primary" />
                )}
              </div>

              {/* 文件信息 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{item.file.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  {hasError ? (
                    <p className="text-xs text-red-400">{item.error}</p>
                  ) : (
                    <>
                      {/* 进度条 */}
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-primary rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${item.progress}%` }}
                          transition={{ duration: 0.2 }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-10 text-right">
                        {item.progress}%
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* 取消按钮 */}
              {!isComplete && (
                <button
                  onClick={() => onCancel(item.id)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
