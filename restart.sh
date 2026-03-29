#!/bin/bash

# AetherBlog 快速重启脚本
# 只重启应用容器，不动中间件（PostgreSQL / Redis）
#
# 用法:
#   ./restart.sh              # 重启所有应用容器
#   ./restart.sh backend      # 只重启后端
#   ./restart.sh blog admin   # 重启指定容器
#   ./restart.sh --pull       # 拉取最新镜像后重启

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"

APP_SERVICES=(backend ai-service blog admin gateway)

PULL=false
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=true ;;
    *) TARGETS+=("$arg") ;;
  esac
done

if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("${APP_SERVICES[@]}")
fi

dc() {
  if docker compose version &>/dev/null; then
    docker compose -f "$COMPOSE_FILE" "$@"
  else
    docker-compose -f "$COMPOSE_FILE" "$@"
  fi
}

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         ⚡ AetherBlog 快速重启                    ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}[1/3] 检查中间件状态...${NC}"
PG_STATUS=$(docker inspect -f '{{.State.Status}}' aetherblog-postgres 2>/dev/null || echo "not_found")
if [ "$PG_STATUS" != "running" ]; then
  echo -e "${YELLOW}⚠️  PostgreSQL 未运行，先启动中间件...${NC}"
  dc up -d postgres
  until docker exec aetherblog-postgres pg_isready -U aetherblog -d aetherblog &>/dev/null; do
    sleep 1
  done
  echo -e "${GREEN}✅ PostgreSQL 就绪${NC}"
else
  echo -e "${GREEN}✅ PostgreSQL 运行中，跳过${NC}"
fi
echo ""

if [ "$PULL" = true ]; then
  echo -e "${BLUE}[2/3] 拉取最新镜像...${NC}"
  dc pull "${TARGETS[@]}"
  echo ""
else
  echo -e "${BLUE}[2/3] 跳过镜像拉取（使用 --pull 启用）${NC}"
  echo ""
fi

echo -e "${BLUE}[3/3] 重启应用容器: ${TARGETS[*]}${NC}"
START_TIME=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')

RESTARTED=()
RECREATED=()
for svc in "${TARGETS[@]}"; do
  CONTAINER="aetherblog-${svc}"
  if [ "$svc" = "ai-service" ]; then
    CONTAINER="aetherblog-ai-service"
  fi

  STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not_found")
  if [ "$STATUS" = "running" ] && [ "$PULL" = false ]; then
    docker restart "$CONTAINER" >/dev/null 2>&1
    RESTARTED+=("$svc")
  else
    RECREATED+=("$svc")
  fi
done

if [ ${#RECREATED[@]} -gt 0 ]; then
  dc up -d --no-deps "${RECREATED[@]}"
fi

END_TIME=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
ELAPSED=$(( (END_TIME - START_TIME) ))

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
if [ ${#RESTARTED[@]} -gt 0 ]; then
  echo -e "${GREEN}⚡ 快速重启: ${RESTARTED[*]}${NC}"
fi
if [ ${#RECREATED[@]} -gt 0 ]; then
  echo -e "${GREEN}🔄 重新创建: ${RECREATED[*]}${NC}"
fi
echo -e "${GREEN}✅ 完成！耗时: ${ELAPSED}ms${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
