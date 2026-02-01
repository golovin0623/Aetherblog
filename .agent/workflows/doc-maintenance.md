---
description: 执行不计成本的深度代码审查与全方位文档维护 (Strict Doc Maintenance)
---

此工作流用于在任务交付前，执行**最严苛的质量控制与文档同步**。必须严格遵循以下阶段，确保"代码-文档-设计"的绝对一致性。

# 阶段一：零容忍代码审计 (Zero-Tolerance Code Audit)

// turbo
1. **类型安全检查** (必须 0 错误)
   ```bash
   npx tsc --noEmit
   ```
2. **代码规范检查** (自动修复)
   ```bash
   npx eslint --fix "src/**/*.{ts,tsx}"
   ```
3. **依赖规范检查**
   - 检查 `package.json`：确保所有使用的第三方库都已显式声明。
   - 检查导入路径：禁止使用 `../../../` 这种深层相对路径，必须使用别名 `@/` 或包名 `@aetherblog/*`。

# 阶段二：设计保真度验收 (Design Fidelity Check)

1. **视觉还原度**:
   - 确认是否符合 "认知优雅" (Cognitive Elegance) 理念。
   - 检查是否使用了 Tailwind 预设变量 (如 `bg-[var(--bg-primary)]`) 而非硬编码颜色。
2. **图标合规性**:
   - **AI 相关**: 必须使用 `@lobehub/icons`。
   - **通用图标**: 必须使用 `lucide-react`。
   - ❌ **严禁**: 使用 Emoji 或未授权的 SVG。
3. **交互一致性**:
   - 检查模态框、侧边栏是否使用了 `AnimatePresence` + `motion` 进出场动画。

# 阶段三：全栈文档维护 (Full-Stack Doc Maintenance)

> **核心原则**: 文档是唯一的真理来源。代码变更必须反向同步到文档。

## 3.1 详细设计文档 (`系统需求企划书及详细设计.md` & `code-design.md`)
1. **生成变更日志**: 在底部 `CHANGELOG` 添加新版本 (Added/Changed/Fixed)。
2. **设计偏差修正**:
   - 如果实现方案优于原设计：必须生成 **文档更新补丁 (PATCH)**。
   - 格式参考 `Step 5`：
     ```markdown
     📝 文档更新补丁 PATCH-[日期]
     【目标章节】§X.X
     【原内容】...
     【新内容】...
     【变更原因】...
     ```

## 3.2 架构映射文档 (`code-structure.md`)
1. **目录一致性**:
   - 检查实际文件树 `tree src/`。
   - 如果新增了目录 (如 `ai-config/`)，必须更新文档中的 ASCII 树。

## 3.3 路线图文档 (`code-tree.md` & `code-map.md`)
1. **任务对齐**:
   - 确认当前开发的任务 ID 是否存在。
   - 如果是新增需求，必须在对应 Phase 插入新任务行。

## 3.4 规则文档 (`ui_rules.md`)
1. **模式固化**:
   - 如果发明了新的 UI 模式 (如 "三栏布局")，将其提炼写入规则文档。

# 阶段四：交付物终审 (Artifact Finalization)

1. **Task Checklist (`task.md`)**:
   - 必须全选 `[x]`。不允许有 `[/]` 或 `[ ]` 交付。
2. **Walkthrough (`walkthrough.md`)**:
   - 必须包含截图 (或详细描述)。
   - 必须包含最终的构建日志/测试结果。
3. **自我反思**:
   - ❓ "我是否修改了不该修改的文件？" (如其他模块的核心逻辑)
   - ❓ "我的总结是否使用了精准的术语？" (如 "Monorepo", "Zustand Store")

# 阶段五：提交前通知
只在所有检查通过后，通知用户：
"已执行深度文档维护，设计文档、架构文档、路线图均已同步。代码通过严苛审计。"
