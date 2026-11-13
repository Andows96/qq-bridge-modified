/**
 * 唤醒提示词的「分段注入」决策（纯函数、无副作用、无 import，便于单测）。
 *
 * 背景：reserved2 每次唤醒都会把一整份 4000~8000 字符的提示词塞进 DSH 会话。真正每轮都会变的
 * 只有状态类几段（当前时间/当前角色/会话令牌/首回复节奏/此刻状态/当前唤醒/进行中的话题/
 * 对群友的印象/参与度参考/时间感/唤醒/消息快照）；而【你的身份】【反AI味】【积极性】
 * 【表情包策略】【可用表情包】【沉睡前强制等待】【行动前】【引用】这些**规则类**内容在同一条
 * 会话里一直躺在上下文里，每轮重发等于重复烧 token。
 *
 * 策略：同一 DSH 会话里第一次完整注入（首轮），之后每 N 次唤醒再完整注入一次，其余轮次只留
 * 一行占位（"已在本会话上文完整给出，沿用即可"）。会话换了（reset / 退役重建 / 换模式）从新会话
 * 重新算，保证新上下文里一定有一份完整的。
 *
 * 注意：角色卡是**另一套独立计数**（role-card-gate.js 的 roleCardWakes/fullEveryWakes，默认 10），
 * 两者互不影响 —— 角色卡管人设卡，这里管规则块。
 */

/** 省略时占位行里列出的段落名，必须和完整注入时的分节标题对得上，模型才好对上号。 */
export const PROMPT_META_BLOCKS = [
  '你的身份',
  '反AI味',
  '积极性',
  '表情包策略',
  '沉睡前强制等待',
  '行动前',
  // 注意：【引用】不在这里——它是行为指令，已经提到每轮常驻区（bridge.js 的 quoteLine）。
  // 放进这个名单会自相矛盾（占位行说「已在上文完整给出」，而它其实每轮都在）。
  // 【可用表情包】同理：清单是**素材**不是规则，2026-10-30 起改回每轮都发（bridge.js 的
  // stickerListLine），只把策略留在规则块里。
];

function toInt(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {object} opts
 * @param {string}  [opts.sessionId]      当前 DSH 会话 id（拿不到就传空）
 * @param {string}  [opts.lastSessionId]  上次完整注入时记下的会话 id
 * @param {number}  [opts.wakes]          同一会话里自上次完整注入以来投递过几次（不含本次）
 * @param {number}  [opts.everyWakes]     每 N 次唤醒完整注入一次；<=0 表示关闭（每轮都完整）
 * @param {boolean} [opts.enabled]        false = 关闭分段，每轮完整（回到老行为）
 * @returns {{full: boolean, reason: string, nextWakes: number, nextSessionId: string}}
 *   full=true 表示这次要带完整规则块；nextWakes/nextSessionId 是投递成功后应写回的记账值。
 *   本函数只算不写：调用方投递成功后再落盘（预构建路径要传 commit=false，否则会把首投记丢）。
 */
export function decidePromptBlocks(opts = {}) {
  const sessionId = String(opts.sessionId ?? '').trim();
  const lastSessionId = String(opts.lastSessionId ?? '').trim();
  const wakes = Math.max(0, toInt(opts.wakes, 0));
  const everyWakes = Math.max(0, toInt(opts.everyWakes, 0));
  const enabled = opts.enabled !== false;

  if (!enabled || everyWakes <= 0) {
    // 关闭/周期为 0：每轮都完整，且不动计数（关掉再打开时不会突然少发一轮）
    return { full: true, reason: enabled ? 'period-off' : 'gating-off', nextWakes: wakes, nextSessionId: lastSessionId };
  }
  // 会话还没建好：保守带全，且不记账 —— 否则"首投"会被记成一个不存在的会话
  if (!sessionId) {
    return { full: true, reason: 'no-session-id', nextWakes: wakes, nextSessionId: lastSessionId };
  }
  if (sessionId !== lastSessionId) {
    // 新会话：这次完整注入，计数归零 —— 之后的完整轮次正好是「每 everyWakes 轮」一次
    // （第 1、1+N、1+2N… 轮），而不是首轮占掉一格、第一次周期只剩 N-1 轮。
    return { full: true, reason: 'new-session', nextWakes: 0, nextSessionId: sessionId };
  }
  const next = wakes + 1;
  if (next >= everyWakes) {
    return { full: true, reason: `periodic(${next}/${everyWakes})`, nextWakes: 0, nextSessionId: sessionId };
  }
  return { full: false, reason: `same-session(${next}/${everyWakes})`, nextWakes: next, nextSessionId: sessionId };
}

/** 省略时的一行占位（约 60 字符，对比完整块 1500+ 字符）。 */
export function promptBlocksStubText(blocks = PROMPT_META_BLOCKS) {
  const names = (Array.isArray(blocks) ? blocks : PROMPT_META_BLOCKS)
    .map((b) => String(b ?? '').trim())
    .filter(Boolean);
  const head = names.length ? `【${names.join('·')}】` : '';
  return `${head}已在本会话上文完整给出，沿用即可。`;
}
