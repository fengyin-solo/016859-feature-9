import { describe, it, expect } from 'vitest'
import { parseError, ErrorType } from '../../src/services/errorHandler'

describe('parseError 网络异常识别', () => {
  it('原生 fetch 失败的 TypeError 识别为可重试的网络错误', () => {
    const error = new TypeError('Failed to fetch')
    const appError = parseError(error)
    expect(appError.type).toBe(ErrorType.NETWORK_ERROR)
    expect(appError.retryable).toBe(true)
  })

  it('OpenAI SDK 的 APIConnectionError 识别为网络错误（无 HTTP 状态码）', () => {
    class APIConnectionError extends Error {
      constructor() {
        super('Connection error.')
        this.name = 'APIConnectionError'
      }
    }
    const appError = parseError(new APIConnectionError())
    expect(appError.type).toBe(ErrorType.NETWORK_ERROR)
  })

  it('带 status 503 的错误走服务端分支而不是网络断开分支', () => {
    const appError = parseError({ status: 503, message: 'busy' })
    // 5xx 归类为可重试的 NETWORK_ERROR 分类（服务不可用），但其消息来自服务端
    expect(appError.retryable).toBe(true)
    expect(appError.message).toBe('busy')
  })

  it('401 认证错误不可重试，且需要打开配置面板', () => {
    const appError = parseError({ status: 401, message: 'bad key' })
    expect(appError.type).toBe(ErrorType.AUTH_ERROR)
    expect(appError.retryable).toBe(false)
  })

  it('用户主动中止（AbortError）不识别为网络错误', () => {
    const appError = parseError(new DOMException('Aborted', 'AbortError'))
    expect(appError.type).toBe(ErrorType.STREAM_ERROR)
    expect(appError.type).not.toBe(ErrorType.NETWORK_ERROR)
  })
})
