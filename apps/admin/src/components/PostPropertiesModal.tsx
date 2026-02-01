import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  isToday, 
  set, 
  parseISO, 
  getHours, 
  getMinutes 
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Modal } from '@aetherblog/ui';
import { Post } from '@/services/postService';
import { UpdatePostPropertiesRequest } from '@/types/post';
import { Category } from '@/services/categoryService';
import { Tag } from '@/services/tagService';
import { X, Calendar, Eye, EyeOff, Loader2, Search, Hash, Lock, Globe, Trash2, ChevronLeft, ChevronRight, Clock, Check, Plus, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface PostPropertiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  post: Post;  // 已从 PostListItem 改为 Post 以获取完整数据
  categories: Category[];
  tags: Tag[];
  onSave: (data: UpdatePostPropertiesRequest) => Promise<void>;
}

const TAG_COLORS = [
  { border: 'border-violet-500/30', bg: 'bg-violet-500/10', text: 'text-violet-300', icon: 'text-violet-400', glow: 'shadow-violet-500/10' },
  { border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-300', icon: 'text-blue-400', glow: 'shadow-blue-500/10' },
  { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-300', icon: 'text-emerald-400', glow: 'shadow-emerald-500/10' },
  { border: 'border-rose-500/30', bg: 'bg-rose-500/10', text: 'text-rose-300', icon: 'text-rose-400', glow: 'shadow-rose-500/10' },
  { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-300', icon: 'text-amber-400', glow: 'shadow-amber-500/10' },
  { border: 'border-cyan-500/30', bg: 'bg-cyan-500/10', text: 'text-cyan-300', icon: 'text-cyan-400', glow: 'shadow-cyan-500/10' },
];

export function PostPropertiesModal({
  isOpen,
  onClose,
  post,
  categories,
  tags,
  onSave,
}: PostPropertiesModalProps) {
  const [formData, setFormData] = useState<UpdatePostPropertiesRequest>({});
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef<HTMLDivElement>(null);

  // 点击外部时关闭日期选择器
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 直接从 Post 初始化表单数据 - 所有数据均可用
  useEffect(() => {
    if (isOpen && post) {
      // 如果 categoryId 缺失/为空，使用嵌套对象中的 category.id
      const effectiveCategoryId = post.categoryId || post.category?.id;
      
      setFormData({
        title: post.title,
        summary: post.summary || '',
        coverImage: post.coverImage || '',
        status: post.status,
        isPinned: post.isPinned ?? false,
        pinPriority: post.pinPriority ?? 0,
        slug: post.slug,
        createdAt: post.createdAt,
        categoryId: effectiveCategoryId ?? undefined,
        password: '',
      });
      
      // Tags 已符合 Post 中的 {id, name} 格式
      setSelectedTags(post.tags?.map(t => t.id) || []);
      setTagSearch('');
    }
  }, [isOpen, post]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSave({
        ...formData,
        tagIds: selectedTags.length > 0 ? selectedTags : undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to update post properties:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTag = (tagId: number) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const filteredTags = tags.filter(t => 
    !tagSearch || t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );

  const getTagColor = (index: number) => TAG_COLORS[index % TAG_COLORS.length];

  // --- 自定义日期选择器组件 ---
  const DatePickerPopover = ({ 
    value, 
    onChange 
  }: { 
    value: string | undefined; 
    onChange: (date: string) => void 
  }) => {
    const [viewDate, setViewDate] = useState(value ? new Date(value) : new Date());
    const [showTimeSelect, setShowTimeSelect] = useState(false);
    
    const selectedDate = useMemo(() => value ? new Date(value) : null, [value]);
    
    const days = useMemo(() => {
      const monthStart = startOfMonth(viewDate);
      const monthEnd = endOfMonth(monthStart);
      const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
      const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
      
      return eachDayOfInterval({ start: startDate, end: endDate });
    }, [viewDate]);

    const handleMonthNav = (direction: 'next' | 'prev') => {
      setViewDate(prev => direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1));
    };

    const handleDateSelect = (date: Date) => {
      const current = selectedDate || new Date();
      const updated = set(date, {
        hours: getHours(current),
        minutes: getMinutes(current),
        seconds: 0,
        milliseconds: 0
      });
      onChange(updated.toISOString());
    };

    const handleTimeChange = (unit: 'hours' | 'minutes', val: number) => {
      const current = selectedDate || new Date();
      const updated = set(current, { [unit]: val });
      onChange(updated.toISOString());
    };

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="absolute bottom-full left-0 mb-2 w-[280px] bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-[60] overflow-hidden"
      >
        {!showTimeSelect ? (
          <div className="p-4">
            {/* 日历头部 */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-white">
                {format(viewDate, 'yyyy年 MM月', { locale: zhCN })}
              </span>
              <div className="flex gap-1">
                <button 
                  type="button" 
                  onClick={() => handleMonthNav('prev')}
                  className="p-1 hover:bg-white/5 rounded-md text-gray-400 hover:text-white"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button 
                  type="button" 
                  onClick={() => handleMonthNav('next')}
                  className="p-1 hover:bg-white/5 rounded-md text-gray-400 hover:text-white"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 日历网格 */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['一', '二', '三', '四', '五', '六', '日'].map(d => (
                <div key={d} className="text-[10px] font-bold text-gray-500 text-center py-1">
                  {d}
                </div>
              ))}
              {days.map((date, i) => {
                const isCurrentMonth = isSameMonth(date, viewDate);
                const isSelected = selectedDate && isSameDay(date, selectedDate);
                const isCurrentToday = isToday(date);
                
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleDateSelect(date)}
                    className={cn(
                      "h-8 rounded-lg text-xs transition-all flex items-center justify-center relative",
                      !isCurrentMonth ? "text-gray-600" : "text-gray-300 hover:bg-white/10",
                      isCurrentToday && "text-primary font-bold after:content-[''] after:absolute after:bottom-1 after:w-1 after:h-1 after:bg-primary after:rounded-full",
                      isSelected && "bg-primary text-white hover:bg-primary shadow-lg shadow-primary/20"
                    )}
                  >
                    {format(date, 'd')}
                  </button>
                );
              })}
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between pt-3 border-t border-white/5 mt-3">
              <button
                type="button"
                onClick={() => setShowTimeSelect(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <Clock className="w-3.5 h-3.5" />
                {selectedDate ? format(selectedDate, 'HH:mm') : '选择时间'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  onChange(now.toISOString());
                  setViewDate(now);
                }}
                className="text-xs text-primary hover:underline font-medium"
              >
                回到今天
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-semibold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                时间选择
              </span>
              <button 
                type="button"
                onClick={() => setShowTimeSelect(false)}
                className="text-xs text-gray-400 hover:text-white"
              >
                返回日历
              </button>
            </div>

            <div className="flex items-center justify-center gap-4 py-4">
              {/* 小时 */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">时</span>
                <div className="flex flex-col gap-1 h-32 overflow-y-auto no-scrollbar px-2 snap-y">
                  {Array.from({ length: 24 }).map((_, h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => handleTimeChange('hours', h)}
                      className={cn(
                        "w-10 py-1.5 rounded-lg text-sm transition-all snap-center",
                        selectedDate && getHours(selectedDate) === h
                          ? "bg-primary text-white"
                          : "text-gray-400 hover:bg-white/5"
                      )}
                    >
                      {h.toString().padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>
              <span className="text-xl text-gray-600 font-light">:</span>
              {/* 分钟 */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">分</span>
                <div className="flex flex-col gap-1 h-32 overflow-y-auto no-scrollbar px-2 snap-y">
                  {Array.from({ length: 12 }).map((_, i) => {
                    const m = i * 5;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleTimeChange('minutes', m)}
                        className={cn(
                          "w-10 py-1.5 rounded-lg text-sm transition-all snap-center",
                          selectedDate && getMinutes(selectedDate) === m
                            ? "bg-primary text-white"
                            : "text-gray-400 hover:bg-white/5"
                        )}
                      >
                        {m.toString().padStart(2, '0')}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTimeSelect(false)}
              className="w-full mt-4 py-2 bg-primary text-white rounded-xl text-sm font-medium shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" />
              确定
            </button>
          </div>
        )}
      </motion.div>
    );
  };

  // 格式化日期以用于显示 (YYYY-MM-DD HH:mm)
  const formatDateDisplay = (dateString: string | undefined): string => {
    if (!dateString) return '请选择时间';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '无效时间';
      return format(date, 'yyyy-MM-dd HH:mm');
    } catch {
      return '无效时间';
    }
  };

  const inputClass = "w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent transition-all hover:bg-white/[0.08]";
  const labelClass = "block text-sm font-medium text-gray-300 mb-2 flex items-center gap-1.5";

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title="修改信息">
      <form onSubmit={handleSubmit} className="flex flex-col h-[75vh]">
        {/* 可滚动内容区域 */}
        <div className="flex-1 overflow-y-auto px-1 pr-3 space-y-6 custom-scrollbar pb-6">
          
          {/* 标题 */}
          <div>
            <label className={labelClass}>
              <span className="text-red-400">*</span> 文章标题
            </label>
            <input
              type="text"
              value={formData.title || ''}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={inputClass}
              required
              placeholder="请输入文章标题"
            />
          </div>

          {/* 作者 - 只读 */}
          <div>
            <label className={labelClass}>作者</label>
            <div className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 select-none cursor-not-allowed">
              Golovin
            </div>
          </div>

          {/* 标签 - 左边框简卡风格 */}
          <div>
            <label className={labelClass}>
              <Hash className="w-3.5 h-3.5" /> 标签
            </label>
            <div className="space-y-3">
              {/* 标签搜索 */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  type="text" 
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="搜索标签..."
                  className={`${inputClass} pl-10 text-sm`}
                />
              </div>
              
              {/* 已选标签 - 左边框卡片网格 */}
              <div className="grid grid-cols-2 gap-2">
                <AnimatePresence mode="popLayout">
                  {tags.filter(t => selectedTags.includes(t.id)).map((tag, idx) => {
                    const color = getTagColor(idx);
                    return (
                      <motion.div
                        layout
                        initial={{ opacity: 0, scale: 0.95, y: 5 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 5 }}
                        key={tag.id}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 rounded-full border backdrop-blur-md transition-all group shadow-sm",
                          color.border, color.bg, color.glow
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Hash className={cn("w-3 h-3 shrink-0 opacity-60", color.icon)} />
                          <span className={cn("text-xs font-medium truncate", color.text)}>{tag.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className="ml-1.5 p-0.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* 未选标签池 */}
              {filteredTags.some(t => !selectedTags.includes(t.id)) && (
                <div className="flex flex-wrap gap-2 pt-3 border-t border-white/5">
                  {filteredTags.filter(t => !selectedTags.includes(t.id)).map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/5 text-[11px] text-gray-400 hover:text-primary hover:border-primary/40 hover:bg-primary/5 hover:shadow-[0_0_15px_rgba(var(--primary-rgb),0.1)] transition-all duration-300"
                    >
                      <Plus className="w-3 h-3" />
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 分类 */}
          <div>
            <label className={labelClass}>
              <span className="text-red-400">*</span> 分类
            </label>
            <div className="relative">
              <select
                value={formData.categoryId || ''}
                onChange={(e) => setFormData({ ...formData, categoryId: Number(e.target.value) })}
                className={`${inputClass} appearance-none cursor-pointer`}
                required
              >
                <option value="">请选择分类</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </div>
          </div>

          {/* 日期与置顶组 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* 创建时间 - 高级自定义日期选择器 */}
            <div className="relative" ref={datePickerRef}>
              <label className={labelClass}>
                <Calendar className="w-3.5 h-3.5" /> 创建时间
              </label>
              <button
                type="button" 
                className={cn(
                  inputClass,
                  "flex items-center justify-between cursor-pointer group w-full",
                  showDatePicker && "ring-2 ring-primary/50 border-primary"
                )}
                onClick={() => setShowDatePicker(!showDatePicker)}
              >
                <span className={formData.createdAt ? "text-white" : "text-gray-500"}>
                  {formatDateDisplay(formData.createdAt)}
                </span>
                <Calendar className={cn(
                  "w-4 h-4 transition-colors",
                  showDatePicker ? "text-primary" : "text-gray-500 group-hover:text-primary"
                )} />
              </button>
              
              <AnimatePresence>
                {showDatePicker && (
                  <DatePickerPopover 
                    value={formData.createdAt} 
                    onChange={(date) => setFormData({ ...formData, createdAt: date })}
                  />
                )}
              </AnimatePresence>
            </div>
            <div>
              <label className={labelClass}>置顶权重</label>
              <div className="relative group">
                <input
                  type="number"
                  value={formData.pinPriority || 0}
                  onChange={(e) => setFormData({ ...formData, pinPriority: Number(e.target.value) })}
                  min="0"
                  className={cn(inputClass, "pr-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none")}
                  placeholder="0"
                />
                <div className="absolute right-1 top-1 bottom-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, pinPriority: Math.max(0, (formData.pinPriority || 0) - 1) })}
                    className="w-8 h-full flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, pinPriority: (formData.pinPriority || 0) + 1 })}
                    className="w-8 h-full flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all border-l border-white/5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 别名 */}
          <div>
            <label className={labelClass}>
              <Globe className="w-3.5 h-3.5" /> URL 别名 (Slug)
            </label>
            <input
              type="text"
              value={formData.slug || ''}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              placeholder="默认使用文章ID"
              className={inputClass}
            />
          </div>

          {/* 扩展：高级可见性 */}
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
            <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              访问权限控制
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* 状态 */}
              <div>
                <label className="text-xs text-gray-500 mb-2 block">文章状态</label>
                <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                  {[
                    { value: 'PUBLISHED', label: '已发布' },
                    { value: 'DRAFT', label: '草稿' },
                    { value: 'ARCHIVED', label: '归档' },
                  ].map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, status: s.value as any })}
                      className={cn(
                        "flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all",
                        formData.status === s.value 
                          ? "bg-primary text-white shadow-lg shadow-primary/20" 
                          : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 密码保护 */}
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">访问密码</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password === undefined ? '' : formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="留空即公开访问"
                    className={`${inputClass} pr-10 text-sm`}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-1"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end pt-5 mt-2 border-t border-white/5 bg-transparent gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-all text-sm font-medium border border-white/5"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl bg-primary text-white hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 transition-all text-sm font-medium flex items-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? '保存中...' : '保存更改'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
