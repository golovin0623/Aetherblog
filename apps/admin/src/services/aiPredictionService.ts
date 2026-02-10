/**
 * AI 实时预测服务
 *
 * 功能：
 * 1. 基于上下文预测下一步内容
 * 2. 支持流式响应
 * 3. 智能缓存减少API调用
 * 4. 防抖处理避免频繁请求
 */

export interface AiPredictionContext {
  currentText: string;      // 当前光标前的文本
  cursorPosition: number;   // 光标位置
  selectedText?: string;    // 选中文本
  documentTitle?: string;   // 文档标题
  writingStage?: string;    // 当前写作阶段
}

export interface AiPredictionResult {
  suggestion: string;        // 建议的文本
  confidence: number;        // 置信度 (0-1)
  reasoning?: string;        // 推理过程 (调试用)
  alternatives?: string[];   // 替代建议
}

export interface AiPredictionOptions {
  maxLength?: number;        // 最大生成长度
  temperature?: number;      // 生成温度 (0-1)
  stopSequences?: string[];  // 停止序列
  stream?: boolean;          // 是否流式生成
}

class AiPredictionService {
  private cache = new Map<string, AiPredictionResult>();
  private pendingRequests = new Map<string, Promise<AiPredictionResult>>();
  private abortControllers = new Map<string, AbortController>();

  /**
   * 预测下一步内容
   */
  async predict(
    context: AiPredictionContext,
    options: AiPredictionOptions = {}
  ): Promise<AiPredictionResult> {
    const cacheKey = this.getCacheKey(context, options);

    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 检查是否有正在进行的相同请求
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    // 创建新的预测请求
    const promise = this.executePrediction(context, options, cacheKey);
    this.pendingRequests.set(cacheKey, promise);

    try {
      const result = await promise;
      this.cache.set(cacheKey, result);
      return result;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * 执行预测（实际API调用）
   */
  private async executePrediction(
    context: AiPredictionContext,
    options: AiPredictionOptions,
    cacheKey: string
  ): Promise<AiPredictionResult> {
    const controller = new AbortController();
    this.abortControllers.set(cacheKey, controller);

    try {
      // 构造提示词
      const prompt = this.buildPrompt(context);

      // TODO: 调用真实的 AI API
      // 这里使用 aiService 或直接调用后端 AI 接口
      // const response = await fetch('/api/v1/ai/predict', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ prompt, ...options }),
      //   signal: controller.signal,
      // });

      // 模拟 AI 响应
      await new Promise(resolve => setTimeout(resolve, 300));

      // 模拟生成建议
      const suggestion = this.generateMockSuggestion(context);

      return {
        suggestion,
        confidence: 0.85,
        alternatives: [
          suggestion + ' 另一种表述',
          suggestion + ' 更详细的版本',
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Prediction cancelled');
      }
      console.error('Prediction failed:', error);
      throw error;
    } finally {
      this.abortControllers.delete(cacheKey);
    }
  }

  /**
   * 取消预测
   */
  cancelPrediction(context: AiPredictionContext, options: AiPredictionOptions = {}): void {
    const cacheKey = this.getCacheKey(context, options);
    const controller = this.abortControllers.get(cacheKey);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(cacheKey);
    }
    this.pendingRequests.delete(cacheKey);
  }

  /**
   * 流式预测（支持实时生成）
   */
  async *predictStream(
    context: AiPredictionContext,
    options: AiPredictionOptions = {}
  ): AsyncGenerator<{ chunk: string; done: boolean }> {
    // TODO: 实现流式 SSE 或 WebSocket 连接
    // 模拟流式生成
    const fullSuggestion = this.generateMockSuggestion(context);
    const words = fullSuggestion.split(' ');

    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      yield {
        chunk: words[i] + (i < words.length - 1 ? ' ' : ''),
        done: i === words.length - 1,
      };
    }
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 构造缓存键
   */
  private getCacheKey(context: AiPredictionContext, options: AiPredictionOptions): string {
    return JSON.stringify({
      text: context.currentText.slice(-200), // 只使用最后200字符
      stage: context.writingStage,
      opts: options,
    });
  }

  /**
   * 构造提示词
   */
  private buildPrompt(context: AiPredictionContext): string {
    const { currentText, documentTitle, writingStage } = context;

    let prompt = '你是一位专业的写作助手。请根据以下上下文，预测用户接下来可能要写的内容。\n\n';

    if (documentTitle) {
      prompt += `文章标题：${documentTitle}\n`;
    }

    if (writingStage) {
      prompt += `当前阶段：${writingStage}\n`;
    }

    prompt += `\n当前内容：\n${currentText.slice(-500)}\n\n`;
    prompt += '请生成接下来的1-2句话，保持风格和逻辑的连贯性：';

    return prompt;
  }

  /**
   * 生成模拟建议（用于测试）
   */
  private generateMockSuggestion(context: AiPredictionContext): string {
    const lastSentence = context.currentText.split(/[。！？.!?]/).pop() || '';

    // 根据最后一句话的内容生成相关建议
    if (lastSentence.includes('首先') || lastSentence.includes('第一')) {
      return '其次，我们需要考虑...';
    }

    if (lastSentence.includes('问题') || lastSentence.includes('挑战')) {
      return '为了解决这个问题，我们可以采取以下措施...';
    }

    if (lastSentence.includes('重要') || lastSentence.includes('关键')) {
      return '这一点在实践中尤为明显...';
    }

    return '同时，值得注意的是...';
  }
}

// 单例导出
export const aiPredictionService = new AiPredictionService();
