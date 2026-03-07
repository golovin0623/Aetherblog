import { Info, ShieldAlert, TriangleAlert, Lightbulb, StickyNote } from 'lucide-react';

interface AlertBlockProps {
  type: 'info' | 'note' | 'warning' | 'danger' | 'tip';
  title?: string;
  children: React.ReactNode;
}

const TYPE_CONFIG = {
  info:    { icon: Info,          title: '信息' },
  note:    { icon: StickyNote,    title: '注意' },
  warning: { icon: TriangleAlert, title: '警告' },
  danger:  { icon: ShieldAlert,   title: '危险' },
  tip:     { icon: Lightbulb,     title: '提示' },
};

export const AlertBlock: React.FC<AlertBlockProps> = ({ type, title, children }) => {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.info;
  const Icon = config.icon;
  const displayTitle = title || config.title;
  const childText = typeof children === 'string' ? children : null;
  const isPlaceholderOnly = childText !== null && childText.replace(/\u200B/g, '').trim() === '';

  return (
    <div 
      className={`alert-block alert-block--${type} my-6 px-5 py-4 rounded-md border-l-[4px]`}
      style={{
        backgroundColor: 'var(--alert-bg)',
        borderLeftColor: 'var(--alert-border)',
        color: 'var(--alert-text)'
      }}
    >
      <div 
        className="flex items-center gap-2 font-bold mb-1.5"
        style={{ color: 'var(--alert-title-color)' }}
      >
        <Icon 
          className="w-5 h-5 flex-shrink-0"
          style={{ color: 'var(--alert-icon-color)' }}
          strokeWidth={2.5}
        />
        <span>{displayTitle}</span>
      </div>
      {!isPlaceholderOnly && (
        <div className="alert-content opacity-90 leading-relaxed text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
          {children}
        </div>
      )}
    </div>
  );
};

export default AlertBlock;
