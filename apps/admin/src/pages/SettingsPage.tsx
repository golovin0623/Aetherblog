import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, RefreshCw, Globe, Palette, Search, Database, Loader2, User, MessageSquare, Sparkles } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { settingsService } from '@/services/settingsService';
import { toast } from 'sonner';
import { SocialLinksEditor, type SocialLink } from '@/components/settings/SocialLinksEditor';

// Setting Metadata Definition
// Helps mapping raw keys to UI labels and input types
type SettingFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'color' | 'url' | 'social-links';

interface SettingField {
  key: string;
  label: string;
  type: SettingFieldType;
  description?: string;
  placeholder?: string;
}

const SETTING_GROUPS: Record<string, { label: string; icon: any; fields: SettingField[] }> = {
  general: {
    label: '基本设置',
    icon: Globe,
    fields: [
      { key: 'site_name', label: '站点名称', type: 'text', placeholder: 'AetherBlog' },
      { key: 'site_description', label: '站点描述', type: 'textarea', description: '用于 SEO 和首页展示' },
      { key: 'site_url', label: '站点地址', type: 'url', placeholder: 'https://example.com' },
      { key: 'site_keywords', label: '关键词', type: 'text', description: '逗号分隔，如: tech, blog, react' },
      { key: 'footer_text', label: '页脚文字', type: 'text' },
      { key: 'footer_signature', label: '个性签名', type: 'text' },
      { key: 'icp_number', label: 'ICP备案号', type: 'text' },
    ]
  },
  author: {
    label: '博主信息',
    icon: User,
    fields: [
      { key: 'author_name', label: '博主名称', type: 'text', placeholder: 'Admin' },
      { key: 'author_bio', label: '博主简介', type: 'textarea' },
      { key: 'author_avatar', label: '头像URL', type: 'url' },
      { key: 'author_email', label: '联系邮箱', type: 'text' },
      { key: 'social_links', label: '社交链接', type: 'social-links', description: '添加您的社交媒体账号' },
    ]
  },
  welcome: {
    label: '欢迎页设置',
    icon: Sparkles,
    fields: [
      { key: 'welcome_enabled', label: '启用欢迎页', type: 'boolean' },
      { key: 'welcome_title', label: '欢迎标题', type: 'text' },
      { key: 'welcome_subtitle', label: '欢迎副标题', type: 'text' },
      { key: 'welcome_description', label: '欢迎描述', type: 'textarea', placeholder: '智能写作、语义搜索、优雅呈现' },
      { key: 'welcome_primary_btn_text', label: '主按钮文案', type: 'text', placeholder: '浏览文章' },
      { key: 'welcome_primary_btn_link', label: '主按钮链接', type: 'text', placeholder: '/posts' },
      { key: 'welcome_secondary_btn_text', label: '副按钮文案', type: 'text', placeholder: '关于我' },
      { key: 'welcome_secondary_btn_link', label: '副按钮链接', type: 'text', placeholder: '/about' },
    ]
  },
  appearance: {
    label: '外观设置',
    icon: Palette,
    fields: [
      { key: 'theme_primary_color', label: '主色调', type: 'color' },
      { key: 'enable_dark_mode', label: '强制暗黑模式', type: 'boolean', description: '若关闭则跟随系统' },
      { key: 'show_banner', label: '显示首页 Banner', type: 'boolean' },
      { key: 'post_page_size', label: '每页文章数', type: 'number', placeholder: '10' },
      { key: 'custom_css', label: '自定义 CSS', type: 'textarea', description: '危险操作，请谨慎修改' },
    ]
  },
  seo: {
    label: 'SEO 设置',
    icon: Search,
    fields: [
      { key: 'seo_robots', label: 'Robots.txt 内容', type: 'textarea' },
      { key: 'enable_sitemap', label: '启用 Sitemap', type: 'boolean' },
      { key: 'baidu_analytics_id', label: '百度统计 ID', type: 'text' },
      { key: 'google_analytics_id', label: 'Google Analytics ID', type: 'text' },
    ]
  },
  comment: {
    label: '评论设置',
    icon: MessageSquare,
    fields: [
      { key: 'comment_enabled', label: '启用评论', type: 'boolean' },
      { key: 'comment_audit', label: '评论需审核', type: 'boolean' },
    ]
  },
  advanced: {
    label: '高级设置',
    icon: Database,
    fields: [
      { key: 'enable_registrations', label: '允许用户注册', type: 'boolean' },
      { key: 'upload_max_size', label: '最大上传 (MB)', type: 'number', placeholder: '10' },
      { key: 'storage_type', label: '存储类型', type: 'text', description: 'LOCAL, MINIO, COS' },
      { key: 'ai_enabled', label: '启用AI功能', type: 'boolean' },
      { key: 'ai_provider', label: 'AI服务商', type: 'text' },
    ]
  }
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  // 本地状态表单数据（用于保存前编辑）
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const queryClient = useQueryClient();

  // 查询：获取所有设置
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.getAll(),
  });

  // 同步服务器数据到本地表单数据
  useEffect(() => {
    if (settings) {
      setFormData(prev => ({
        ...settings,
        ...prev // 保留本地更改（如果存在）（简单方法）
      }));
       // 如果是全新加载，重置更改
       if (!hasChanges) {
          setFormData(settings);
       }
    }
  }, [settings]); // 仅在设置获取更新时同步，小心循环

  // 变更：批量更新
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      // 将所有值转换为字符串以供后端使用
      const stringMap: Record<string, string> = {};
      Object.keys(data).forEach(key => {
        if (data[key] !== undefined && data[key] !== null) {
          // 对于对象/数组类型（如 social_links），转换为 JSON 字符串
          if (typeof data[key] === 'object') {
            stringMap[key] = JSON.stringify(data[key]);
          } else {
            stringMap[key] = String(data[key]);
          }
        }
      });
      return settingsService.batchUpdate(stringMap);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('设置已保存');
      setHasChanges(false);
    },
    onError: () => {
      toast.error('保存失败');
    }
  });

  const handleInputChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const handleReset = () => {
    if (settings) {
      setFormData(settings);
      setHasChanges(false);
      toast.success('已重置更改');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const activeGroup = SETTING_GROUPS[activeTab];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">系统设置</h1>
          <p className="text-[var(--text-muted)] mt-1">配置博客系统参数</p>
        </div>
        <div className="flex items-center gap-3">
           <AnimatePresence>
             {hasChanges && (
               <motion.div
                 initial={{ opacity: 0, x: 20 }}
                 animate={{ opacity: 1, x: 0 }}
                 exit={{ opacity: 0, x: 20 }}
                 className="flex items-center gap-2"
               >
                 <button
                    onClick={handleReset}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-colors text-sm"
                 >
                   <RefreshCw className="w-4 h-4" /> 重置
                 </button>
                 <button
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors text-sm shadow-lg shadow-primary/20"
                 >
                   {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                   保存更改
                 </button>
               </motion.div>
             )}
           </AnimatePresence>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 侧边栏导航 */}
        <div className="w-full lg:w-48 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
          {Object.entries(SETTING_GROUPS).map(([key, group]) => {
            const Icon = group.icon;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap lg:whitespace-normal shrink-0',
                  'transition-all duration-200',
                  activeTab === key
                    ? 'bg-primary text-white shadow-md'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                )}
              >
                <Icon className="w-4 h-4" />
                {group.label}
              </button>
            );
          })}
        </div>

        {/* 主要内容区域 */}
        <div className="flex-1">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-6"
          >
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2 mb-1">
                <activeGroup.icon className="w-5 h-5 text-[var(--text-muted)]" />
                {activeGroup.label}
              </h2>
              <p className="text-sm text-[var(--text-muted)]">
                管理您的{activeGroup.label}。所有更改需点击右上角保存按钮生效。
              </p>
            </div>

            <div className="space-y-5">
              {activeGroup.fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">
                      {field.label}
                    </label>
                  </div>
                  
                  {/* 动态字段渲染 */}
                  {field.type === 'text' || field.type === 'url' || field.type === 'number' ? (
                    <input
                      type={field.type}
                      value={formData[field.key] || ''}
                      onChange={(e) => handleInputChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all"
                    />
                  ) : field.type === 'textarea' ? (
                    <textarea
                      rows={4}
                      value={formData[field.key] || ''}
                      onChange={(e) => handleInputChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all resize-none font-mono"
                    />
                  ) : field.type === 'boolean' ? (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleInputChange(field.key, !formData[field.key])}
                        className={cn(
                          "w-11 h-6 rounded-full transition-colors relative",
                          formData[field.key] === 'true' || formData[field.key] === true ? "bg-primary" : "bg-[var(--bg-input)]"
                        )}
                      >
                        <motion.div
                          animate={{ x: formData[field.key] === 'true' || formData[field.key] === true ? 20 : 2 }}
                          className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
                        />
                      </button>
                      <span className="text-sm text-[var(--text-muted)]">
                        {formData[field.key] === 'true' || formData[field.key] === true ? '已开启' : '已关闭'}
                      </span>
                    </div>
                  ) : field.type === 'color' ? (
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={formData[field.key] || '#000000'}
                        onChange={(e) => handleInputChange(field.key, e.target.value)}
                        className="bg-transparent border-0 w-10 h-10 p-0 cursor-pointer overflow-hidden rounded-lg"
                      />
                      <input
                        type="text"
                        value={formData[field.key] || ''}
                        onChange={(e) => handleInputChange(field.key, e.target.value)}
                        className="w-32 px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none font-mono"
                      />
                    </div>
                  ) : field.type === 'social-links' ? (
                    <SocialLinksEditor
                      value={(() => {
                        // 解析 social_links，可能是 JSON 字符串或已解析的数组
                        const raw = formData[field.key];
                        if (!raw) return [];
                        if (Array.isArray(raw)) return raw;
                        try {
                          return JSON.parse(raw);
                        } catch {
                          return [];
                        }
                      })()}
                      onChange={(links) => handleInputChange(field.key, links)}
                    />
                  ) : null}

                  {field.description && (
                    <p className="text-xs text-[var(--text-muted)]">{field.description}</p>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
