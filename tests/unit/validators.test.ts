import { describe, it, expect } from 'vitest'
import {
  MAX_MESSAGE_LENGTH,
  getMessageLength,
  validateMessageContent,
  validateMessageForSend,
} from '../../src/utils/validators'

describe('validateMessageContent（既有行为保持）', () => {
  it('空字符串与非字符串视为无效', () => {
    expect(validateMessageContent('')).toBe(false)
    // @ts-expect-error 故意传入非法类型
    expect(validateMessageContent(null)).toBe(false)
    // @ts-expect-error 故意传入非法类型
    expect(validateMessageContent(undefined)).toBe(false)
  })

  it('纯空格 / 制表符 / 换行视为无效（发送入口不应亮起）', () => {
    expect(validateMessageContent('   ')).toBe(false)
    expect(validateMessageContent('\t\t')).toBe(false)
    expect(validateMessageContent('\n  \n')).toBe(false)
  })

  it('含非空白字符视为有效', () => {
    expect(validateMessageContent('a')).toBe(true)
    expect(validateMessageContent('  你好 ')).toBe(true)
  })
})

describe('getMessageLength', () => {
  it('按去除两端空白后的字符数计算', () => {
    expect(getMessageLength('  abc  ')).toBe(3)
    expect(getMessageLength('   ')).toBe(0)
    expect(getMessageLength('你好')).toBe(2)
  })
})

describe('validateMessageForSend', () => {
  it('正常内容返回 ok', () => {
    const result = validateMessageForSend('hello')
    expect(result.reason).toBe('ok')
    expect(result.overflow).toBe(0)
  })

  it('纯空格判定为 empty，与超长措辞场景区分', () => {
    const result = validateMessageForSend('    \n  ')
    expect(result.reason).toBe('empty')
    expect(result.trimmedLength).toBe(0)
  })

  it('恰好等于上限允许发送', () => {
    const content = 'a'.repeat(MAX_MESSAGE_LENGTH)
    expect(validateMessageForSend(content).reason).toBe('ok')
  })

  it('超过上限时给出超出的字符数', () => {
    const content = '字'.repeat(MAX_MESSAGE_LENGTH + 7)
    const result = validateMessageForSend(content)
    expect(result.reason).toBe('tooLong')
    expect(result.overflow).toBe(7)
  })

  it('两端空白不占用长度：中间超长才算超长', () => {
    const body = 'b'.repeat(MAX_MESSAGE_LENGTH + 1)
    const result = validateMessageForSend(`   ${body}   `)
    expect(result.reason).toBe('tooLong')
    expect(result.overflow).toBe(1)
  })

  it('支持自定义上限', () => {
    expect(validateMessageForSend('abcdef', 5).overflow).toBe(1)
    expect(validateMessageForSend('abcde', 5).reason).toBe('ok')
  })
})
