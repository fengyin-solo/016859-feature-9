import type { AppConfig, Conversation, PromptTemplate } from '../types';
import { DEFAULT_CONFIG, DEFAULT_TEMPLATES } from '../types';

// Storage keys
const STORAGE_KEYS = {
  CONFIG: 'react-chat-config',
  CONVERSATIONS: 'react-chat-conversations',
  PROMPT_TEMPLATES: 'react-chat-prompt-templates',
  DRAFTS: 'react-chat-message-drafts',
} as const;

/**
 * 尚未进入任何对话时的草稿键
 */
export const NO_CONVERSATION_DRAFT_KEY = '__no_conversation__';

/**
 * 各对话输入草稿的结构：conversationId -> 草稿文本
 */
export type MessageDrafts = Record<string, string>;

/**
 * 简单的加密函数（Base64 + 字符偏移）
 * 注意：这不是真正的加密，只是简单的混淆，防止明文存储
 */
function encrypt(text: string): string {
  if (!text) return '';
  
  // 先进行字符偏移
  const shifted = text
    .split('')
    .map(char => String.fromCharCode(char.charCodeAt(0) + 3))
    .join('');
  
  // 然后 Base64 编码
  return btoa(encodeURIComponent(shifted));
}

/**
 * 解密函数
 */
function decrypt(encoded: string): string {
  if (!encoded) return '';
  
  try {
    // 先 Base64 解码
    const shifted = decodeURIComponent(atob(encoded));
    
    // 然后字符偏移还原
    return shifted
      .split('')
      .map(char => String.fromCharCode(char.charCodeAt(0) - 3))
      .join('');
  } catch {
    return '';
  }
}

/**
 * 保存配置到 localStorage
 * @param config 应用配置
 */
export function saveConfig(config: AppConfig): void {
  try {
    // 加密 API Key
    const configToSave = {
      ...config,
      apiKey: encrypt(config.apiKey),
    };
    
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(configToSave));
  } catch (error) {
    console.error('Failed to save config:', error);
    throw new Error('保存配置失败');
  }
}

/**
 * 从 localStorage 加载配置
 * @returns 应用配置，如果不存在则返回默认配置
 */
export function loadConfig(): AppConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CONFIG);
    
    if (!stored) {
      return DEFAULT_CONFIG;
    }
    
    const parsed = JSON.parse(stored) as AppConfig;
    
    // 解密 API Key
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      apiKey: decrypt(parsed.apiKey),
    };
  } catch (error) {
    console.error('Failed to load config:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * 清除配置
 */
export function clearConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.CONFIG);
  } catch (error) {
    console.error('Failed to clear config:', error);
  }
}

/**
 * 保存对话列表到 localStorage
 * @param conversations 对话列表
 */
export function saveConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
  } catch (error) {
    console.error('Failed to save conversations:', error);
    
    // 如果存储失败（可能是超出配额），尝试只保存最近的对话
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      const recentConversations = conversations.slice(0, 10);
      try {
        localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(recentConversations));
      } catch {
        throw new Error('存储空间不足，无法保存对话');
      }
    } else {
      throw new Error('保存对话失败');
    }
  }
}

/**
 * 从 localStorage 加载对话列表
 * @returns 对话列表
 */
export function loadConversations(): Conversation[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    
    if (!stored) {
      return [];
    }
    
    const parsed = JSON.parse(stored) as Conversation[];
    
    // 验证数据结构
    if (!Array.isArray(parsed)) {
      return [];
    }
    
    // 过滤无效数据并按更新时间排序
    return parsed
      .filter(conv => conv && conv.id && Array.isArray(conv.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error('Failed to load conversations:', error);
    return [];
  }
}

/**
 * 清除所有对话
 */
export function clearConversations(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.CONVERSATIONS);
  } catch (error) {
    console.error('Failed to clear conversations:', error);
  }
}

/**
 * 保存单个对话的输入草稿（发送失败、页面关闭后仍可恢复）
 * @param conversationKey 对话 ID；没有对话时使用 NO_CONVERSATION_DRAFT_KEY
 * @param draft 草稿内容；为空字符串时删除该草稿
 */
export function saveMessageDraft(conversationKey: string, draft: string): void {
  const drafts = loadMessageDrafts();

  if (draft) {
    drafts[conversationKey] = draft;
  } else {
    delete drafts[conversationKey];
  }

  try {
    localStorage.setItem(STORAGE_KEYS.DRAFTS, JSON.stringify(drafts));
  } catch (error) {
    console.error('Failed to save message draft:', error);
    throw new Error('保存草稿失败');
  }
}

