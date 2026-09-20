import { Button, message } from 'antd';

/**
 * 本地保存失败提示的 key：同一时间只保留一条，重试成功后关闭
 */
const SAVE_FAILURE_KEY = 'local-save-failure';

/**
 * 提示本地保存失败，并提供「重新保存」操作。
 * 与网络异常、超长、空内容等场景的措辞完全独立：
 * 仅用于消息/草稿写入 localStorage 失败。
 *
 * @param onRetry 用户点击「重新保存」后执行的重试逻辑；不抛错即视为成功
 * @param scope 失败对象的称呼，用于区分「对话记录」与「草稿」
 */
export function notifyLocalSaveFailure(onRetry: () => void, scope: string = '内容'): void {
  message.error({
    key: SAVE_FAILURE_KEY,
    // duration 0：不自动消失，必须由用户重试或手动关闭
    duration: 0,
    content: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span>本地保存失败，{scope}可能无法在重新打开后恢复。</span>
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto' }}
          onClick={() => {
            try {
              onRetry();
              dismissLocalSaveFailure();
            } catch {
              // 重试仍然失败：提示继续保留，允许再次点击
            }
          }}
        >
          重新保存
        </Button>
      </span>
    ),
  });
}

/**
 * 关闭本地保存失败提示（重试成功后调用）
 */
export function dismissLocalSaveFailure(): void {
  message.destroy(SAVE_FAILURE_KEY);
}
