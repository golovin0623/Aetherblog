import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function MediaPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">媒体库</h1>
          <p className="text-gray-400 mt-1">管理图片、视频和文件</p>
        </div>
        <button
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg',
            'bg-primary text-white font-medium',
            'hover:bg-primary/90 transition-colors'
          )}
        >
          <Upload className="w-4 h-4" />
          上传文件
        </button>
      </div>

      {/* 上传区域 */}
      <div
        className={cn(
          'border-2 border-dashed border-white/20 rounded-xl p-12',
          'flex flex-col items-center justify-center',
          'hover:border-primary/50 transition-colors cursor-pointer'
        )}
      >
        <Upload className="w-12 h-12 text-gray-500 mb-4" />
        <p className="text-white font-medium">拖放文件到这里上传</p>
        <p className="text-gray-500 text-sm mt-1">或点击选择文件</p>
      </div>

      {/* 媒体网格占位 */}
      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        <div className="text-center py-12 text-gray-500">
          媒体网格（待实现）
        </div>
      </div>
    </div>
  );
}
