import { useState, useRef, useCallback, useEffect, KeyboardEvent, ClipboardEvent } from 'react';
import { Button, Input, message, Tooltip } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { SendOutlined, StopOutlined, FileTextOutlined } from '@ant-design/icons';
import {
  MAX_MESSAGE_LENGTH,
  getMessageLength,
  validateMessageForSend,
} from '../../utils/validators';
import {
  saveMessageDraft,
  loadMessageDraft,
  NO_CONVERSATION_DRAFT_KEY,
} from '../../services/storage';
import { notifyLocalSaveFailure } from '../../services/notify';
import { PromptTemplateLibrary } from '../PromptTemplate';
import './InputArea.css';

const { TextArea } = Input;

/** 草稿本地保存的防抖间隔 */
const DRAFT_SAVE_DEBOUNCE = 300;

interface InputAreaProps {
  onSend: (content: string) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  isLoading?: boolean;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** 当前对话 ID；切换对话时读取对应草稿 */
  conversationId?: string | null;
  /** 自增令牌：发送失败回填草稿后通知组件重新读取 */
  restoreDraftToken?: number;
}

/**
 * 输入区域组件
 */
export function InputArea({
  onSend,
  onStop,
  isLoading = false,
  isStreaming,
  disabled = false,
  placeholder = '输入消息，按 Enter 发送，Shift + Enter 换行',
  conversationId = null,
  restoreDraftToken = 0,
}: InputAreaProps) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);

  const textAreaRef = useRef<TextAreaRef>(null);
  /** 发送锁：从按下发送到本轮请求结束，防止重复提交 */
  const sendingRef = useRef(false);
  /** 最近一次弹出「请勿重复提交」提示的时间，用于节流 */
  const lastDuplicateWarnAtRef = useRef(0);
  /** 最近一次已知光标位置（弹窗等操作夺走焦点后可还原） */
  const lastSelectionRef = useRef({ start: 0, end: 0 });

  /** 待落盘的草稿（始终保留最新的一份，防抖写出） */
  const pendingDraftRef = useRef<{ key: string; value: string } | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 当前对话草稿是否已完成首次读取（避免水合前用旧内容覆盖草稿） */
  const hydratedRef = useRef(false);

  /** 获取 antd TextArea 内部的原生 <textarea> */
  const getNativeTextArea = useCallback(
    (): HTMLTextAreaElement | null =>
      textAreaRef.current?.resizableTextArea?.textArea ?? null,
    []
  );

  const draftKey = conversationId ?? NO_CONVERSATION_DRAFT_KEY;

  const trimmedLength = getMessageLength(content);
  const overLength = Math.max(0, trimmedLength - MAX_MESSAGE_LENGTH);
  const isBusy = isStreaming || sending || isLoading;
  /**
   * 立即执行一次草稿落盘；失败时给出独立的「重新保存」入口
   */
  const flushDraftSave = useCallback(() => {
    const pending = pendingDraftRef.current;
    if (!pending) return;
    pendingDraftRef.current = null;

    try {
      saveMessageDraft(pending.key, pending.value);
    } catch {
      // 本地保存失败：草稿留在待写队列，用户可以重新来一遍
      pendingDraftRef.current = pending;
      notifyLocalSaveFailure(() => flushDraftSave(), '草稿');
    }
  }, []);

  /** 防抖调度草稿保存 */
  const scheduleDraftSave = useCallback(
    (key: string, value: string) => {
      // 草稿尚未水合完成时不写出，避免用切换前的旧内容覆盖新对话草稿
      if (!hydratedRef.current) return;
      pendingDraftRef.current = { key, value };
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
      }
      draftTimerRef.current = setTimeout(flushDraftSave, DRAFT_SAVE_DEBOUNCE);
    },
    [flushDraftSave]
  );

  // 切换对话 / 发送失败回填时，读取对应草稿（重新打开页面时草稿仍在）
  useEffect(() => {
    hydratedRef.current = false;
    // 切换对话前取消尚未写出的旧草稿定时器
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    pendingDraftRef.current = null;
    setContent(loadMessageDraft(draftKey));
    hydratedRef.current = true;
  }, [draftKey, restoreDraftToken]);

  // 卸载前把最后一份草稿写出去
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
      }
      flushDraftSave();
    };
  }, [flushDraftSave]);

  /** 记录当前选区，供焦点被夺走后还原 */
  const syncLastSelection = useCallback(() => {
    const textArea = getNativeTextArea();
    if (textArea) {
      lastSelectionRef.current = {
        start: textArea.selectionStart,
        end: textArea.selectionEnd,
      };
    }
  }, [getNativeTextArea]);

  /** 把光标还原到指定位置 */
  const restoreSelection = useCallback(
    (position: number) => {
      const textArea = getNativeTextArea();
      if (!textArea) return;
      textArea.focus();
      const clamped = Math.min(position, textArea.value.length);
      textArea.setSelectionRange(clamped, clamped);
    },
    [getNativeTextArea]
  );

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      scheduleDraftSave(draftKey, value);
    },
    [draftKey, scheduleDraftSave]
  );

  /**
   * 粘贴处理：不阻止原生粘贴（保留换行），超长时只提示超出量、禁止提交，
   * 并在提示框弹出导致焦点变化后把光标放回粘贴前的插入位置。
   */
  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      syncLastSelection();
      const textArea = getNativeTextArea();
      const pasted = e.clipboardData?.getData('text') ?? '';
      if (!textArea || !pasted) return;

      const start = textArea.selectionStart;
      const end = textArea.selectionEnd;
      const nextValue = content.slice(0, start) + pasted + content.slice(end);
      // 粘贴后光标自然停在插入文本的末尾（即原来的插入位置）
      const caretAfterPaste = start + pasted.length;
      const overflow = Math.max(0, getMessageLength(nextValue) - MAX_MESSAGE_LENGTH);

      if (overflow > 0) {
        // 等原生粘贴完成、提示框出现后，把光标还原回插入位置
        setTimeout(() => {
          restoreSelection(caretAfterPaste);
          message.warning({
            content: `粘贴的内容超出长度上限 ${overflow} 个字，已保留全部内容，请删减后再发送`,
            duration: 4,
          });
          // 提示动画完成后再次校正，确保焦点回到输入框
          setTimeout(() => restoreSelection(caretAfterPaste), 50);
        }, 0);
      }
    },
    [content, restoreSelection, syncLastSelection]
  );

  const handleUseTemplate = useCallback(
    (templateContent: string) => {
      setContent(templateContent);
      scheduleDraftSave(draftKey, templateContent);
      setTemplateLibraryOpen(false);

      setTimeout(() => {
        restoreSelection(templateContent.length);
      }, 50);
    },
    [draftKey, restoreSelection, scheduleDraftSave]
  );

  const handleSend = useCallback(async () => {
    // 情况三：发送过程中再次按下发送，不允许重复提交
    if (isStreaming || sendingRef.current) {
      const now = Date.now();
      if (now - lastDuplicateWarnAtRef.current > 2000) {
        lastDuplicateWarnAtRef.current = now;
        message.warning('消息正在发送中，请勿重复提交');
      }
      return;
    }

    // 情况一 / 情况二：空内容（含纯空格）与超长各自独立的措辞
    const validation = validateMessageForSend(content);
    if (validation.reason === 'empty') {
      message.warning('内容不能只有空格，请输入有效内容后再发送');
      return;
    }
    if (validation.reason === 'tooLong') {
      message.warning(
        `内容已超出长度上限 ${validation.overflow} 个字，无法发送，请先删减内容`,
        4
      );
      return;
    }

    const trimmed = content.trim();
    sendingRef.current = true;
    setSending(true);
    try {
      // 返回 false（如网络异常导致这一条没发出去）时保留内容与草稿
      const result = await onSend(trimmed);
      if (result !== false) {
        setContent('');
        // 发送成功：清除该对话草稿（直接写空值删除键）
        if (draftTimerRef.current) {
          clearTimeout(draftTimerRef.current);
        }
        pendingDraftRef.current = { key: draftKey, value: '' };
        flushDraftSave();
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      // 重新聚焦输入框，并还原到最后一次的光标位置
      setTimeout(() => {
        const textArea = getNativeTextArea();
        if (textArea) {
          textArea.focus();
          const pos = Math.min(lastSelectionRef.current.start, textArea.value.length);
          textArea.setSelectionRange(pos, pos);
        }
      }, 0);
    }
  }, [content, draftKey, flushDraftSave, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter 发送，Shift + Enter 换行（原有行为保持不变）
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  const isDisabled = disabled || (!isStreaming && isLoading);
  const showStopButton = isStreaming;
  const sendDisabled =
    isDisabled || trimmedLength === 0 || overLength > 0 || isBusy;

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
            ref={textAreaRef}
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onSelect={syncLastSelection}
            onClick={syncLastSelection}
            onKeyUp={syncLastSelection}
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
              loading={sending}
              disabled={sendDisabled}
              className="send-button"
            >
              发送
            </Button>
          )}
          </div>
        </div>

        <div className="input-footer">
          <div className="input-hint">
            <span>按 Enter 发送，Shift + Enter 换行</span>
            <span className="hint-separator">|</span>
            <span className="template-hint" onClick={() => setTemplateLibraryOpen(true)}>
              <FileTextOutlined /> 点击打开提示词模板库
            </span>
          </div>
          <div className={`input-counter${overLength > 0 ? ' is-over' : ''}`}>
            {overLength > 0 ? `超出 ${overLength} 字 · ` : ''}
            {trimmedLength}/{MAX_MESSAGE_LENGTH}
          </div>
        </div>
      </div>

      <PromptTemplateLibrary
        open={templateLibraryOpen}
        onClose={() => setTemplateLibraryOpen(false)}
        onUseTemplate={handleUseTemplate}
      />
    </div>
  );
}
