/**
 * 错误类型枚举
 */
export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_REQUEST = 'INVALID_REQUEST',
  STREAM_ERROR = 'STREAM_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * 应用错误接口
 */
export interface AppError {
  /** 错误类型 */
  type: ErrorType;
  /** 用户友好的错误消息 */
  message: string;
  /** 详细信息 */
  details?: unknown;
  /** 是否可重试 */
  retryable: boolean;
  /** 建议等待时间（毫秒） */
  retryAfter?: number;
}

/**
 * 错误消息映射
 */
const ERROR_MESSAGES: Record<ErrorType, string> = {
  [ErrorType.NETWORK_ERROR]: '网络连接失败，请检查网络后重试',
  [ErrorType.AUTH_ERROR]: 'API 密钥无效，请检查配置',
  [ErrorType.RATE_LIMIT]: '请求过于频繁，请稍后再试',
  [ErrorType.INVALID_REQUEST]: '请求参数无效，请检查输入',
  [ErrorType.STREAM_ERROR]: '响应中断，已保留部分内容',
  [ErrorType.STORAGE_ERROR]: '存储失败，数据可能丢失',
  [ErrorType.UNKNOWN]: '发生未知错误，请稍后重试',
};

/**
 * 从错误对象中提取 API 返回的错误消息
 * 支持多种格式：
 * - {message: "..."} 
 * - {error: {message: "..."}}
 * - {error: "..."}
 * - {code: xxx, message: "..."}
 */
function extractAPIMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const err = error as Record<string, unknown>;

  // 直接的 message 字段
  if (typeof err.message === 'string' && err.message) {
    return err.message;
  }

  // error.message 格式
  if (err.error && typeof err.error === 'object') {
    const innerError = err.error as Record<string, unknown>;
    if (typeof innerError.message === 'string' && innerError.message) {
      return innerError.message;
    }
  }

  // error 是字符串
  if (typeof err.error === 'string' && err.error) {
    return err.error;
  }

  // 尝试从 body 中提取（OpenAI SDK 可能将响应放在 body 中）
  if (err.body && typeof err.body === 'object') {
    const body = err.body as Record<string, unknown>;
    if (typeof body.message === 'string' && body.message) {
      return body.message;
    }
    if (body.error && typeof body.error === 'object') {
      const bodyError = body.error as Record<string, unknown>;
      if (typeof bodyError.message === 'string' && bodyError.message) {
        return bodyError.message;
      }
    }
  }

  return null;
}

/**
 * 解析错误并返回 AppError
 * @param error 原始错误
 * @returns AppError 对象
 */
