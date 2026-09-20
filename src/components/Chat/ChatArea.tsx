import { useCallback, useRef, useState } from 'react';
import { message } from 'antd';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { useChatStore } from '../../stores/chatStore';
import { useConfigStore } from '../../stores/configStore';
import { sendMessageStream } from '../../services/api';
import { createStreamHandler, toMessageStats } from '../../services/stream';
import { parseError, logError, shouldShowConfigPanel, ErrorType } from '../../services/errorHandler';
import { notifyLocalSaveFailure } from '../../services/notify';
import { useUIStore } from '../../stores/uiStore';
import { saveMessageDraft, clearMessageDraft, NO_CONVERSATION_DRAFT_KEY } from '../../services/storage';
import type { APIMessage } from '../../types';
import './ChatArea.css';

// 创建流处理器实例
const streamHandler = createStreamHandler();

/**
 * 聊天区域主组件
 */
export function ChatArea() {
  const {
    activeConversationId,
    isStreaming,
    streamingMessageId,
    getActiveConversation,
    addMessage,
    startStreaming,
    appendStreamContent,
    finishStreaming,
    cancelStreaming,
    createConversation,
    removeMessages,
  } = useChatStore();

  const { config, isValid: isConfigValid } = useConfigStore();
  const { setConfigPanelVisible } = useUIStore();

  // 发送失败回填草稿后，自增该令牌以通知输入框重新读取草稿
  const [restoreDraftToken, setRestoreDraftToken] = useState(0);
  // onError 回调先于 streamHandler.start() resolve 执行，用 ref 把结果带给外层
  const sendOutcomeRef = useRef(true);

  const conversation = getActiveConversation();
  const messages = conversation?.messages || [];

  const handleSend = useCallback(
    async (content: string): Promise<boolean> => {
      if (!isConfigValid) {
        message.warning('请先配置 API Key');
        setConfigPanelVisible(true);
        // 未进入发送流程：内容保留在输入框中
        return false;
      }

      // 如果没有活动对话，自动创建一个
      let conversationId = activeConversationId;
      if (!conversationId) {
        conversationId = createConversation();
        // 输入框此时仍挂在「无对话」草稿键上，避免旧草稿残留
        clearMessageDraft(NO_CONVERSATION_DRAFT_KEY);
      }

      // 获取当前对话的历史消息（在添加新消息之前）
      const stateBeforeAdd = useChatStore.getState();
      const currentConversation = stateBeforeAdd.conversations.find(c => c.id === conversationId);
      const historyMessages = currentConversation?.messages || [];

      // 添加用户消息
      const userMessageId = addMessage(conversationId, {
        role: 'user',
        content,
        status: 'complete',
      });

      // 准备 API 消息（历史消息 + 当前消息）
      const apiMessages: APIMessage[] = [
        ...historyMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: 'user' as const, content },
      ];

      // 开始流式响应
      const assistantMessageId = startStreaming(conversationId);

      // 是否已收到首个响应片段：收到前断网视为「这一条没发出去」
      let receivedChunk = false;
      sendOutcomeRef.current = true;

      /**
       * 发送失败回滚：移除已加入对话的用户消息与助手占位消息，
       * 把内容写回该对话草稿，并通知输入框重新加载。
       */
      const rollbackToDraft = () => {
        removeMessages(conversationId, [userMessageId, assistantMessageId]);
        try {
          saveMessageDraft(conversationId, content);
          setRestoreDraftToken((t) => t + 1);
        } catch {
          // 本地保存失败：给出独立的重新保存入口，可重新来一遍
          notifyLocalSaveFailure(() => {
            saveMessageDraft(conversationId, content);
            setRestoreDraftToken((t) => t + 1);
          }, '草稿');
        }
      };

      const handleFailure = (rawError: unknown): boolean => {
        const appError = parseError(rawError);
        logError(appError, 'ChatArea.handleSend');

        // 用户主动停止：保留已接收内容，不回滚、不报错
        if (rawError instanceof DOMException && rawError.name === 'AbortError') {
          return true;
        }

        // 首个响应片段到达前失败：这一条没有发出去
        if (!receivedChunk) {
          rollbackToDraft();

          if (appError.type === ErrorType.NETWORK_ERROR) {
            // 情况四的专属措辞：网络异常断开
            message.error('网络连接已断开，这一条消息没有发出去，已放回草稿，恢复网络后可重新发送');
          } else {
            message.error(`${appError.message} 内容已放回输入框，可调整后重新发送`);
            if (shouldShowConfigPanel(appError)) {
              setConfigPanelVisible(true);
            }
          }
          // 返回 false：输入框保留内容与草稿
          return false;
        }

        // 已有部分响应：保留已接收内容，只标记助手消息为错误
        cancelStreaming();
        message.error(appError.message);
        return true;
      };

      try {
        const stream = sendMessageStream(apiMessages, {
          ...config,
          stream: true,
        });

        await streamHandler.start(stream, {
          onChunk: (chunk) => {
            receivedChunk = true;
            appendStreamContent(chunk);
          },
          onComplete: (stats) => {
            finishStreaming(toMessageStats(stats));
          },
          onError: (error) => {
            sendOutcomeRef.current = handleFailure(error);
          },
        });
      } catch (error) {
        return handleFailure(error);
      }

      return sendOutcomeRef.current;
    },
    [
      activeConversationId,
      isConfigValid,
      config,
      messages,
      addMessage,
      startStreaming,
      appendStreamContent,
      finishStreaming,
      cancelStreaming,
      createConversation,
      removeMessages,
      setConfigPanelVisible,
    ]
  );

  const handleStop = useCallback(() => {
    streamHandler.abort();
    cancelStreaming();
    message.info('已停止响应');
  }, [cancelStreaming]);

  return (
    <div className="chat-area">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingMessageId={streamingMessageId}
      />
      <InputArea
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        disabled={false}
        conversationId={activeConversationId}
        restoreDraftToken={restoreDraftToken}
      />
    </div>
  );
}
