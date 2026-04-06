function formatRate(value: number): string {
  return `${value.toFixed(1)}%`;
}

function calculateRate(count: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return (count / total) * 100;
}

export function getAiResponseRateSummary(totalCalls: number, successCalls: number, errorCalls: number) {
  const successRate = calculateRate(successCalls, totalCalls);
  const errorRate = calculateRate(errorCalls, totalCalls);

  return {
    successRateValue: formatRate(successRate),
    countLine: `成功 ${successCalls} 次 · 失败 ${errorCalls} 次`,
    rateLine: `成功占比 ${formatRate(successRate)} · 失败占比 ${formatRate(errorRate)}`,
  };
}
