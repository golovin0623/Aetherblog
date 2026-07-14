import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const consumers = [
  'components/layout/Sidebar.tsx',
  'components/common/CommandPalette.tsx',
  'components/layout/SidebarSearchPalette.tsx',
  'components/layout/AdminLayout.tsx',
] as const;

describe('Intelligence navigation consumers', () => {
  it.each(consumers)('%s imports the shared navigation contract', (relativePath) => {
    const source = readFileSync(resolve(import.meta.dirname, '..', relativePath), 'utf8');

    expect(source).toContain("@/navigation/intelligenceNavigation");
  });

  it.each(consumers)('%s does not privately maintain canonical destination literals', (relativePath) => {
    const source = readFileSync(resolve(import.meta.dirname, '..', relativePath), 'utf8');
    const canonicalRouteLiterals = [
      "'/aetherhub'",
      "'/notes'",
      "'/atlas'",
      "'/intelligence/knowledge'",
      "'/agent-workflows'",
      "'/ai-tools'",
      "'/qa'",
    ];

    for (const route of canonicalRouteLiterals) {
      expect(source, `${relativePath} still owns ${route}`).not.toContain(route);
    }
  });
});
