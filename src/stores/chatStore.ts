import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation, Message, CreateMessageParams } from '../types';
import { saveConversations, loadConversations } from '../services/storage';
import { notifyLocalSaveFailure } from '../services/notify';
import { generateConversationTitle } from '../utils/formatters';

interface ChatState {
  /** 对话列表 */
  conversations: Conversation[];
  /** 当前活动对话 ID */
  activeConversationId: string | null;
  /** 是否正在流式响应 */
  isStreaming: boolean;
  /** 流式响应累积内容 */
  streamingContent: string;
  /** 流式响应消息 ID */
  streamingMessageId: string | null;
  /** 是否已初始化 */
  initialized: boolean;
}

interface ChatActions {
  /** 初始化（从 localStorage 加载） */
  initConversations: () => void;
  /** 创建新对话 */
  createConversation: (title?: string) => string;
  /** 删除对话 */
  deleteConversation: (id: string) => void;
  /** 设置活动对话 */
  setActiveConversation: (id: string | null) => void;
  /** 添加消息到对话 */
  addMessage: (conversationId: string, params: CreateMessageParams) => string;
  /** 更新消息 */
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  /** 开始流式响应 */
  startStreaming: (conversationId: string) => string;
  /** 追加流式内容 */
  appendStreamContent: (content: string) => void;
  /** 完成流式响应 */
  finishStreaming: (stats?: Message['stats']) => void;
  /** 取消流式响应 */
  cancelStreaming: () => void;
  /**
   * 移除指定对话中的若干消息并重置流式状态（发送失败、消息回到草稿时回滚用）
   * @returns 被移除消息是否存在
   */
  removeMessages: (conversationId: string, messageIds: string[]) => void;
  /** 获取当前活动对话 */
  getActiveConversation: () => Conversation | null;
  /** 清除所有对话 */
  clearAllConversations: () => void;
  /** 更新对话标题 */
  updateConversationTitle: (id: string, title: string) => void;
}

type ChatStore = ChatState & ChatActions;

// 持久化保存（防抖）
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * 立即执行一次本地保存；失败时给出独立的「重新保存」入口
 */
function persistConversations(conversations: Conversation[]): void {
  try {
    saveConversations(conversations);
  } catch {
    // 本地保存失败：提示并允许重新来一遍，措辞与网络异常等其它场景不同
    notifyLocalSaveFailure(
      () => persistConversations(useChatStore.getState().conversations),
      '对话记录'
    );
  }
}

const debouncedSave = (conversations: Conversation[]) => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    persistConversations(conversations);
  }, 500);
};

