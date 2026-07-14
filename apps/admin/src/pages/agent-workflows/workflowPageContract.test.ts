import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(import.meta.dirname, 'AgentWorkflowsPage.tsx'), 'utf8');

describe('workflow page product contract', () => {
  it('keeps the goal and review steps ahead of the advanced canvas', () => {
    expect(pageSource).not.toContain('打开当前高级编排');
    expect(pageSource).not.toContain('onOpenCanvas');
    expect(pageSource).not.toContain('每周检查');
  });

  it('does not present cached resource counts or unavailable metrics as exact facts', () => {
    expect(pageSource).not.toContain('const stats =');
    expect(pageSource).not.toContain('{stats.map');
    expect(pageSource).not.toContain('metrics?.totalRuns ?? 0');
    expect(pageSource).not.toContain('metrics?.successRuns ?? 0');
    expect(pageSource).toContain('activeWorkflowIdRef.current');
    expect(pageSource).toContain('setMetrics(null);');
  });

  it('does not report success when a backend mutation omits its result', () => {
    expect(pageSource).not.toContain('if (!saved) return next');
    expect(pageSource).not.toContain("run?.status || 'pending'");
    expect(pageSource).not.toContain('publication?.slug || workflow.id');
    expect(pageSource).not.toContain('response.data?.definition || buildDefinition()');
    expect(pageSource).not.toContain("response.data?.status || 'ok'");
    expect(pageSource).not.toContain('真实运行默认开启');
  });

  it('uses admin-facing section and run-state labels on the expert surface', () => {
    for (const heading of ['Workflows', 'Templates', 'Node Palette', 'Inspector', 'Selected Node', 'Run Inputs', 'Variables', 'Tool Catalog', 'Run History', 'Trace']) {
      expect(pageSource).not.toContain(`title="${heading}"`);
    }
    expect(pageSource).toContain('workflowRunStatusLabel(selectedRun.status)');
    expect(pageSource).toContain('workflowRunStatusLabel(run.status)');
    expect(pageSource).toContain('这次运行没有返回可核验的执行轨迹');
  });

  it('makes compact operations reachable and self-describing on mobile', () => {
    expect(pageSource).toContain('aria-label="搜索工具目录"');
    expect(pageSource).toContain('aria-pressed={isActive}');
    expect(pageSource).toContain('aria-label="返回目标与执行草案"');
    expect(pageSource).toContain('h-11 md:h-9');
    expect(pageSource).not.toContain('className="h-8 rounded-md border');
    expect(pageSource).toContain('surface-raised flex min-h-[520px] flex-col');
    expect(pageSource).toContain('gap-1 md:gap-2');
    expect(pageSource).not.toContain('h-[calc(100%-3.5rem)]');
  });
});
