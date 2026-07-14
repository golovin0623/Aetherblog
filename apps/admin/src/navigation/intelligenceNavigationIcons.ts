import {
  BookOpen,
  BrainCircuit,
  Compass,
  Highlighter,
  Library,
  Plus,
  ScanText,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import type { IntelligenceIconKey } from './intelligenceNavigation';

/** UI adapter kept separate so pure navigation tests never load React/Lucide. */
export const intelligenceNavigationIcons: Readonly<Record<IntelligenceIconKey, LucideIcon>> = {
  workspace: BrainCircuit,
  aetherhub: Sparkles,
  notes: BookOpen,
  atlas: Compass,
  knowledge: Library,
  'agent-workflows': Workflow,
  'ai-tools': Highlighter,
  qa: ScanText,
  'create-note': Plus,
};

export function getIntelligenceNavigationIcon(iconKey: IntelligenceIconKey): LucideIcon {
  return intelligenceNavigationIcons[iconKey];
}