export const useChatStore = create<ChatStore>((set, get) => ({
  // Initial state
  conversations: [],
  activeConversationId: null,
  isStreaming: false,
  streamingContent: '',
  streamingMessageId: null,
  initialized: false,

  // Actions
  initConversations: () => {
    const conversations = loadConversations();
    const activeId = conversations.length > 0 ? conversations[0]?.id ?? null : null;
    
    set({
      conversations,
      activeConversationId: activeId,
      initialized: true,
    });
  },

  createConversation: (title) => {
    const id = uuidv4();
    const now = Date.now();
    
    const newConversation: Conversation = {
      id,
      title: title || '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    
    set(state => {
      const conversations = [newConversation, ...state.conversations];
      debouncedSave(conversations);
      return {
        conversations,
        activeConversationId: id,
      };
    });
    
    return id;
  },

  deleteConversation: (id) => {
    set(state => {
      const conversations = state.conversations.filter(c => c.id !== id);
      debouncedSave(conversations);
      
      // 如果删除的是当前活动对话，切换到第一个对话
      let activeConversationId = state.activeConversationId;
      if (activeConversationId === id) {
        activeConversationId = conversations[0]?.id ?? null;
      }
      
      return {
        conversations,
        activeConversationId,
      };
    });
  },

  setActiveConversation: (id) => {
    set({ activeConversationId: id });
  },

  addMessage: (conversationId, params) => {
    const messageId = uuidv4();
    const now = Date.now();
    
    const newMessage: Message = {
      id: messageId,
      role: params.role,
      content: params.content,
      timestamp: now,
      status: params.status || 'complete',
    };
    
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== conversationId) return conv;
        
        const messages = [...conv.messages, newMessage];
        
        // 如果是第一条用户消息，自动生成标题
        let title = conv.title;
        if (params.role === 'user' && conv.messages.length === 0) {
          title = generateConversationTitle(params.content);
        }
        
        return {
          ...conv,
          messages,
          title,
          updatedAt: now,
        };
      });
      
      // 重新排序（按更新时间降序）
      conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      
      debouncedSave(conversations);
      return { conversations };
    });
    
    return messageId;
  },

  updateMessage: (conversationId, messageId, updates) => {
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== conversationId) return conv;
        
        const messages = conv.messages.map(msg => {
          if (msg.id !== messageId) return msg;
          return { ...msg, ...updates };
        });
        
        return {
          ...conv,
          messages,
          updatedAt: Date.now(),
        };
      });
      
      debouncedSave(conversations);
      return { conversations };
    });
  },

  startStreaming: (conversationId) => {
    const messageId = uuidv4();
    const now = Date.now();
    
    const streamingMessage: Message = {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: now,
      status: 'streaming',
    };
    
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== conversationId) return conv;
        
        return {
          ...conv,
          messages: [...conv.messages, streamingMessage],
          updatedAt: now,
        };
      });
      
      return {
        conversations,
        isStreaming: true,
        streamingContent: '',
        streamingMessageId: messageId,
      };
    });
    
    return messageId;
  },

  appendStreamContent: (content) => {
    set(state => {
      const newContent = state.streamingContent + content;
      
      // 同时更新消息内容
      const conversations = state.conversations.map(conv => {
        if (conv.id !== state.activeConversationId) return conv;
        
        const messages = conv.messages.map(msg => {
          if (msg.id !== state.streamingMessageId) return msg;
          return { ...msg, content: newContent };
        });
        
        return { ...conv, messages };
      });
      
      return {
        streamingContent: newContent,
        conversations,
      };
    });
  },

  finishStreaming: (stats) => {
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== state.activeConversationId) return conv;
        
        const messages = conv.messages.map(msg => {
          if (msg.id !== state.streamingMessageId) return msg;
          return {
            ...msg,
            content: state.streamingContent,
            status: 'complete' as const,
            stats,
          };
        });
        
        return {
          ...conv,
          messages,
          updatedAt: Date.now(),
        };
      });
      
      debouncedSave(conversations);
      
      return {
        conversations,
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
      };
    });
  },

  cancelStreaming: () => {
    set(state => {
      // 保留已接收的内容，但标记为错误状态
      const conversations = state.conversations.map(conv => {
        if (conv.id !== state.activeConversationId) return conv;

        const messages = conv.messages.map(msg => {
          if (msg.id !== state.streamingMessageId) return msg;
          return {
            ...msg,
            content: state.streamingContent || '（响应已中断）',
            status: 'error' as const,
          };
        });

        return { ...conv, messages };
      });

      debouncedSave(conversations);

      return {
        conversations,
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
      };
    });
  },

  removeMessages: (conversationId, messageIds) => {
    const idSet = new Set(messageIds);

    set(state => {
      // 如果要移除的包含流式消息，同步退出流式状态
      const removingStreamingMessage =
        state.streamingMessageId !== null && idSet.has(state.streamingMessageId);

      const conversations = state.conversations.map(conv => {
        if (conv.id !== conversationId) return conv;

        return {
          ...conv,
          messages: conv.messages.filter(msg => !idSet.has(msg.id)),
          updatedAt: Date.now(),
        };
      });

      conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      debouncedSave(conversations);

      if (!removingStreamingMessage) {
        return { conversations };
      }

      return {
        conversations,
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
      };
    });
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find(c => c.id === activeConversationId) || null;
  },

  clearAllConversations: () => {
    set({
      conversations: [],
      activeConversationId: null,
    });
    debouncedSave([]);
  },

  updateConversationTitle: (id, title) => {
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== id) return conv;
        return { ...conv, title };
      });
      
      debouncedSave(conversations);
      return { conversations };
    });
  },
}));