/**
 * 读取全部输入草稿
 * @returns 草稿映射
 */
export function loadMessageDrafts(): MessageDrafts {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DRAFTS);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result: MessageDrafts = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
    return result;
  } catch (error) {
    console.error('Failed to load message drafts:', error);
    return {};
  }
}

/**
 * 读取指定对话的输入草稿
 * @param conversationKey 对话 ID；没有对话时使用 NO_CONVERSATION_DRAFT_KEY
 * @returns 草稿内容，不存在时返回空字符串
 */
export function loadMessageDraft(conversationKey: string): string {
  return loadMessageDrafts()[conversationKey] ?? '';
}

/**
 * 删除指定对话的输入草稿（消息发送成功后调用）
 * @param conversationKey 对话 ID
 */
export function clearMessageDraft(conversationKey: string): void {
  try {
    saveMessageDraft(conversationKey, '');
  } catch (error) {
    console.error('Failed to clear message draft:', error);
  }
}

/**
 * 清除所有存储数据
 */
export function clearAllStorage(): void {
  clearConfig();
  clearConversations();
  try {
    localStorage.removeItem(STORAGE_KEYS.DRAFTS);
  } catch (error) {
    console.error('Failed to clear message drafts:', error);
  }
}

/**
 * 获取存储使用情况
 * @returns 存储使用信息
 */
export function getStorageUsage(): { used: number; available: number } {
  let used = 0;
  
  try {
    for (const key of Object.values(STORAGE_KEYS)) {
      const item = localStorage.getItem(key);
      if (item) {
        used += item.length * 2; // UTF-16 编码，每个字符 2 字节
      }
    }
  } catch {
    // 忽略错误
  }
  
  // localStorage 通常限制为 5MB
  const available = 5 * 1024 * 1024 - used;
  
  return { used, available: Math.max(0, available) };
}

/**
 * 导出所有数据
 * @returns 导出的数据对象
 */
export function exportData(): { config: AppConfig; conversations: Conversation[] } {
  return {
    config: loadConfig(),
    conversations: loadConversations(),
  };
}

/**
 * 导入数据
 * @param data 要导入的数据
 */
export function importData(data: { config?: AppConfig; conversations?: Conversation[] }): void {
  if (data.config) {
    saveConfig(data.config);
  }
  
  if (data.conversations) {
    saveConversations(data.conversations);
  }
}

/**
 * 生成默认提示词模板
 * @returns 默认模板列表
 */
function generateDefaultTemplates(): PromptTemplate[] {
  const now = Date.now();
  return DEFAULT_TEMPLATES.map((template, index) => ({
    ...template,
    id: `default-${index}`,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * 保存提示词模板到 localStorage
 * @param templates 模板列表
 */
export function savePromptTemplates(templates: PromptTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PROMPT_TEMPLATES, JSON.stringify(templates));
  } catch (error) {
    console.error('Failed to save prompt templates:', error);
    throw new Error('保存提示词模板失败');
  }
}

/**
 * 从 localStorage 加载提示词模板
 * @returns 模板列表，如果不存在则返回默认模板
 */
export function loadPromptTemplates(): PromptTemplate[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PROMPT_TEMPLATES);
    
    if (!stored) {
      const defaultTemplates = generateDefaultTemplates();
      savePromptTemplates(defaultTemplates);
      return defaultTemplates;
    }
    
    const parsed = JSON.parse(stored) as PromptTemplate[];
    
    if (!Array.isArray(parsed)) {
      const defaultTemplates = generateDefaultTemplates();
      savePromptTemplates(defaultTemplates);
      return defaultTemplates;
    }
    
    return parsed
      .filter(t => t && t.id && t.name && t.content)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error('Failed to load prompt templates:', error);
    return generateDefaultTemplates();
  }
}

/**
 * 清除所有提示词模板
 */
export function clearPromptTemplates(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.PROMPT_TEMPLATES);
  } catch (error) {
    console.error('Failed to clear prompt templates:', error);
  }
}

/**
 * 重置为默认提示词模板
 * @returns 重置后的模板列表
 */
export function resetPromptTemplates(): PromptTemplate[] {
  const defaultTemplates = generateDefaultTemplates();
  savePromptTemplates(defaultTemplates);
  return defaultTemplates;
}
