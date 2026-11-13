// 补拉分流回归（2026-10-31 定的 A 方案）：
//   1. 补拉回来的都算旧账；
//   2. 只有目标性触发（@/引用我/关键词/提问/指定成员）才入未读并允许唤醒；
//   3. 其余只进上文（recentMessages），不占未读、不唤醒；
//   4. 旧账里的 @ 仍要回，但提示词里必须写明「回它必须引用」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const SELF = '1000000001';
const nowSec = () => Math.floor(Date.now() / 1000);

function groupMsg({ text = '随便聊聊', atSelf = false, quote = null, backfill = false, agoSec = 600 } = {}) {
  const segs = [];
  if (quote) segs.push({ type: 'reply', data: { id: String(quote) } });
  if (atSelf) segs.push({ type: 'at', data: { qq: SELF } });
  segs.push({ type: 'text', data: { text } });
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 456,
    self_id: Number(SELF),
    user_id: 10001,
    message_id: 90000 + Math.floor(Math.random() * 1000),
    time: nowSec() - agoSec,
    message: segs,
    raw_message: (atSelf ? `[CQ:at,qq=${SELF}] ` : '') + text,
    sender: { nickname: '群友A', card: '群友A' },
    ...(backfill ? { __backfill: true } : {})
  };
}

async function makeHarness(extra = {}) {
  const h = await bridgeHarness({
    config: {
      socialV2: {
        wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 30 },
        ...extra
      }
    }
  });
  h.setMode('reserved2');
  h.setReady(true);
  h.setSelfIdentity('小鲸鱼', SELF);
  h.ensureSession('group:456');
  return h;
}

test('补拉的闲聊：只进上文，不占未读、不唤醒', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    st.bootstrapSent = true;
    st.wakeConfig = { mode: 'diving', triggers: { anyMessage: true, probability: 1 } };
    await h.handleIncoming('group', '456', groupMsg({ text: '今天的瓜真多', backfill: true }), h.cfg);
    assert.equal(st.unread.length, 0, '补拉的闲聊不该进未读');
    assert.equal(st.recentMessages.some((m) => String(m.plain).includes('今天的瓜真多')), true, '应当进上文');
    assert.equal(st.recentMessages.find((m) => String(m.plain).includes('今天的瓜真多')).stale, true, '旧账要打 stale 标记');
    assert.ok(!st.pendingWakeTimer, '不该安排唤醒');
  } finally { await h.close(); }
});

test('补拉的 @：进未读并唤醒', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    st.bootstrapSent = true;
    st.wakeConfig = { mode: 'diving', triggers: { atMention: true } };
    await h.handleIncoming('group', '456', groupMsg({ text: '@小鲸鱼 白胡子和赤犬哪个强', atSelf: true, backfill: true }), h.cfg);
    assert.equal(st.unread.length, 1, '@ 必须进未读');
    assert.equal(st.unread[0].atSelf, true);
    assert.equal(st.unread[0].stale, true, '@ 也是旧账，要求引用');
    assert.ok(st.pendingWakeTimer, '旧 @ 也要唤醒');
  } finally { await h.close(); }
});

test('补拉的关键词消息：算目标性触发，照样唤醒', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    st.bootstrapSent = true;
    st.wakeConfig = { mode: 'diving', triggers: { keywords: ['大肥鱼'] } };
    await h.handleIncoming('group', '456', groupMsg({ text: '大肥鱼给放出来了', backfill: true }), h.cfg);
    assert.equal(st.unread.length, 1);
    assert.ok(st.pendingWakeTimer);
  } finally { await h.close(); }
});

test('实时消息不受影响：闲聊也进未读（由触发条件决定唤不唤醒）', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    st.bootstrapSent = true;
    st.wakeConfig = { mode: 'diving', triggers: { atMention: true } };
    await h.handleIncoming('group', '456', groupMsg({ text: '实时闲聊' }), h.cfg);
    assert.equal(st.unread.length, 1, '实时消息照旧入未读');
    assert.equal(st.unread[0].stale, undefined, '实时消息不该是 stale');
  } finally { await h.close(); }
});

test('快照：未读 15 条时，末尾的 @ 也必须被内联', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    for (let i = 0; i < 14; i += 1) {
      h.appendSocialV2Message('group:456', `群友${i}`, `闲聊 ${i}`, `闲聊 ${i}`, false, false, 5000 + i, [], 20000 + i, [], false, Date.now() - 60_000);
    }
    h.appendSocialV2Message('group:456', '群友A', '@小鲸鱼 白胡子和赤犬哪个强', '@小鲸鱼 白胡子和赤犬哪个强', false, false, 6000, [], 20001, [], true, Date.now() - 30_000);
    assert.equal(st.unread.length, 15);
    const snap = h.buildWakeSnapshotV2('group:456');
    const seqs = (snap.messages || []).map((m) => m.seq);
    assert.equal(seqs.includes(15), true, `第 15 条（@）必须在内联里，实际 seq=${JSON.stringify(seqs)}`);
    assert.equal(snap.partial, true, '只内联了一部分，必须标记 partial');
  } finally { await h.close(); }
});

test('提示词：唤醒原因是补拉的旧消息时，必须提示「回它要引用」', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    st.bootstrapSent = true;
    st.wakeConfig = { mode: 'diving', triggers: { atMention: true } };
    await h.handleIncoming('group', '456', groupMsg({ text: '@小鲸鱼 白胡子和赤犬哪个强', atSelf: true, backfill: true, agoSec: 18 * 3600 }), h.cfg);
    const seq = st.lastUnreadSeq;
    const target = st.unread.find((m) => m.seq === seq);
    const prompt = h.buildWakePromptV2('group:456', `atMention@seq${seq}`, { triggeredMsg: target });
    assert.match(prompt, /【补拉】/, '要有一段【补拉】提示');
    assert.match(prompt, /必须用 qq_reply/, '要明确要求引用');
    assert.match(prompt, /18 小时|小时/, '要让她知道这条很旧');
  } finally { await h.close(); }
});
