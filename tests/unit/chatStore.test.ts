import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../../src/stores/chatStore'

describe('chatStore.removeMessages（发送失败回滚）', () => {
  beforeEach(() => {
    localStorage.clear()
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      initialized: true,
    })
  })

  it('移除指定的用户消息与助手占位消息', () => {
    const convId = useChatStore.getState().createConversation()
    const userId = useChatStore.getState().addMessage(convId, {
      role: 'user',
      content: '没发出去的一条',
      status: 'complete',
    })
    const assistantId = useChatStore.getState().startStreaming(convId)

    expect(useChatStore.getState().isStreaming).toBe(true)
    expect(useChatStore.getState().getActiveConversation()?.messages).toHaveLength(2)

    useChatStore.getState().removeMessages(convId, [userId, assistantId])

    const conv = useChatStore.getState().getActiveConversation()
    expect(conv?.messages).toHaveLength(0)
    // 流式状态一并复位，输入框可以重新发送
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useChatStore.getState().streamingMessageId).toBeNull()
  })

  it('只移除无关消息时不影响正在进行的流式状态', () => {
    const convId = useChatStore.getState().createConversation()
    useChatStore.getState().startStreaming(convId)
    expect(useChatStore.getState().isStreaming).toBe(true)

    useChatStore.getState().removeMessages(convId, ['nonexistent-id'])

    expect(useChatStore.getState().isStreaming).toBe(true)
  })
})
