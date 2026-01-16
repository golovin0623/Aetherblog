import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, RefreshCw, Globe, Palette, Search, Shield, Database, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { settingsService } from '@/services/settingsService';
import { toast } from 'sonner';

// Setting Metadata Definition
// Helps mapping raw keys to UI labels and input types
type SettingFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'color' | 'url';

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
      { key: 'site_title', label: '站点标题', type: 'text', placeholder: '我的博客' },
      { key: 'site_subtitle', label: '副标题', type: 'text', placeholder: '分享技术与生活' },
      { key: 'site_description', label: '站点描述', type: 'textarea', description: '用于 SEO 和首页展示' },
      { key: 'site_url', label: '站点地址', type: 'url', placeholder: 'https://example.com' },
      { key: 'site_keywords', label: '关键词', type: 'text', description: '逗号分隔，如: tech, blog, react' },
      { key: 'site_author', label: '博主名称', type: 'text', placeholder: 'Admin' },
      { key: 'site_email', label: '联系邮箱', type: 'text' },
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
  social: {
    label: '社交信息',
    icon: Shield,
    fields: [
      { key: 'social_github', label: 'GitHub', type: 'url' },
      { key: 'social_twitter', label: 'Twitter / X', type: 'url' },
      { key: 'social_linkedin', label: 'LinkedIn', type: 'url' },
      { key: 'social_weibo', label: 'Weibo', type: 'url' },
    ]
  },
  advanced: {
    label: '高级设置',
    icon: Database,
    fields: [
      { key: 'enable_registrations', label: '允许用户注册', type: 'boolean' },
      { key: 'enable_comments', label: '全局开启评论', type: 'boolean' },
      { key: 'comment_need_audit', label: '评论需要审核', type: 'boolean' },
      { key: 'upload_max_size', label: '最大上传 (MB)', type: 'number', placeholder: '10' },
    ]
  }
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  // Local state form data (for editing before save)
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const queryClient = useQueryClient();

  // Query: Get All Settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.getAll(),
  });

  // Sync server data to local form data
  useEffect(() => {
    if (settings) {
      setFormData(prev => ({
        ...settings,
        ...prev // Keep local changes if any (simple approach)
      }));
       // If clean load, reset changes
       if (!hasChanges) {
          setFormData(settings);
       }
    }
  }, [settings]); // Only sync when settings fetch updates, careful with loop

  // Mutation: Batch Update
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      // Convert all values to strings for backend
      const stringMap: Record<string, string> = {};
      Object.keys(data).forEach(key => {
        if (data[key] !== undefined && data[key] !== null) {
          stringMap[key] = String(data[key]);
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
        {/* Sidebar Nav */}
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

        {/* Main Content Area */}
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
                  
                  {/* Dynamic Field Rendering */}
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