export function parseError(error: unknown): AppError {
  // 先尝试提取 API 返回的原始错误消息
  const apiMessage = extractAPIMessage(error);

  // 处理 OpenAI SDK 错误
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    const fallbackMessage = (error as { message?: string }).message || '';
    // 优先使用 API 返回的消息
    const displayMessage = apiMessage || fallbackMessage;

    switch (status) {
      case 401:
        return {
          type: ErrorType.AUTH_ERROR,
          message: displayMessage || ERROR_MESSAGES[ErrorType.AUTH_ERROR],
          details: error,
          retryable: false,
        };

      case 429:
        // 尝试从响应头获取重试时间
        const retryAfter = parseRetryAfter(error);
        return {
          type: ErrorType.RATE_LIMIT,
          message: displayMessage || (retryAfter
            ? `请求过于频繁，请 ${Math.ceil(retryAfter / 1000)} 秒后重试`
            : ERROR_MESSAGES[ErrorType.RATE_LIMIT]),
          details: error,
          retryable: true,
          retryAfter,
        };

      case 400:
        return {
          type: ErrorType.INVALID_REQUEST,
          message: displayMessage || ERROR_MESSAGES[ErrorType.INVALID_REQUEST],
          details: error,
          retryable: false,
        };

      case 500:
      case 502:
      case 503:
        return {
          type: ErrorType.NETWORK_ERROR,
          message: displayMessage || '服务暂时不可用，请稍后重试',
          details: error,
          retryable: true,
        };

      default:
        return {
          type: ErrorType.UNKNOWN,
          message: displayMessage || ERROR_MESSAGES[ErrorType.UNKNOWN],
          details: error,
          retryable: true,
        };
    }
  }

  // 处理网络错误：原生 fetch 失败或 OpenAI SDK 包装的 APIConnectionError
  if (isNetworkLikeError(error)) {
    return {
      type: ErrorType.NETWORK_ERROR,
      message: ERROR_MESSAGES[ErrorType.NETWORK_ERROR],
      details: error,
      retryable: true,
    };
  }

  // 处理中止错误
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      type: ErrorType.STREAM_ERROR,
      message: '请求已取消',
      details: error,
      retryable: false,
    };
  }

  // 处理存储错误
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return {
      type: ErrorType.STORAGE_ERROR,
      message: ERROR_MESSAGES[ErrorType.STORAGE_ERROR],
      details: error,
      retryable: false,
    };
  }

  // 处理普通 Error，优先使用提取的 API 消息
  if (error instanceof Error) {
    return {
      type: ErrorType.UNKNOWN,
      message: apiMessage || error.message || ERROR_MESSAGES[ErrorType.UNKNOWN],
      details: error,
      retryable: true,
    };
  }

  // 未知错误，尝试使用提取的 API 消息
  return {
    type: ErrorType.UNKNOWN,
    message: apiMessage || ERROR_MESSAGES[ErrorType.UNKNOWN],
    details: error,
    retryable: true,
  };
}

/**
 * 判断错误是否为「网络连不上」类错误（而非服务端返回的业务错误）
 * 覆盖原生 fetch TypeError、OpenAI SDK 的 APIConnectionError 等
 */
function isNetworkLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as { name?: string; message?: string; status?: number };

  // OpenAI SDK 连接错误带 name/constructor 名 APIConnectionError，且没有 HTTP 状态码
  const typeName =
    typeof (error as { constructor?: { name?: string } }).constructor?.name === 'string'
      ? (error as { constructor: { name: string } }).constructor.name
      : '';
  if (typeName === 'APIConnectionError') {
    return true;
  }
  if (typeof err.name === 'string' && err.name === 'APIConnectionError') {
    return true;
  }

  // 原生 fetch 在网络层失败时抛出 TypeError（Failed to fetch / NetworkError ...）
  if (error instanceof TypeError && typeof err.message === 'string') {
    return /fetch|network|networkerror|failed to fetch|load failed/i.test(err.message);
  }

  return false;
}

/**
 * 解析重试时间
 */
function parseRetryAfter(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const headers = (error as { headers?: Record<string, string> }).headers;
    if (headers && headers['retry-after']) {
      const seconds = parseInt(headers['retry-after'], 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }
  return undefined;
}

/**
 * 获取错误类型的用户友好名称
 */
export function getErrorTypeName(type: ErrorType): string {
  const names: Record<ErrorType, string> = {
    [ErrorType.NETWORK_ERROR]: '网络错误',
    [ErrorType.AUTH_ERROR]: '认证错误',
    [ErrorType.RATE_LIMIT]: '请求限流',
    [ErrorType.INVALID_REQUEST]: '请求无效',
    [ErrorType.STREAM_ERROR]: '流式错误',
    [ErrorType.STORAGE_ERROR]: '存储错误',
    [ErrorType.UNKNOWN]: '未知错误',
  };
  return names[type];
}

/**
 * 判断错误是否应该显示配置面板
 */
export function shouldShowConfigPanel(error: AppError): boolean {
  return error.type === ErrorType.AUTH_ERROR;
}

/**
 * 判断错误是否应该显示重试按钮
 */
export function shouldShowRetryButton(error: AppError): boolean {
  return error.retryable;
}

/**
 * 创建错误日志
 */
export function logError(error: AppError, context?: string): void {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` [${context}]` : '';
  
  console.error(
    `[${timestamp}]${contextStr} ${getErrorTypeName(error.type)}: ${error.message}`,
    error.details
  );
}
