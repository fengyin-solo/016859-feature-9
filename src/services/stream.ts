import type { MessageStats } from '../types';

/**
 * 响应统计信息
 */
export interface ResponseStats {
  /** 响应时间（毫秒） */
  responseTime: number;
  /** 估算的 Token 数量 */
  tokenCount: number;
  /** 首字节时间（毫秒） */
  firstByteTime?: number;
}

/**
 * 流处理器回调
 */
export interface StreamCallbacks {
  /** 收到内容片段时调用 */
  onChunk: (chunk: string) => void;
  /** 流完成时调用 */
  onComplete: (stats: ResponseStats) => void;
  /** 发生错误时调用；返回 true 时视为调用方已处理完成 */
  onError: (error: Error) => boolean | void;
  /** 主动中止时调用 */
  onAbort?: () => void;
}

/**
 * 流处理器类
 * 管理流式响应的生命周期
 */
export class StreamHandler {
  private abortController: AbortController | null = null;
  private isActive = false;
  private startTime = 0;
  private firstByteTime: number | null = null;
  private accumulatedContent = '';

  /**
   * 开始处理流
   * @param stream 异步迭代器
   * @param callbacks 回调函数
   */
  async start(
    stream: AsyncGenerator<string, void, unknown>,
    callbacks: StreamCallbacks
  ): Promise<boolean> {
    if (this.isActive) {
      this.abort();
    }

    this.abortController = new AbortController();
    this.isActive = true;
    this.startTime = Date.now();
    this.firstByteTime = null;
    this.accumulatedContent = '';

    let succeeded = false;

    try {
      for await (const chunk of stream) {
        // 检查是否已中止
        if (this.abortController?.signal.aborted) {
          break;
        }

        // 记录首字节时间
        if (this.firstByteTime === null) {
          this.firstByteTime = Date.now() - this.startTime;
        }

        this.accumulatedContent += chunk;
        callbacks.onChunk(chunk);
      }

      // 流正常完成
      if (!this.abortController?.signal.aborted) {
        const stats = this.calculateStats();
        callbacks.onComplete(stats);
      } else {
        callbacks.onAbort?.();
      }
      succeeded = true;
      return succeeded;
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        callbacks.onAbort?.();
        succeeded = true;
      } else {
        const handled = callbacks.onError(error instanceof Error ? error : new Error(String(error)));
        succeeded = handled === true;
      }
      return succeeded;
    } finally {
      this.isActive = false;
      this.abortController = null;
    }
  }

  /**
   * 中止当前流
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * 检查流是否正在处理
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * 获取已累积的内容
   */
  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }

  /**
   * 计算响应统计信息
   */
  private calculateStats(): ResponseStats {
    const responseTime = Date.now() - this.startTime;
    const tokenCount = this.estimateTokens(this.accumulatedContent);

    return {
      responseTime,
      tokenCount,
      firstByteTime: this.firstByteTime ?? undefined,
    };
  }

  /**
   * 估算 Token 数量
   * 简化的估算方法
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;

    // 中文字符约 2 token
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    // 英文单词约 1 token
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    // 数字
    const numbers = (text.match(/\d+/g) || []).length;
    // 标点符号
    const punctuation = (text.match(/[^\w\s\u4e00-\u9fff]/g) || []).length;

    return chineseChars * 2 + englishWords + numbers + punctuation;
  }
}

/**
 * 创建流处理器实例
 */
export function createStreamHandler(): StreamHandler {
  return new StreamHandler();
}

/**
 * 将 ResponseStats 转换为 MessageStats
 */
export function toMessageStats(stats: ResponseStats): MessageStats {
  return {
    responseTime: stats.responseTime,
    tokenCount: stats.tokenCount,
  };
}
