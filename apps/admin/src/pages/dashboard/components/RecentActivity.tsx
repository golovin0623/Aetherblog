import { 
  FileText, 
  MessageSquare, 
  UserPlus, 
  AlertTriangle, 
  CheckCircle2,
  Clock 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export type ActivityType = 'post' | 'comment' | 'user' | 'system' | 'warning';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: string;
  user?: {
    name: string;
    avatar?: string;
  };
}

interface RecentActivityProps {
  activities?: ActivityItem[];
  loading?: boolean;
}

export function RecentActivity({ 
  activities = [
    {
      id: '1',
      type: 'post',
      title: '发布了新文章《深入理解 React Server Components》',
      timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 mins ago
      user: { name: 'Admin' }
    },
    {
      id: '2',
      type: 'comment',
      title: '收到新的评论待审核',
      description: '写得很好，受益匪浅！',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
      user: { name: 'Visitor_123' }
    },
    {
      id: '3',
      type: 'system',
      title: '系统自动备份完成',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), // 5 hours ago
    },
    {
      id: '4',
      type: 'warning',
      title: '检测到异常登录尝试',
      description: 'IP: 192.168.1.1',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
    },
  ],
  loading 
}: RecentActivityProps) {

  const getIcon = (type: ActivityType) => {
    switch (type) {
      case 'post': return <FileText className="w-4 h-4 text-blue-400" />;
      case 'comment': return <MessageSquare className="w-4 h-4 text-green-400" />;
      case 'user': return <UserPlus className="w-4 h-4 text-purple-400" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'system': default: return <CheckCircle2 className="w-4 h-4 text-gray-400" />;
    }
  };

  const getBgColor = (type: ActivityType) => {
    switch (type) {
      case 'post': return 'bg-blue-500/10 border-blue-500/20';
      case 'comment': return 'bg-green-500/10 border-green-500/20';
      case 'user': return 'bg-purple-500/10 border-purple-500/20';
      case 'warning': return 'bg-red-500/10 border-red-500/20';
      case 'system': default: return 'bg-white/5 border-white/10';
    }
  };

  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[400px] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">最近动态</h3>
        <button className="text-xs text-primary hover:text-primary/80 transition-colors">
          查看全部
        </button>
      </div>

      <div className="space-y-6 relative ml-3">
        {/* Vertical Line */}
        <div className="absolute left-0 top-2 bottom-2 w-px bg-white/10" />

        {activities.map((item) => (
          <div key={item.id} className="relative pl-8">
            {/* Timeline Dot */}
            <div className={cn(
              "absolute left-[-11px] top-1 w-6 h-6 rounded-full border flex items-center justify-center bg-black/50 backdrop-blur-sm",
              getBgColor(item.type).replace('bg-', 'border-')
            )}>
              {getIcon(item.type)}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">{item.title}</p>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Clock className="w-3 h-3" />
                  <span>
                    {formatDistanceToNow(new Date(item.timestamp), { 
                      addSuffix: true, 
                      locale: zhCN 
                    })}
                  </span>
                </div>
              </div>
              
              {item.description && (
                <p className="text-xs text-gray-400 line-clamp-2">
                  {item.description}
                </p>
              )}
              
              {item.user && (
                <p className="text-xs text-gray-500 mt-1">
                  by <span className="text-gray-300">{item.user.name}</span>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RecentActivity;
