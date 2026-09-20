import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  KeyboardEvent,
  ClipboardEvent,
} from 'react';
import { Button, Input, message, Tooltip } from 'antd';
import { SendOutlined, StopOutlined, FileTextOutlined } from '@ant-design/icons';
import { validateMessageContent } from '../../utils/validators';
import {
  loadDraft,
  saveDraft,
  moveDraft,
  removeDraft,
  NEW_CONVERSATION_DRAFT_KEY,
} from '../../services/storage';
import { PromptTemplateLibrary } from '../PromptTemplate';
import './InputArea.css';

const { TextArea } = Input;

const MAX_MESSAGE_LENGTH = 4000;

interface InputAreaProps {
  conversationId: string | null;
  onSend: (content: string) => boolean | Promise<boolean>;
  onStop?: () => void;
  isLoading: boolean;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * 输入区域组件
 */
export function InputArea({
  conversationId,
  onSend,
  onStop,
  isLoading,
  isStreaming,
  disabled = false,
  placeholder = '输入消息，按 Enter 发送，Shift + Enter 换行',
}: InputAreaProps) {
  const draftKey = conversationId || NEW_CONVERSATION_DRAFT_KEY;
  const [content, setContent] = useState('');
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState(false);
  const [draftCleanupError, setDraftCleanupError] = useState(false);
  const [caretPosition, setCaretPosition] = useState<number | null>(null);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const draftKeyRef = useRef(draftKey);
  const contentRef = useRef(content);
  const previousDraftKeyRef = useRef<string | null>(null);

  draftKeyRef.current = draftKey;
  contentRef.current = content;

  const restoreCaret = useCallback((position: number) => {
    const textArea = textAreaRef.current;
    if (!textArea) return;

    const nextPosition = Math.max(0, Math.min(position, textArea.value.length));
    textArea.focus();
    textArea.setSelectionRange(nextPosition, nextPosition);
  }, []);

  useLayoutEffect(() => {
    if (caretPosition === null) return;
    restoreCaret(caretPosition);
    setCaretPosition(null);
  }, [caretPosition, restoreCaret, content]);

  // 切换会话时恢复该会话的草稿；新建会话发送时，把当前输入内容迁移到新草稿键下。
  useEffect(() => {
    const previousKey = previousDraftKeyRef.current;
    if (previousKey === draftKey) return;

    const storedDraft = loadDraft(draftKey);
    const activeDraft = contentRef.current;

    if (storedDraft) {
      setContent(storedDraft);
      setDraftSaveError(false);
      setDraftCleanupError(false);
    } else if (
      previousKey === NEW_CONVERSATION_DRAFT_KEY &&
      submittingRef.current &&
      activeDraft
    ) {
      try {
        moveDraft(previousKey, draftKey, activeDraft);
        setDraftSaveError(false);
      } catch {
        setDraftSaveError(true);
      }
    } else {
      setContent('');
      setDraftSaveError(false);
      setDraftCleanupError(false);
    }

    previousDraftKeyRef.current = draftKey;
  }, [draftKey]);

  const persistDraft = useCallback((nextContent: string): boolean => {
    try {
      saveDraft(draftKeyRef.current, nextContent);
      setDraftSaveError(false);
      setDraftCleanupError(false);
      return true;
    } catch {
      setDraftSaveError(true);
      return false;
    }
  }, []);

  const handleUseTemplate = useCallback((templateContent: string) => {
    setContent(templateContent);
    persistDraft(templateContent);
    setTemplateLibraryOpen(false);
    setCaretPosition(templateContent.length);
  }, [persistDraft]);

  const handleChange = useCallback((nextContent: string) => {
    setContent(nextContent);
    persistDraft(nextContent);
  }, [persistDraft]);

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text/plain');
    if (!pastedText) return;

    const textArea = e.currentTarget;
    const start = textArea.selectionStart ?? content.length;
    const end = textArea.selectionEnd ?? content.length;
    const nextContent = content.slice(0, start) + pastedText + content.slice(end);
    const nextCaretPosition = start + pastedText.length;

    e.preventDefault();
    handleChange(nextContent);
    // 粘贴后弹出超长提示等后续更新会重新布局，这里保持粘贴后的光标位置
    setCaretPosition(nextCaretPosition);
  }, [content, handleChange]);

  const handleSend = useCallback(async () => {
    if (submittingRef.current) {
      message.warning('消息正在发送，请勿重复提交');
      return;
    }

    if (isStreaming) {
      return;
    }

    if (!validateMessageContent(content)) {
      return;
    }

    const overLimitCount = content.length - MAX_MESSAGE_LENGTH;
    if (overLimitCount > 0) {
      message.warning(`内容超出 ${MAX_MESSAGE_LENGTH} 字上限 ${overLimitCount} 字，请删减后再发送`);
      return;
    }

    if (draftSaveError || !persistDraft(content)) {
      message.error('本地草稿保存失败，发送前请重新保存一次');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const isSent = await onSend(content);
      const currentDraftKey = draftKeyRef.current;

      if (isSent) {
        try {
          removeDraft(currentDraftKey);
          setDraftSaveError(false);
          setDraftCleanupError(false);
        } catch {
          setDraftCleanupError(true);
          message.error('发送已完成，但本地草稿清理失败，请重试清理');
        }
        setContent('');
      }
    } catch {
      // 业务层会给出具体失败原因；这里只保证提交锁释放
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      textAreaRef.current?.focus();
    }
  }, [content, draftSaveError, isStreaming, onSend, persistDraft]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter 发送，Shift + Enter 换行
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleStop = useCallback(() => {
    if (onStop) {
      onStop();
    }
  }, [onStop]);

  const handleRetryDraftSave = useCallback(() => {
    if (persistDraft(content)) {
      message.success('草稿已保存，可以继续发送');
    } else {
      message.error('本地草稿保存失败，请稍后重试');
    }
  }, [content, persistDraft]);

  const handleRetryDraftCleanup = useCallback(() => {
    try {
      removeDraft(draftKeyRef.current);
      setDraftCleanupError(false);
      message.success('本地草稿已清理');
    } catch {
      message.error('本地草稿清理失败，请稍后重试');
    }
  }, []);

  const isDisabled = disabled || (!isStreaming && isLoading);
  const showStopButton = isStreaming;
  const hasContent = content.trim().length > 0;
  const overLimitCount = content.length > MAX_MESSAGE_LENGTH ? content.length - MAX_MESSAGE_LENGTH : 0;
  const canSend = hasContent && overLimitCount === 0 && !draftSaveError && !isSubmitting;

  return (
    <div className="input-area">
      <div className="input-container glass-card">
        <div className="input-toolbar">
          <Tooltip title="提示词模板库">
            <Button
              type="text"
              icon={<FileTextOutlined />}
              onClick={() => setTemplateLibraryOpen(true)}
              disabled={isDisabled}
              className="template-library-btn"
            >
              模板
            </Button>
          </Tooltip>
        </div>

        <div className="input-content-row">
          <TextArea
            ref={textAreaRef as React.RefObject<any>}
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isDisabled}
            autoSize={{ minRows: 1, maxRows: 6 }}
            className="message-input"
          />

          <div className="input-actions">
          {showStopButton ? (
            <Button
              type="primary"
              danger
              icon={<StopOutlined />}
              onClick={handleStop}
              className="stop-button"
            >
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => void handleSend()}
              loading={isLoading || isSubmitting}
              disabled={isDisabled || !canSend}
              className="send-button"
            >
              发送
            </Button>
          )}
          </div>
        </div>

        {(overLimitCount > 0 || draftSaveError || draftCleanupError) && (
          <div className="input-alerts" role="alert">
            {overLimitCount > 0 && (
              <span className="input-alert limit-alert">
                内容超出 {MAX_MESSAGE_LENGTH} 字上限 {overLimitCount} 字，请删减后再发送
              </span>
            )}
            {draftSaveError && (
              <span className="input-alert save-alert">
                本地草稿保存失败，暂不能提交
                <Button type="link" size="small" onClick={handleRetryDraftSave}>
                  重试保存
                </Button>
              </span>
            )}
            {draftCleanupError && (
              <span className="input-alert save-alert">
                本地草稿清理失败，请再清理一次
                <Button type="link" size="small" onClick={handleRetryDraftCleanup}>
                  重试清理
                </Button>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="input-hint">
        <span>按 Enter 发送，Shift + Enter 换行</span>
        <span className="hint-separator">|</span>
        <span className="template-hint" onClick={() => setTemplateLibraryOpen(true)}>
          <FileTextOutlined /> 点击打开提示词模板库
        </span>
      </div>

      <PromptTemplateLibrary
        open={templateLibraryOpen}
        onClose={() => setTemplateLibraryOpen(false)}
        onUseTemplate={handleUseTemplate}
      />
    </div>
  );
}
