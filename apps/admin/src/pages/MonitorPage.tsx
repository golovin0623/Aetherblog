import { useState } from 'react';
import { 
  SystemTrends, 
  SystemStatus, 
  ContainerStatus, 
  RealtimeLogViewer 
} from './dashboard/components';

export default function MonitorPage() {
  // Container Logs State
  const [selectedContainer, setSelectedContainer] = useState<{id: string, name: string}>({id: '', name: ''});

  const handleContainerSelect = (id: string, name: string) => {
    setSelectedContainer({id, name});
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">系统监控</h1>
        <p className="text-[var(--text-muted)] mt-1">实时监控系统运行状态与资源趋势</p>
      </div>

      {/* Row 1: System Trends & Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SystemTrends className="h-[500px]" />
        </div>
        <div className="lg:col-span-1">
          <SystemStatus refreshInterval={30} className="h-[500px]" />
        </div>
      </div>

      {/* Row 2: Logs & Container Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <RealtimeLogViewer 
            containerId={selectedContainer.id}
            containerName={selectedContainer.name}
            className="h-[500px]"
          />
        </div>
        <div className="lg:col-span-1">
          <ContainerStatus 
            refreshInterval={30}
            onSelectContainer={handleContainerSelect}
            selectedId={selectedContainer.id}
            className="h-[500px]" 
          />
        </div>
      </div>
    </div>
  );
}
