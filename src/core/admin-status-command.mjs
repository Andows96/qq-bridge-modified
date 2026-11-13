/**
 * 管理员状态命令（#sl）的纯逻辑：判断「这是不是状态命令」+「状态文案怎么拼」。
 *
 * 背景：SnowLuma 网关自带的 #sl 是**任何人可触发**的网关级命令（网关侧没有管理员概念，
 * 配置 schema 也只允许 enabled/swallow/cooldownSeconds/trigger 四个键，加不了白名单），
 * 所以现在网关侧整体关掉，改由桥接按 config.json 的 ownerQQ 提供同一个入口。
 * 权限判断留在 bridge.js（isOwner）；这里不碰 cfg/state，参数全部由调用方传入，方便单测。
 */

/** 全角井号统一成半角：手机输入法很容易打出 ＃sl。 */
function normalizeCommand(text) {
  return String(text).replace(/＃/g, '#').trim().toLowerCase();
}

/**
 * 是否状态查询命令。与 SnowLuma 网关的判定语义保持一致：
 * 去首尾空白、忽略大小写、**整句等于 trigger**——`#sl 你好` 这种带参数的写法不算。
 */
export function matchStatusCommand(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return normalizeCommand(trimmed) === '#sl';
}

/** 毫秒 → 「3 天 4 小时」/「2 小时 14 分」/「37 分」/「8 秒」，只保留两级，别啰嗦。 */
export function formatUptimeCn(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  if (minutes > 0) return `${minutes} 分`;
  return `${seconds} 秒`;
}

/** 会话 id 只取短名：完整 uuid 没必要、也不该发到 QQ 里（id 常带 `session-` 前缀，先剥掉）。 */
function shortSessionId(sessionId) {
  const raw = String(sessionId ?? '').trim().replace(/^session[-_ ]?/i, '');
  return raw.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8).toLowerCase();
}

/**
 * 拼管理员状态回复（最多三行，QQ 里一眼能读完）。
 * 传空字段就自动省略对应片段，不会出现「版本 · 」这种残句。
 */
export function buildAdminStatusText(info = {}) {
  const version = String(info.version ?? '').trim();
  const accountId = String(info.accountId ?? '').trim();
  const accountName = String(info.accountName ?? '').trim();
  const head = `SnowLuma${version ? ` ${version}` : ''}`;
  const account = accountId ? `账号 ${accountName ? `${accountName}（${accountId}）` : accountId}` : '';
  const firstLine = [head, String(info.linkText ?? '').trim(), account].filter(Boolean).join(' · ');

  const bridgeBits = [`桥接 ${String(info.bridgeMode ?? '').trim() || '未知模式'}`];
  if (info.dshReady === true) bridgeBits.push('DSH 就绪');
  else if (info.dshReady === false) bridgeBits.push('DSH 未就绪');
  const sid = shortSessionId(info.sessionId);
  if (sid) bridgeBits.push(`会话 ${sid}`);

  const tailBits = [`已运行 ${formatUptimeCn(info.uptimeMs)}`];
  const lastPacketAgoMs = Number(info.lastPacketAgoMs);
  if (info.lastPacketAgoMs != null && Number.isFinite(lastPacketAgoMs) && lastPacketAgoMs >= 0) {
    tailBits.push(`最近事件 ${Math.max(0, Math.round(lastPacketAgoMs / 1000))} 秒前`);
  }

  return [firstLine, bridgeBits.join(' · '), tailBits.join(' · ')].join('\n');
}
