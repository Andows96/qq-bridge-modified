/**
 * 角色卡注入频次决策（纯函数、无副作用、无 import，便于单测）。
 *
 * 背景：reserved2 每次唤醒都会把整张人设卡（约 6000~7000 字符）塞进提示词正文，
 * 一次唤醒光人设就烧掉两千多 token，而同一个 DSH 会话的上下文里其实一直躺着前几次的卡。
 *
 * 策略由 socialV2.roleCard.mode 决定：
 *   - 'first'  ：同一个 DSH 会话里只在**第一次**投递时带完整角色卡，之后只留一行提示
 *                （默认）。会话 id 变了（reset / 退役重建 / 换模式）就重新带一次。
 *   - 'digest' ：同上，但之后不是只留一行，而是留一段很短的人设摘要
 *                （socialV2.roleCard.digest）。上下文被 DSH 压缩后仍能保住人设的兜底档。
 *   - 'always' ：老行为，每次都带完整角色卡（调试/排障用）。
 *
 * fullEveryWakes > 0 时额外做周期性重发：同一个会话里每 N 次投递重发一次完整卡，
 * 用来对付"聊太久上下文被压缩、人设淡掉"的情况。默认 0（关闭）。
 */

export const ROLE_CARD_MODES = ['first', 'digest', 'always'];

function toInt(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {object} opts
 * @param {string} [opts.mode]            'first' | 'digest' | 'always'
 * @param {string} [opts.sessionId]       当前 DSH 会话 id（拿不到就传空）
 * @param {string} [opts.lastSessionId]   上次投递完整卡时记下的会话 id
 * @param {number} [opts.wakes]           同一会话里已经投递过几次（不含本次）
 * @param {number} [opts.fullEveryWakes]  每多少次投递强制重发一次完整卡，0=关闭
 * @returns {{full: boolean, reason: string, nextWakes: number, nextSessionId: string}}
 *   full=true 表示这次要带完整角色卡；nextWakes/nextSessionId 是投递成功后应写回的记账值。
 *   注意：本函数只算，不写；调用方投递成功后再落盘。
 */
export function decideRoleCardInjection(opts = {}) {
  const mode = ROLE_CARD_MODES.includes(String(opts.mode ?? '').trim())
    ? String(opts.mode).trim()
    : 'first';
  const sessionId = String(opts.sessionId ?? '').trim();
  const lastSessionId = String(opts.lastSessionId ?? '').trim();
  const wakes = Math.max(0, toInt(opts.wakes, 0));
  const fullEveryWakes = Math.max(0, toInt(opts.fullEveryWakes, 0));

  if (mode === 'always') {
    return { full: true, reason: 'mode=always', nextWakes: 0, nextSessionId: sessionId || lastSessionId };
  }
  // 拿不到会话 id（会话还没建好）：保守起见照旧带完整卡，且不记账，避免把"首投"记丢。
  if (!sessionId) {
    return { full: true, reason: 'no-session-id', nextWakes: wakes, nextSessionId: lastSessionId };
  }
  if (sessionId !== lastSessionId) {
    return { full: true, reason: 'new-session', nextWakes: 1, nextSessionId: sessionId };
  }
  const next = wakes + 1;
  if (fullEveryWakes > 0 && next >= fullEveryWakes) {
    return { full: true, reason: `periodic(${next}/${fullEveryWakes})`, nextWakes: 0, nextSessionId: sessionId };
  }
  return { full: false, reason: 'same-session', nextWakes: next, nextSessionId: sessionId };
}

/**
 * 不带完整卡时的替代段。mode='digest' 且配了摘要就用摘要，否则只留一行提示。
 * @param {string} mode
 * @param {string} digest
 */
export function roleCardStubText(mode, digest) {
  const text = String(digest ?? '').trim();
  if (String(mode ?? '').trim() === 'digest' && text) return text;
  return '人设已在本会话上文完整给出，沿用即可。';
}
