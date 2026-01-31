import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, GripVertical, ExternalLink, ChevronDown, X, Search, Link as LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 社交链接数据结构
 */
export interface SocialLink {
  id: string;
  platform: string;  // 平台标识，如 'github', 'wechat', 'custom'
  name: string;      // 显示名称
  url: string;       // 链接地址
  icon?: string;     // 自定义图标URL（仅自定义平台需要）
}

/**
 * 预设社交平台配置
 * 包含 30+ 主流平台，使用 Simple Icons 的 SVG
 */
export const PRESET_PLATFORMS: { id: string; name: string; color: string; icon: string; noBg?: boolean }[] = [
  // 国内主流
  { id: 'wechat', name: '微信', color: '#07C160', icon: 'https://api.iconify.design/simple-icons:wechat.svg?color=%2307C160' },
  { id: 'qq', name: 'QQ', color: '#EB1923', icon: 'https://api.iconify.design/simple-icons:tencentqq.svg?color=%23EB1923' },
  { id: 'weibo', name: '微博', color: '#E6162D', icon: 'https://api.iconify.design/simple-icons:sinaweibo.svg?color=%23E6162D' },
  { id: 'bilibili', name: '哔哩哔哩', color: '#00A1D6', icon: 'https://api.iconify.design/simple-icons:bilibili.svg?color=%2300A1D6' },
  { id: 'zhihu', name: '知乎', color: '#0084FF', icon: 'https://api.iconify.design/simple-icons:zhihu.svg?color=%230084FF' },
  { id: 'douyin', name: '抖音', color: '#000000', icon: 'https://api.iconify.design/logos:tiktok-icon.svg' },
  { id: 'xiaohongshu', name: '小红书', color: '#FE2C55', icon: 'https://api.iconify.design/simple-icons:xiaohongshu.svg?color=%23FE2C55' },
  { id: 'douban', name: '豆瓣', color: '#007722', icon: 'https://api.iconify.design/simple-icons:douban.svg?color=%23007722' },
  { id: 'gitee', name: 'Gitee', color: '#C71D23', icon: 'https://api.iconify.design/simple-icons:gitee.svg?color=%23C71D23' },
  { id: 'juejin', name: '掘金', color: '#1E80FF', icon: 'https://api.iconify.design/simple-icons:juejin.svg?color=%231E80FF' },
  { id: 'csdn', name: 'CSDN', color: '#FC5531', icon: 'https://api.iconify.design/simple-icons:csdn.svg?color=%23FC5531' },
  // 国际主流
  { id: 'github', name: 'GitHub', color: '#181717', icon: 'https://api.iconify.design/logos:github-icon.svg' },
  { id: 'twitter', name: 'Twitter / X', color: '#000000', icon: 'https://api.iconify.design/logos:twitter.svg' },
  { id: 'facebook', name: 'Facebook', color: '#1877F2', icon: 'https://api.iconify.design/logos:facebook.svg' },
  { id: 'instagram', name: 'Instagram', color: '#E4405F', icon: 'https://api.iconify.design/logos:instagram-icon.svg' },
  { id: 'linkedin', name: 'LinkedIn', color: '#0A66C2', icon: 'https://api.iconify.design/logos:linkedin-icon.svg' },
  { id: 'youtube', name: 'YouTube', color: '#FF0000', icon: 'https://api.iconify.design/logos:youtube-icon.svg' },
  { id: 'discord', name: 'Discord', color: '#5865F2', icon: 'https://api.iconify.design/logos:discord-icon.svg' },
  { id: 'telegram', name: 'Telegram', color: '#26A5E4', icon: 'https://api.iconify.design/logos:telegram.svg' },
  { id: 'reddit', name: 'Reddit', color: '#FF4500', icon: 'https://api.iconify.design/logos:reddit-icon.svg' },
  { id: 'twitch', name: 'Twitch', color: '#9146FF', icon: 'https://api.iconify.design/logos:twitch.svg' },
  { id: 'tiktok', name: 'TikTok', color: '#000000', icon: 'https://api.iconify.design/logos:tiktok-icon.svg' },
  { id: 'spotify', name: 'Spotify', color: '#1DB954', icon: 'https://api.iconify.design/logos:spotify-icon.svg' },
  { id: 'stackoverflow', name: 'Stack Overflow', color: '#F58025', icon: 'https://api.iconify.design/logos:stackoverflow-icon.svg' },
  { id: 'whatsapp', name: 'WhatsApp', color: '#25D366', icon: 'https://api.iconify.design/logos:whatsapp-icon.svg' },
  { id: 'snapchat', name: 'Snapchat', color: '#FFFC00', icon: 'https://api.iconify.design/simple-icons:snapchat.svg?color=black' },
  // 其他
  { id: 'email', name: '邮箱', color: '#EA4335', icon: 'https://api.iconify.design/logos:google-gmail.svg' },
  { id: 'rss', name: 'RSS', color: '#FFA500', icon: 'https://api.iconify.design/simple-icons:rss.svg?color=%23FFA500' },
  { id: 'website', name: '个人网站', color: '#4285F4', icon: 'https://api.iconify.design/logos:chrome.svg' },
];

