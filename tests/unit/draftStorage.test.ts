import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveMessageDraft,
  loadMessageDraft,
  loadMessageDrafts,
  clearMessageDraft,
  NO_CONVERSATION_DRAFT_KEY,
} from '../../src/services/storage'

describe('消息草稿持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('保存后按对话读取，重新打开（重新加载）仍在', () => {
    saveMessageDraft('conv-1', '没发完的内容')
    expect(loadMessageDraft('conv-1')).toBe('没发完的内容')
  })

  it('不同对话的草稿互不覆盖', () => {
    saveMessageDraft('conv-1', 'A 的草稿')
    saveMessageDraft('conv-2', 'B 的草稿')
    const drafts = loadMessageDrafts()
    expect(drafts['conv-1']).toBe('A 的草稿')
    expect(drafts['conv-2']).toBe('B 的草稿')
  })

  it('空字符串草稿会被删除而不是保留空键', () => {
    saveMessageDraft('conv-1', '内容')
    saveMessageDraft('conv-1', '')
    expect(loadMessageDraft('conv-1')).toBe('')
    expect(loadMessageDrafts()).not.toHaveProperty('conv-1')
  })

  it('clearMessageDraft 清除指定草稿', () => {
    saveMessageDraft('conv-1', '内容')
    clearMessageDraft('conv-1')
    expect(loadMessageDraft('conv-1')).toBe('')
  })

  it('没有对话时使用独立草稿键，发送后可恢复', () => {
    saveMessageDraft(NO_CONVERSATION_DRAFT_KEY, '尚未进入对话的输入')
    expect(loadMessageDraft(NO_CONVERSATION_DRAFT_KEY)).toBe('尚未进入对话的输入')
  })

  it('损坏的存储数据不会抛错，返回空草稿', () => {
    localStorage.setItem('react-chat-message-drafts', 'not-json')
    expect(loadMessageDrafts()).toEqual({})
  })
})
