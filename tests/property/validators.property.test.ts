import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  MAX_MESSAGE_LENGTH,
  getMessageLength,
  validateMessageForSend,
} from '../../src/utils/validators'

describe('发送校验的不变量（property-based）', () => {
  it('空内容（去空白后长度为 0）永远判定为 empty', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = validateMessageForSend(s)
        if (getMessageLength(s) === 0) {
          expect(result.reason).toBe('empty')
        }
      })
    )
  })

  it('非空内容要么 ok 要么 tooLong，绝不出现 empty', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (s) => {
        if (s.trim().length > 0) {
          const result = validateMessageForSend(s)
          expect(['ok', 'tooLong']).toContain(result.reason)
        }
      })
    )
  })

  it('overflow 恒等于 max(0, 去空白长度 - 上限)', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 5000 }), (s, maxLength) => {
        const result = validateMessageForSend(s, maxLength)
        expect(result.overflow).toBe(Math.max(0, s.trim().length - maxLength))
      })
    )
  })

  it('超过上限时 overflow 为正且 reason 为 tooLong', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: MAX_MESSAGE_LENGTH + 1, maxLength: MAX_MESSAGE_LENGTH + 500 }),
        (s) => {
          if (s.trim().length > MAX_MESSAGE_LENGTH) {
            const result = validateMessageForSend(s)
            expect(result.reason).toBe('tooLong')
            expect(result.overflow).toBeGreaterThan(0)
          }
        }
      )
    )
  })
})
