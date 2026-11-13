// 回归：命令只对「刚发生的」消息生效。
// 背景（2026-10-26 实测）：重启补拉会把几分钟前群里的 #sl 再执行一遍——
// 17:08 管理员发的 #sl，17:30 补拉时又回了一条状态；补拉里的 /reset 更危险。
// 现规则：event.__backfill === true 或事件时间早于 5 分钟 → 只当上下文，不执行命令。

import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const h = await bridgeHarness();
h.setMode('reserved2');
const nowSec = () => Math.floor(Date.now() / 1000);
const evt = (over = {}) => ({
  self_id: 999,
  user_id: 123,
  group_id: 456,
  message_id: 8000 + Math.floor(Math.random() * 1000),
  time: nowSec(),
  message: [{ type: 'text', data: { text: '#sl' } }],
  raw_message: '#sl',
  sender: { nickname: '管理员', card: '管理员' },
  ...over
});

h.calls.sent.length = 0;
await h.handleIncoming('group', '456', evt({ __backfill: true, time: nowSec() - 1300 }), h.cfg);
assert.equal(h.calls.sent.length, 0, '补拉的历史 #sl 不应回复状态');

await h.handleIncoming('group', '456', evt({ time: nowSec() - 400 }), h.cfg);
assert.equal(h.calls.sent.length, 0, '迟到 6 分钟的 #sl 不应回复状态');

await h.handleIncoming('group', '456', evt({}), h.cfg);
assert.equal(h.calls.sent.length, 1, '实时 #sl 仍应回复状态');
assert.match(String(h.calls.sent[0].text), /SnowLuma/, '实时状态回复应含 SnowLuma');

h.state.sessions['group:456'] = 'session-keep';
await h.handleIncoming('group', '456', evt({
  __backfill: true,
  message: [{ type: 'text', data: { text: '/reset' } }],
  raw_message: '/reset'
}), h.cfg);
assert.equal(h.state.sessions['group:456'], 'session-keep', '补拉里的 /reset 不应清掉会话');

console.log('PASS 补拉/迟到消息不再重放 #sl 与 /reset，实时命令照常生效');
