# 代码注释汉化执行计划 (Code Comment Translation Execution Plan)

## 1. 任务目标 (Objective)
将项目所有代码文件（保留文件除外）中的英文注释翻译为精准的中文注释。

## 2. 范围 (Scope)
*   **Root**: 脚本 (`.sh`) 和 配置 (`.yml`)
*   **Shared Packages**: `packages/` 下的 `.ts`, `.tsx`
*   **Backend**: `apps/server` 下的 `.java`, `pom.xml`, `.yml`
*   **Frontend**: `apps/admin`, `apps/blog` 下的 `.ts`, `.tsx`, 及其配置

## 3. 约束 (Constraints)
*   **版权/License**: 保持原文。
*   **专有名词**: 保留英文 (如 Spring Bean, React Hook, JWT 等)。
*   **注释风格**: 保持原样 (行内 `//` 或 块状 `/* ... */`)。
*   **准确性**: 译文需精准描述代码意图。

## 4. 执行步骤 (Execution Steps)

### Phase 1: 基础设施 (Root & Packages)
1.  **Sync Main**: 同步 main 分支代码 (使用 `theirs` 策略解决冲突)。
2.  **Root Files**: 检查并翻译 `docker-build.sh`, `start.sh`, `stop.sh`, `docker-compose.yml`, `docker-compose.prod.yml`。
3.  **Packages**:
    *   `packages/types`
    *   `packages/utils`
    *   `packages/hooks`
    *   `packages/ui`
    *   `packages/editor`
4.  **Verify**: `pnpm build`

### Phase 2: 后端 (Server)
1.  **Config**: `apps/server/pom.xml`, `Dockerfile`
2.  **Modules**:
    *   `apps/server/aetherblog-common`
    *   `apps/server/aetherblog-api`
    *   `apps/server/aetherblog-service`
    *   `apps/server/aetherblog-ai`
    *   `apps/server/aetherblog-app`
3.  **Verify**: `mvn clean compile` (Expect failure due to JDK 21 env vs JDK 25 requirement).

### Phase 3: 前端 (Admin & Blog)
1.  **Admin (`apps/admin`)**:
    *   Config: `vite.config.ts`, `tailwind.config.ts`
    *   Source: `src/` (stores, hooks, components, etc.)
    *   **Verify**: `pnpm build:admin`
2.  **Blog (`apps/blog`)**:
    *   Config: `next.config.ts`, `tailwind.config.ts`
    *   Source: `app/` (components, posts, etc.)
    *   **Verify**: `pnpm build:blog`

## 5. 提交 (Submission)
*   执行 Pre-commit 检查。
*   提交代码并创建 Merge Request，标题格式: `<BranchName>-<YYYYMMDDHHmm>`
