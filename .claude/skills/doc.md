# Doc - 交付前质量控制与文档同步

## Description
执行最严苛的质量控制与文档同步流程，确保代码、文档与设计的一致性。

## Trigger
/doc

## Instructions

当用户输入 `/doc` 时，必须严格按顺序执行以下五个阶段。在每个阶段完成后，简要报告结果，只有当前阶段通过后才能进入下一阶段。

### 阶段一：零容忍代码审计 (Zero-Tolerance Code Audit)

1. **类型安全检查**: 运行 `npx tsc --noEmit`。必须 0 错误。
2. **代码规范检查**: 运行 `npx eslint --fix "src/**/*.{ts,tsx}"`。
3. **依赖规范检查**:
   - 检查 `package.json`：确保所有使用的第三方库都已显式声明。
   - 检查导入路径：禁止使用 `../../../` 这种深层相对路径，必须使用别名 `@/` 或包名 `@aetherblog/*`。

### 阶段二：设计保真度验收 (Design Fidelity Check)

1. **视觉还原度**: 确认是否符合 "认知优雅" (Cognitive Elegance) 理念。检查是否使用了 Tailwind 预设变量 (如 `bg-[var(--bg-primary)]`) 而非硬编码颜色。
2. **图标合规性**:
   - AI 相关: 必须使用 `@lobehub/icons`。
   - 通用图标: 必须使用 `lucide-react`。
   - ❌ 严禁: 使用 Emoji 或未授权的 SVG。
3. **交互一致性**: 检查模态框、侧边栏是否使用了 `AnimatePresence` + `motion` 进出场动画。

### 阶段三：全栈文档维护 (Full-Stack Doc Maintenance)

**核心原则**: 文档是唯一的真理来源。代码变更必须反向同步到文档。

1. **详细设计文档** (`系统需求企划书及详细设计.md` & `code-design.md`):
   - 在底部 `CHANGELOG` 添加新版本。
   - 如果实现优于原设计，生成 **文档更新补丁 (PATCH)**。
2. **架构映射文档** (`code-structure.md`):
   - 检查实际文件树并更新文档中的 ASCII 树。
3. **路线图文档** (`code-tree.md` & `code-map.md`):
   - 确认任务 ID 并更新状态。
4. **规则文档** (`ui_rules.md`):
   - 如果发明了新的 UI 模式，将其提炼写入。

### 阶段四：交付物终审 (Artifact Finalization)

1. **Task Checklist (`task.md`)**: 必须全选 `[x]`。
2. **Walkthrough (`walkthrough.md`)**: 包含截图描述与最终构建日志。
3. **自我反思**: 检查是否修改了无关文件，术语使用是否精准。

### 阶段五：提交前通知

只有在所有检查通过后，通知用户：
"已执行深度文档维护，设计文档、架构文档、路线图均已同步。代码通过严苛审计。"

## Parameters
- `--dry-run`: 只检查不执行修改。
- `--skip-audit`: 跳过代码审计阶段（不推荐）。
