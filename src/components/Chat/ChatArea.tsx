import { useCallback, useRef } from 'react';
import { message } from 'antd';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { useChatStore } from '../../stores/chatStore';
import { useConfigStore } from '../../stores/configStore';
import { sendMessageStream } from '../../services/api';
import { createStreamHandler, toMessageStats } from '../../services/stream';
import { parseError, logError, shouldShowConfigPanel, ErrorType } from '../../services/errorHandler';
import { useUIStore } from '../../stores/uiStore';
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
    updateMessage,
    rollbackMessages,
    startStreaming,
    appendStreamContent,
    finishStreaming,
    cancelStreaming,
    createConversation,
  } = useChatStore();

  const { config, isValid: isConfigValid } = useConfigStore();
  const { setConfigPanelVisible } = useUIStore();
  const sendingRef = useRef(false);

  const conversation = getActiveConversation();
  const messages = conversation?.messages || [];

  const handleSend = useCallback(
    async (content: string): Promise<boolean> => {
      if (sendingRef.current) {
        message.warning('消息正在发送，请勿重复提交');
        return false;
      }

      if (isStreaming) {
        return false;
      }

      if (!isConfigValid) {
        message.warning('请先配置 API Key');
        setConfigPanelVisible(true);
        return false;
      }

      // 先创建会话，保证输入草稿可以立即迁移到该会话下
      const conversationId = activeConversationId || createConversation();
      const stateBeforeAdd = useChatStore.getState();
      const currentConversation = stateBeforeAdd.conversations.find(c => c.id === conversationId);
      const historyMessages = currentConversation?.messages || [];

      // 添加用户消息
      const userMessageId = addMessage(conversationId, {
        role: 'user',
        content,
        status: 'pending',
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
      sendingRef.current = true;

      const rollbackUnsentMessage = () => {
        rollbackMessages(conversationId, [userMessageId, assistantMessageId]);
      };

      let requestSucceeded = false;

      try {
        const stream = sendMessageStream(apiMessages, {
          ...config,
          stream: true,
        });

        requestSucceeded = await streamHandler.start(stream, {
          onChunk: (chunk) => {
            appendStreamContent(conversationId, chunk);
          },
          onComplete: (stats) => {
            updateMessage(conversationId, userMessageId, { status: 'complete' });
            finishStreaming(conversationId, toMessageStats(stats));
          },
          onError: (error) => {
            const appError = parseError(error);
            logError(appError, 'ChatArea.handleSend');
            const wasNetworkError = appError.type === ErrorType.NETWORK_ERROR;

            rollbackUnsentMessage();
            cancelStreaming(conversationId);

            if (wasNetworkError) {
              message.error('网络连接已断开，这条消息没有发出，已保留在草稿中，请重新发送');
            } else {
              message.error(appError.message);
            }

            if (shouldShowConfigPanel(appError)) {
              setConfigPanelVisible(true);
            }

            return !wasNetworkError;
          },
          onAbort: () => {
            updateMessage(conversationId, userMessageId, { status: 'complete' });
            cancelStreaming(conversationId);
          },
        });

        return requestSucceeded;
      } catch (error) {
        const appError = parseError(error);
        logError(appError, 'ChatArea.handleSend');
        rollbackUnsentMessage();
        cancelStreaming(conversationId);

        if (appError.type === ErrorType.NETWORK_ERROR) {
          message.error('网络连接已断开，这条消息没有发出，已保留在草稿中，请重新发送');
        } else {
          message.error(appError.message);
        }

        if (shouldShowConfigPanel(appError)) {
          setConfigPanelVisible(true);
        }

        return false;
      } finally {
        sendingRef.current = false;
      }
    },
    [
      activeConversationId,
      isConfigValid,
      isStreaming,
      config,
      messages,
      addMessage,
      updateMessage,
      rollbackMessages,
      startStreaming,
      appendStreamContent,
      finishStreaming,
      cancelStreaming,
      createConversation,
      setConfigPanelVisible,
    ]
  );

  const handleStop = useCallback(() => {
    streamHandler.abort();
  }, []);

  return (
    <div className="chat-area">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingMessageId={streamingMessageId}
      />
      <InputArea
        conversationId={activeConversationId}
        onSend={handleSend}
        onStop={handleStop}
        isLoading={false}
        isStreaming={isStreaming}
        disabled={false}
      />
    </div>
  );
}
