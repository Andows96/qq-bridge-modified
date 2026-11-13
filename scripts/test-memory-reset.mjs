// 回归：会话重置（/reset、/api/session/reset、/api/socialV2/reset）只换 DSH 上下文，
// 不得清空「轻量记忆」（activeTopics / pendingThoughts / memberImpressions）。
//
// 背景（2026-10-25 真实事故）：qq_memory_append 返回 ok、saveSocialV2State 也落了盘，
// 但用户 /reset 一次后再 qq_memory_query 就是空的。根因是三处
// `socialV2.conversations.delete(key)` 把整个会话对象（含 memory 三段）一起删了。
// 记忆是跨 DSH 会话的长期数据，模型自己也说过「会记得」，丢了比丢上下文更伤。

import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const h = await bridgeHarness();
h.setMode('reserved2');
await h.ensureSession('private:123');

const st = h.getSocialV2State('private:123');
const beforeSessionId = h.state.sessions['private:123'];
assert.ok(beforeSessionId, '重置前应已有 DSH 会话映射');
st.activeTopics.push({ text: '欠我一顿披萨', lastMentionAt: Date.now(), participants: ['管理员'], pendingQuestion: '' });
st.pendingThoughts.push({ text: '想问问他什么时候请', createdAt: Date.now(), expiresAt: Date.now() + 3600_000, motivation: 'curiosity' });
st.memberImpressions['管理员'] = { traits: ['说话绕'], interactionCount: 2, lastSeenAt: Date.now() };

await h.handleIncoming('private', '123', {
  self_id: 999,
  user_id: 123,
  message_id: 9001,
  message: [{ type: 'text', data: { text: '/reset' } }],
  raw_message: '/reset',
  sender: { nickname: '管理员', card: '管理员' },
}, h.cfg);

const after = h.getSocialV2State('private:123');
assert.equal(after.activeTopics.length, 1, '/reset 后 activeTopics 应保留');
assert.equal(after.activeTopics[0].text, '欠我一顿披萨', '/reset 后话题内容应原样保留');
assert.equal(after.pendingThoughts.length, 1, '/reset 后 pendingThoughts 应保留');
assert.ok(after.memberImpressions['管理员'], '/reset 后 memberImpressions 应保留');
assert.deepEqual(after.memberImpressions['管理员'].traits, ['说话绕'], '印象内容应原样保留');

// 会话标识仍应被重置（不是把整个会话对象留着不动）
assert.equal(after.bootstrapSent, false, '/reset 后应重新走 bootstrap');
assert.equal(h.state.sessions['private:123'], undefined, '/reset 必须清掉旧的 DSH 会话映射');
console.log('PASS /reset 保留轻量记忆，且会话上下文照常重置');
