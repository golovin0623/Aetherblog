# 代码注释汉化执行计划

## 任务目标
将项目所有代码文件（保留文件除外）中的英文注释翻译为精准的中文注释。

## 范围
1. **根目录**: 脚本 (`.sh`) 和 配置 (`.yml`)
2. **Shared Packages**: `packages/` 下的 `.ts`, `.tsx`
3. **后端**: `apps/server` 下的 `.java`, `pom.xml`, `.yml`
4. **前端**: `apps/admin`, `apps/blog` 下的 `.ts`, `.tsx`, 及其配置

## 执行步骤

### Phase 1: 基础设施 (Root & Packages)
- [ ] 翻译根目录脚本: `docker-build.sh`, `start.sh`, `stop.sh`
- [ ] 翻译根目录配置: `docker-compose.yml`, `docker-compose.prod.yml`
- [ ] 翻译 `packages/types`
- [ ] 翻译 `packages/utils`
- [ ] 翻译 `packages/hooks`
- [ ] 翻译 `packages/ui`
- [ ] 翻译 `packages/editor`
- [ ] 验证: 检查文件内容及编译 `pnpm build`

### Phase 2: 后端 (Server)
- [ ] 翻译 `apps/server/pom.xml`, `Dockerfile`
- [ ] 翻译 `apps/server/aetherblog-common`
- [ ] 翻译 `apps/server/aetherblog-api`
- [ ] 翻译 `apps/server/aetherblog-service`
- [ ] 翻译 `apps/server/aetherblog-ai`
- [ ] 翻译 `apps/server/aetherblog-app`
- [ ] 验证: `mvn clean compile`

### Phase 3: 前端 (Admin & Blog)
- [ ] 翻译 `apps/admin` (源码及配置)
- [ ] 验证: `pnpm build:admin`
- [ ] 翻译 `apps/blog` (源码及配置)
- [ ] 验证: `pnpm build:blog`

## 注意事项
1. **版权/License 声明**: 保持原文。
2. **专有名词**: 保留英文 (如 Spring Bean, React Hook, JWT 等)。
3. **注释风格**: 保持原样 (行内 `//` 或 块状 `/* ... */`)。
4. **准确性**: 译文需精准描述代码意图。
