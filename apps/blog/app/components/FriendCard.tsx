'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Globe, Mail, Rss } from 'lucide-react';

interface FriendCardProps {
  name: string;
  url: string;
  avatar: string;
  description?: string;
  themeColor?: string;
  tags?: string[];
  email?: string;
  rss?: string;
  index?: number;
}

export const FriendCard: React.FC<FriendCardProps> = ({
  name,
  url,
  avatar,
  description,
  themeColor = '#6366f1',
  tags = [],
  email,
  rss,
  index = 0,
}) => {
  const [imageError, setImageError] = useState(false);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:-translate-y-2 hover:shadow-2xl"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* 背景光晕 */}
      <div
        className="absolute -top-20 -right-20 h-40 w-40 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: `${themeColor}30` }}
      />

      {/* 顶部装饰条 */}
      <div
        className="h-1.5 w-full"
        style={{ background: `linear-gradient(90deg, ${themeColor}, ${themeColor}80)` }}
      />

      {/* 卡片内容 */}
      <div className="relative p-5">
        <div className="flex items-start gap-4">
          {/* 头像 */}
          <div className="relative flex-shrink-0">
            <div
              className="absolute -inset-1 rounded-full opacity-50 blur-sm"
              style={{ backgroundColor: themeColor }}
            />
            <div className="relative h-16 w-16 rounded-full overflow-hidden ring-2 ring-white/20">
              {!imageError ? (
                <img
                  src={avatar}
                  alt={name}
                  onError={() => setImageError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className="h-full w-full flex items-center justify-center text-white text-xl font-bold"
                  style={{ backgroundColor: themeColor }}
                >
                  {name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* 信息区域 */}
          <div className="flex-1 min-w-0">
            <h3 className="flex items-center gap-2 font-bold text-white truncate">
              {name}
              <ExternalLink className="h-4 w-4 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </h3>
            <p className="mt-1 text-sm text-gray-400 line-clamp-2">
              {description || '这个人很懒，什么都没写~'}
            </p>

            {/* 标签 */}
            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-400 border border-white/5"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部链接区域 */}
        <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-gray-500 truncate">
            <Globe className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{new URL(url).hostname}</span>
          </div>

          <div className="flex items-center gap-2">
            {email && (
              <a
                href={`mailto:${email}`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-full bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Mail className="h-4 w-4" />
              </a>
            )}
            {rss && (
              <a
                href={rss}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-full bg-white/5 text-gray-400 hover:text-orange-400 hover:bg-orange-400/10 transition-colors"
              >
                <Rss className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 悬浮边框 */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ boxShadow: `inset 0 0 0 1px ${themeColor}40` }}
      />
    </a>
  );
};

export default FriendCard;
