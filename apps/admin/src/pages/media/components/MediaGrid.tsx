import { useState } from 'react';
import { Upload, Image, Film, File, Trash2, Download, Search, Grid, List } from 'lucide-react';

interface MediaItem {
  id: number;
  name: string;
  type: 'image' | 'video' | 'file';
  url: string;
  size: number;
  createdAt: string;
}

export function MediaGrid() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchTerm, setSearchTerm] = useState('');

  const mediaItems: MediaItem[] = [
    { id: 1, name: 'cover-1.jpg', type: 'image', url: '/uploads/cover-1.jpg', size: 245000, createdAt: '2024-01-07' },
    { id: 2, name: 'demo-video.mp4', type: 'video', url: '/uploads/demo.mp4', size: 15000000, createdAt: '2024-01-06' },
    { id: 3, name: 'screenshot.png', type: 'image', url: '/uploads/screenshot.png', size: 180000, createdAt: '2024-01-05' },
  ];

  const getIcon = (type: string) => {
    switch (type) {
      case 'image': return Image;
      case 'video': return Film;
      default: return File;
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索文件..."
            className="pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-primary text-white' : 'bg-white/10 text-gray-400'}`}
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-primary text-white' : 'bg-white/10 text-gray-400'}`}
          >
            <List className="w-4 h-4" />
          </button>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white">
            <Upload className="w-4 h-4" />
            上传
          </button>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-4 gap-4">
          {mediaItems.map((item) => {
            const Icon = getIcon(item.type);
            return (
              <div key={item.id} className="group relative rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                <div className="aspect-square flex items-center justify-center bg-white/5">
                  {item.type === 'image' ? (
                    <div className="w-full h-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                      <Image className="w-12 h-12 text-gray-500" />
                    </div>
                  ) : (
                    <Icon className="w-12 h-12 text-gray-500" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-white text-sm truncate">{item.name}</p>
                  <p className="text-gray-500 text-xs">{formatSize(item.size)}</p>
                </div>
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button className="p-2 rounded-lg bg-white/20 text-white hover:bg-white/30">
                    <Download className="w-4 h-4" />
                  </button>
                  <button className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-sm text-gray-400">文件名</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">类型</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">大小</th>
                <th className="px-4 py-3 text-left text-sm text-gray-400">上传时间</th>
                <th className="px-4 py-3 text-right text-sm text-gray-400">操作</th>
              </tr>
            </thead>
            <tbody>
              {mediaItems.map((item) => {
                const Icon = getIcon(item.type);
                return (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Icon className="w-5 h-5 text-gray-400" />
                        <span className="text-white">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{item.type}</td>
                    <td className="px-4 py-3 text-gray-400">{formatSize(item.size)}</td>
                    <td className="px-4 py-3 text-gray-400">{item.createdAt}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="p-1.5 rounded hover:bg-white/10 text-gray-400">
                        <Download className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-white/10 text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default MediaGrid;
