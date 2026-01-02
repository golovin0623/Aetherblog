import { useState } from 'react';
import { cn } from '@/lib/utils';

const tabs = [
  { id: 'general', label: '基本设置' },
  { id: 'appearance', label: '外观设置' },
  { id: 'seo', label: 'SEO 设置' },
  { id: 'security', label: '安全设置' },
  { id: 'storage', label: '存储设置' },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">系统设置</h1>
        <p className="text-gray-400 mt-1">配置博客系统参数</p>
      </div>

      <div className="flex gap-6">
        {/* 左侧标签 */}
        <div className="w-48 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium',
                'transition-all duration-200',
                activeTab === tab.id
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 右侧内容 */}
        <div className="flex-1 p-6 rounded-xl bg-white/5 border border-white/10">
          <div className="text-center py-12 text-gray-500">
            {tabs.find((t) => t.id === activeTab)?.label}（待实现）
          </div>
        </div>
      </div>
    </div>
  );
}
