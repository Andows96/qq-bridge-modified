// 「还没回的 @」账本（2026-11-01）：
// 用户报「连续四个 @ 都不回复」——日志证明那些 @ 都送达过、被读进上下文，
// 只是她把一轮跑完就 mark_read 了，@ 一起被"处理"掉。这里补的是一条**可见的欠账**：
// 每轮提示词里列出还没回的 @，直到她真的用引用回了它。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const SELF = '1000000001';
const nowSec = () => Math.floor(Date.now() / 1000);

function atMsg({ text = '@小鲸鱼 在吗', agoSec = 5, group = 456 } = {}) {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: group,
    self_id: Number(SELF),
    user_id: 20002,
    message_id: 70000 + Math.floor(Math.random() * 1000),
    time: nowSec() - agoSec,
    message: [{ type: 'at', data: { qq: SELF } }, { type: 'text', data: { text } }],
    raw_message: `[CQ:at,qq=${SELF}] ${text}`,
    sender: { nickname: '群友A', card: '群友A' }
  };
}

async function makeHarness() {
  const h = await bridgeHarness({
    config: { socialV2: { wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 30 } } }
  });
  h.setMode('reserved2');
  h.setReady(true);
  h.setSelfIdentity('小鲸鱼', SELF);
  h.ensureSession('group:456');
  const st = h.getSocialV2State('group:456');
  st.bootstrapSent = true;
  st.wakeConfig = { mode: 'diving', triggers: { atMention: true } };
  return h;
}

test('@ 到达后记进「还没回的 @」，并被写进提示词', async () => {
  const h = await makeHarness();
  try {
    await h.handleIncoming('group', '456', atMsg(), h.cfg);
    const st = h.getSocialV2State('group:456');
    assert.equal(st.pendingReplies.length, 1, '应当记一条欠账');
    const prompt = h.buildWakePromptV2('group:456', 'atMention');
    assert.match(prompt, /【还没回的 @】/);
    assert.match(prompt, /群友A/);
    assert.match(prompt, /必须回|每条都要回/, '要明确要求回');
  } finally { await h.close(); }
});

test('用引用回了它之后销账，提示词里不再出现', async () => {
  const h = await makeHarness();
  try {
    await h.handleIncoming('group', '456', atMsg(), h.cfg);
    const st = h.getSocialV2State('group:456');
    const seq = st.pendingReplies[0].seq;
    h.clearPendingReplyV2(st, String(seq));
    assert.equal(st.pendingReplies.length, 0, '引用后应当销账');
    assert.doesNotMatch(h.buildWakePromptV2('group:456', 'atMention'), /【还没回的 @】/);
  } finally { await h.close(); }
});

test('按 messageId 销账也生效', async () => {
  const h = await makeHarness();
  try {
    await h.handleIncoming('group', '456', atMsg(), h.cfg);
    const st = h.getSocialV2State('group:456');
    const mid = st.unread[st.unread.length - 1].messageId;
    h.clearPendingReplyV2(st, String(mid));
    assert.equal(st.pendingReplies.length, 0);
  } finally { await h.close(); }
});

test('普通消息不算欠账；超过 12 小时的自动过期', async () => {
  const h = await makeHarness();
  try {
    const plain = {
      ...atMsg({ text: '随便聊聊' }),
      message: [{ type: 'text', data: { text: '随便聊聊' } }],
      raw_message: '随便聊聊'
    };
    await h.handleIncoming('group', '456', plain, h.cfg);
    const st = h.getSocialV2State('group:456');
    assert.equal(st.pendingReplies.length, 0, '普通消息不该记欠账');

    await h.handleIncoming('group', '456', atMsg({ agoSec: 13 * 3600 }), h.cfg);
    assert.equal(st.pendingReplies.length, 1, '先记上（醒来时才按时间过滤）');
    assert.doesNotMatch(h.buildWakePromptV2('group:456', 'atMention'), /【还没回的 @】/, '超过 12 小时不该再催');
  } finally { await h.close(); }
});
