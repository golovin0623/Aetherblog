import { useState } from 'react';
import { Save, Globe, Bell, Shield, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

type SettingsTab = 'site' | 'notification' | 'security' | 'appearance';

export function SiteSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('site');
  const [settings, setSettings] = useState({
    siteName: 'AetherBlog',
    siteDescription: '智能博客系统',
    siteUrl: 'https://example.com',
    siteKeywords: 'blog, tech, AI',
    enableComments: true,
    commentModeration: true,
    enableNewsletter: false,
    emailNotification: true,
  });

  const tabs = [
    { id: 'site' as SettingsTab, label: '站点设置', icon: Globe },
    { id: 'notification' as SettingsTab, label: '通知设置', icon: Bell },
    { id: 'security' as SettingsTab, label: '安全设置', icon: Shield },
    { id: 'appearance' as SettingsTab, label: '外观设置', icon: Palette },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">系统设置</h1>
        <p className="text-gray-400 mt-1">配置博客系统的各项参数</p>
      </div>

      {/* Mobile Tabs - 移动端水平标签 */}
      <div className="lg:hidden overflow-x-auto">
        <div className="flex gap-1 p-1 rounded-lg bg-white/5 border border-white/5 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors touch-manipulation",
                activeTab === tab.id
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:bg-white/10 hover:text-white'
              )}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.replace('设置', '')}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Desktop Sidebar - 桌面端侧边栏 */}
        <div className="hidden lg:block w-56 space-y-1 flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors",
                activeTab === tab.id
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:bg-white/10 hover:text-white'
              )}
            >
              <tab.icon className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 sm:p-6">
          {activeTab === 'site' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">站点基本信息</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">站点名称</label>
                  <input
                    type="text"
                    value={settings.siteName}
                    onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">站点URL</label>
                  <input
                    type="text"
                    value={settings.siteUrl}
                    onChange={(e) => setSettings({ ...settings, siteUrl: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">站点描述</label>
                <textarea
                  value={settings.siteDescription}
                  onChange={(e) => setSettings({ ...settings, siteDescription: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white resize-none focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">SEO关键词</label>
                <input
                  type="text"
                  value={settings.siteKeywords}
                  onChange={(e) => setSettings({ ...settings, siteKeywords: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>
          )}

          {activeTab === 'notification' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">通知设置</h3>
              <div className="space-y-4">
                <label className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-white/5">
                  <div>
                    <p className="text-white">邮件通知</p>
                    <p className="text-sm text-gray-500">在有新评论时发送邮件</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.emailNotification}
                    onChange={(e) => setSettings({ ...settings, emailNotification: e.target.checked })}
                    className="w-5 h-5 accent-primary flex-shrink-0"
                  />
                </label>
                <label className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-white/5">
                  <div>
                    <p className="text-white">评论审核</p>
                    <p className="text-sm text-gray-500">新评论需要审核后才能显示</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.commentModeration}
                    onChange={(e) => setSettings({ ...settings, commentModeration: e.target.checked })}
                    className="w-5 h-5 accent-primary flex-shrink-0"
                  />
                </label>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">安全设置</h3>
              <p className="text-gray-500">安全设置功能开发中...</p>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">外观设置</h3>
              <p className="text-gray-500">外观设置功能开发中...</p>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-white/10 flex justify-end">
            <button className="flex items-center gap-2 px-6 py-2 rounded-lg bg-primary text-white hover:bg-primary/80 transition-colors touch-manipulation">
              <Save className="w-4 h-4" />
              保存设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SiteSettingsPage;

