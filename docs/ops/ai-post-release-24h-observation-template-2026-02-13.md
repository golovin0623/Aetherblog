# AI 发布后 24h 观测与复盘模板（2026-02-13）

## 1. 指标与阈值
- `error_rate`（错误率）：阈值 `<= 0.05`
- `empty_data_ratio`（空数据占比）：阈值 `<= 0.20`
- `usage_log_failure_ratio`（埋点失败占比）：阈值 `<= 0.02`

> 数据采集脚本：`ops/release/post_release_observer.sh`

## 2. 执行方式
```bash
# 每小时执行一次（可接入 crontab）
bash ops/release/post_release_observer.sh

# 本地演示（无需真实接口）
bash ops/release/post_release_observer.sh --sample
```

输出文件：`ops/release/reports/<date>-ai-observability-hourly.csv`

## 3. 24h 巡检记录（模板）
| 时间 | error_rate | empty_data_ratio | usage_log_failure_ratio | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| H+01 | - | - | - | - | - |
| H+02 | - | - | - | - | - |
| H+03 | - | - | - | - | - |
| ... | ... | ... | ... | ... | ... |
| H+24 | - | - | - | - | - |

## 4. 前后对比（发布前 vs 发布后）
- 发布前基线：`docs/qa/ai-analytics-observability-baseline-2026-02-13.md`
- 发布后 24h 结论：
  - 错误率趋势：
  - 空数据占比趋势：
  - 埋点成功率趋势：

## 5. 治理待办（可追踪）
- [ ] TODO-1：
- [ ] TODO-2：
- [ ] TODO-3：
