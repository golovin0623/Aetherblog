import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  RotateCw,
  RotateCcw,
  Crop,
  ZoomIn,
  ZoomOut,
  Move,
  Save,
  X,
  Maximize2
} from 'lucide-react';
import { Button } from '@aetherblog/ui';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import ReactCrop, { Crop as CropType, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { mediaService } from '../../../services/mediaService';

/**
 * 图片编辑器组件
 *
 * @ref 媒体库深度优化方案 - Phase 4: 图像处理
 */

interface ImageEditorProps {
  fileId: number;
  imageUrl: string;
  onClose: () => void;
  onSave?: (editedImageUrl: string) => void;
}

type EditMode = 'crop' | 'rotate' | 'zoom' | 'move';

export function ImageEditor({ fileId, imageUrl, onClose, onSave }: ImageEditorProps) {
  const [editMode, setEditMode] = useState<EditMode | null>(null);
  const [crop, setCrop] = useState<CropType>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 保存编辑
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canvasRef.current || !imageRef.current) {
        throw new Error('Canvas or image not ready');
      }

      // 创建最终画布
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cannot get canvas context');

      const image = imageRef.current;

      // 设置画布尺寸
      if (completedCrop) {
        canvas.width = completedCrop.width;
        canvas.height = completedCrop.height;
      } else {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
      }

      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 应用变换
      ctx.save();

      // 旋转
      if (rotation !== 0) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
      }

      // 缩放
      if (zoom !== 1) {
        ctx.scale(zoom, zoom);
      }

      // 绘制图片
      if (completedCrop) {
        ctx.drawImage(
          image,
          completedCrop.x,
          completedCrop.y,
          completedCrop.width,
          completedCrop.height,
          0,
          0,
          completedCrop.width,
          completedCrop.height
        );
      } else {
        ctx.drawImage(image, position.x, position.y);
      }

      ctx.restore();

      // 转换为Blob
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        }, 'image/jpeg', 0.95);
      });
    },
    onSuccess: async (blob) => {
      // 上传编辑后的图片
      const formData = new FormData();
      formData.append('file', blob, 'edited.jpg');
      await mediaService.uploadEdited(fileId, formData);

      // 通知父组件刷新
      // 这里可以传递新的 URL，但通常父组件会重新获取数据
      onSave?.(URL.createObjectURL(blob)); // 保持本地预览更新流畅性
      toast.success('图片已保存');
      onClose();
    },
    onError: (error) => {
      console.error('Save failed:', error);
      toast.error('保存失败');
    },
  });

  const handleRotateLeft = () => {
    setRotation((prev) => (prev - 90) % 360);
  };

  const handleRotateRight = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.1, 3));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.1, 0.5));
  };

  const handleReset = () => {
    setRotation(0);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setCrop(undefined);
    setCompletedCrop(undefined);
    setEditMode(null);
  };

  const handleSave = () => {
    saveMutation.mutate();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex flex-col"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/50 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Crop className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-white">图片编辑器</h2>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? '保存中...' : '保存'}
          </Button>
          <button
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 p-4 bg-black/30 border-b border-white/10">
        <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-lg">
          <button
            onClick={() => setEditMode(editMode === 'crop' ? null : 'crop')}
            className={`p-2 rounded-lg transition-colors ${
              editMode === 'crop'
                ? 'bg-primary/20 text-primary'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
            title="裁剪"
          >
            <Crop className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-white/10" />

          <button
            onClick={handleRotateLeft}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="向左旋转"
          >
            <RotateCcw className="w-5 h-5" />
          </button>

          <button
            onClick={handleRotateRight}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="向右旋转"
          >
            <RotateCw className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-white/10" />

          <button
            onClick={handleZoomOut}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="缩小"
          >
            <ZoomOut className="w-5 h-5" />
          </button>

          <span className="text-sm text-white/70 min-w-[60px] text-center">
            {Math.round(zoom * 100)}%
          </span>

          <button
            onClick={handleZoomIn}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="放大"
          >
            <ZoomIn className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-white/10" />

          <button
            onClick={handleReset}
            className="px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            重置
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
        <div className="relative">
          {editMode === 'crop' ? (
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              onComplete={(c) => setCompletedCrop(c)}
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt="Edit"
                style={{
                  transform: `rotate(${rotation}deg) scale(${zoom})`,
                  maxWidth: '90vw',
                  maxHeight: '70vh',
                  objectFit: 'contain',
                }}
                className="transition-transform duration-200"
              />
            </ReactCrop>
          ) : (
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Edit"
              style={{
                transform: `rotate(${rotation}deg) scale(${zoom}) translate(${position.x}px, ${position.y}px)`,
                maxWidth: '90vw',
                maxHeight: '70vh',
                objectFit: 'contain',
              }}
              className="transition-transform duration-200"
            />
          )}
        </div>

        {/* Hidden canvas for export */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Info */}
      <div className="p-4 bg-black/30 border-t border-white/10">
        <div className="flex items-center justify-center gap-6 text-sm text-white/50">
          <span>旋转: {rotation}°</span>
          <span>缩放: {Math.round(zoom * 100)}%</span>
          {completedCrop && (
            <span>
              裁剪: {Math.round(completedCrop.width)} × {Math.round(completedCrop.height)}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
