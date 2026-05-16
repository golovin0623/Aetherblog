import { useState } from 'react';
import { Activity, Boxes, ChartSpline, Terminal } from 'lucide-react';
import {
  SystemTrends,
  SystemStatus,
  ContainerStatus,
  RealtimeLogViewer
} from './dashboard/components';
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';

export default function MonitorPage() {
  // 容器日志状态
  const [selectedContainer, setSelectedContainer] = useState<{id: string, name: string}>({id: '', name: ''});

  const handleContainerSelect = (id: string, name: string) => {
    setSelectedContainer({id, name});
  };

  return (
    <div className="admin-grid-page dashboard-page monitor-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          title="系统监控"
          icon={Activity}
          currentLabel={selectedContainer.name ? `当前日志：${selectedContainer.name}` : '自动刷新：30 秒'}
          description="集中观测系统负载、服务健康、容器资源与实时日志。"
          activeSummary="当前工作区：负载趋势、服务健康、实时日志与容器资源。"
        />

        {/* 第一行：系统趋势与状态 */}
        <section className="monitor-section-grid monitor-section-grid-primary" aria-label="系统资源与健康状态">
          <div className="monitor-panel lg:col-span-2">
            <div className="monitor-section-kicker">
              <ChartSpline className="h-3.5 w-3.5" />
              资源趋势
            </div>
            <SystemTrends className="monitor-card monitor-card-trend" />
          </div>
          <div className="monitor-panel lg:col-span-1">
            <div className="monitor-section-kicker">
              <Activity className="h-3.5 w-3.5" />
              健康状态
            </div>
            <SystemStatus refreshInterval={30} className="monitor-card monitor-card-status" />
          </div>
        </section>

        {/* 第二行：日志与容器状态 */}
        <section className="monitor-section-grid monitor-section-grid-ops" aria-label="实时日志与容器状态">
          <div className="monitor-panel lg:col-span-2">
            <div className="monitor-section-kicker">
              <Terminal className="h-3.5 w-3.5" />
              实时日志
            </div>
            <RealtimeLogViewer
              containerId={selectedContainer.id}
              containerName={selectedContainer.name}
              className="monitor-card monitor-card-log"
            />
          </div>
          <div className="monitor-panel lg:col-span-1">
            <div className="monitor-section-kicker">
              <Boxes className="h-3.5 w-3.5" />
              容器资源
            </div>
            <ContainerStatus
              refreshInterval={30}
              onSelectContainer={handleContainerSelect}
              selectedId={selectedContainer.id}
              className="monitor-card monitor-card-containers"
            />
          </div>
        </section>

      </div>
    </div>
  );
}