interface SocialLinksEditorProps {
  value: SocialLink[];
  onChange: (links: SocialLink[]) => void;
}

export function SocialLinksEditor({ value, onChange }: SocialLinksEditorProps) {
  const [showPlatformPicker, setShowPlatformPicker] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const links = value || [];

  // 生成唯一ID
  const generateId = () => `social_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // 添加社交链接
  const addLink = (platformId: string) => {
    const preset = PRESET_PLATFORMS.find(p => p.id === platformId);
    const newLink: SocialLink = {
      id: generateId(),
      platform: platformId,
      name: preset?.name || '自定义',
      url: '',
      icon: platformId === 'custom' ? '' : undefined,
    };
    onChange([...links, newLink]);
    setEditingId(newLink.id);
    setShowPlatformPicker(false);
    setSearchTerm('');
  };

  // 更新链接
  const updateLink = (id: string, updates: Partial<SocialLink>) => {
    onChange(links.map(link => link.id === id ? { ...link, ...updates } : link));
  };

  // 删除链接
  const removeLink = (id: string) => {
    onChange(links.filter(link => link.id !== id));
    if (editingId === id) setEditingId(null);
  };

  // 获取平台信息
  const getPlatformInfo = (platformId: string) => {
    return PRESET_PLATFORMS.find(p => p.id === platformId);
  };

  // 过滤平台列表
  const filteredPlatforms = PRESET_PLATFORMS.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 已添加的平台ID
  const addedPlatformIds = new Set(links.map(l => l.platform));

  return (
    <div className="space-y-4">
      {/* 已添加的社交链接列表 */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {links.map((link, index) => {
            const platform = getPlatformInfo(link.platform);
            const isEditing = editingId === link.id;
            const isCustom = link.platform === 'custom';

            return (
              <motion.div
                key={link.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="group"
              >
                <div
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-all",
                    isEditing
                      ? "bg-[var(--bg-input)] border-primary/50"
                      : "bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-default)]"
                  )}
                >
                  {/* 拖拽手柄 */}
                  <div className="cursor-grab text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical className="w-4 h-4" />
                  </div>

                  {/* 平台图标 */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden relative bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10"
                  >
                    {!isCustom && platform ? (
                      <img 
                        src={platform.icon} 
                        alt={platform.name}
                        className="w-5 h-5 object-contain"
                        loading="lazy"
                      />
                    ) : isCustom && link.icon ? (
                      <img 
                        src={link.icon} 
                        alt={link.name} 
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.nextElementSibling;
                          if (fallback) {
                            fallback.classList.remove('hidden');
                            fallback.classList.add('flex');
                          }
                        }}
                      />
                    ) : (
                      <LinkIcon className="w-4 h-4 text-[var(--text-muted)]" />
                    )}
                    {/* 自定义图标损坏时的回退 */}
                    <div className="hidden absolute inset-0 items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                        <LinkIcon className="w-4 h-4" />
                    </div>
                  </div>

                  {/* 内容区域 */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        {isCustom && (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={link.name}
                              onChange={(e) => updateLink(link.id, { name: e.target.value })}
                              placeholder="平台名称"
                              className="flex-1 px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
                            />
                            <input
                              type="url"
                              value={link.icon || ''}
                              onChange={(e) => updateLink(link.id, { icon: e.target.value })}
                              placeholder="图标URL"
                              className="flex-1 px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
                            />
                          </div>
                        )}
                        <input
                          type="url"
                          value={link.url}
                          onChange={(e) => updateLink(link.id, { url: e.target.value })}
                          placeholder={`输入${link.name}链接地址`}
                          className="w-full px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
                          autoFocus
                          onBlur={() => {
                            // 延迟关闭，允许点击其他元素
                            setTimeout(() => setEditingId(null), 200);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setEditingId(null);
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className="cursor-pointer"
                        onClick={() => setEditingId(link.id)}
                      >
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {link.name}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] truncate">
                          {link.url || '点击编辑链接'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <button
                    onClick={() => removeLink(link.id)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* 添加按钮 */}
      <div className="relative">
        <button
          onClick={() => setShowPlatformPicker(!showPlatformPicker)}
          className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] border border-dashed border-[var(--border-subtle)] hover:border-[var(--border-default)] rounded-lg transition-all w-full justify-center"
        >
          <Plus className="w-4 h-4" />
          添加社交链接
          <ChevronDown className={cn("w-4 h-4 transition-transform", showPlatformPicker && "rotate-180")} />
        </button>

        {/* 平台选择器 (Modal) */}
        {createPortal(
          <AnimatePresence>
            {showPlatformPicker && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
                {/* 背景遮罩 */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={() => setShowPlatformPicker(false)}
                />

                {/* 模态框 */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  className="relative w-full max-w-4xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
                >
                  {/* 模态框头部 */}
                  <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-white/10">
                    <div className="flex items-center gap-2">
                      <Search className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="搜索社交平台..."
                        className="bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none text-sm w-48 sm:w-64"
                        autoFocus
                      />
                    </div>
                    <button 
                      onClick={() => setShowPlatformPicker(false)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 平台网格 */}
                  <div className="overflow-y-auto p-4 flex-1">
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                      {/* 自定义选项 */}
                      <button
                        onClick={() => addLink('custom')}
                        className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all group border border-dashed border-gray-200 dark:border-white/10 hover:border-primary/50"
                      >
                         <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100 dark:bg-white/5 group-hover:bg-primary/10 transition-colors">
                           <Plus className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-primary" />
                         </div>
                         <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">自定义链接</span>
                      </button>

                      {filteredPlatforms.map((platform) => {
                        const isAdded = addedPlatformIds.has(platform.id);
                        return (
                          <button
                            key={platform.id}
                            onClick={() => !isAdded && addLink(platform.id)}
                            disabled={isAdded}
                            className={cn(
                              "flex flex-col items-center gap-2 p-3 rounded-xl transition-all border border-transparent",
                              isAdded
                                ? "opacity-40 grayscale cursor-not-allowed bg-gray-50 dark:bg-white/5"
                                : "hover:bg-gray-50 dark:hover:bg-white/5 hover:border-gray-200 dark:hover:border-white/10"
                            )}
                          >
                            <div
                              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10"
                            >
                              <img 
                                src={platform.icon} 
                                alt={platform.name} 
                                className="w-5 h-5 object-contain" 
                                loading="lazy"
                              />
                            </div>
                            <span className="text-xs text-gray-700 dark:text-[var(--text-secondary)] font-medium truncate w-full text-center">
                              {platform.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    
                    {filteredPlatforms.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                        <Search className="w-8 h-8 mb-2 opacity-50" />
                        <p>未找到相关平台</p>
                      </div>
                    )}
                  </div>
                  
                  {/* 底部提示 */}
                  <div className="p-3 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/10 text-center">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      图标来源 Simple Icons • 支持自定义链接
                    </p>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
    </div>
  );
}

export default SocialLinksEditor;
