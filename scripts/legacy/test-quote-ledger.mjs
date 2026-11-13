// 引用账本回归（2026-10-31）：
// seq 是桥接本地的计数器，消息滑出 recentLimit（默认 100）之后，模型手里只剩 seq，
// 没有账本就永远解析不出 messageId，qq_reply 会失败。这里验证：
//   1. 超出 recent 窗口的旧 seq 仍能通过账本还原 messageId；
//   2. 账本为空时如实返回 null（调用方会给出「去掉引用再发」的提示）；
//   3. 账本上限 500，超出时淘汰最旧的；
//   4. 账本随 state 保存/加载（saveSocialV2State/loadSocialV2State 的白名单不能漏字段）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

async function makeHarness() {
  const h = await bridgeHarness();
  h.setMode('reserved2');
  h.setReady(true);
  h.setSelfIdentity('小鲸鱼', '1000000001');
  h.ensureSession('group:456');
  return h;
}

test('滑出 recent 窗口的旧 seq：账本仍能还原 messageId', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    for (let i = 1; i <= 120; i += 1) {
      h.appendSocialV2Message('group:456', `群友${i}`, `第 ${i} 条`, `第 ${i} 条`, false, false, 500000 + i, [], 90000 + i, [], false, Date.now() - (120 - i) * 60_000);
    }
    assert.equal(st.recentMessages.length, 100, 'recentLimit 默认 100');
    assert.equal(st.recentMessages[0].seq, 21, '前 20 条已被挤出');
    assert.equal(String(st.replyIds['5']), '500005', '账本里应保留第 5 条的 messageId');

    const resolved = await h.resolveReplyTargetV2(st, 'group', '456', '5');
    assert.ok(resolved, '旧 seq 必须能解析');
    assert.equal(resolved.messageId, '500005', '应还原成真实 messageId');
  } finally { await h.close(); }
});

test('账本也查不到时返回 null（调用方提示去掉引用重发）', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    st.replyIds = {};
    st.recentMessages = [];
    st.unread = [];
    const resolved = await h.resolveReplyTargetV2(st, 'group', '456', '9999');
    assert.equal(resolved, null);
    const logs = h.getLogs().join('\n');
    assert.match(logs, /无法解析引用目标 9999/, '要留一行诊断日志');
  } finally { await h.close(); }
});

test('账本上限 300：只留最新的 300 条', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    for (let i = 1; i <= 420; i += 1) {
      h.appendSocialV2Message('group:456', '群友', `m${i}`, `m${i}`, false, false, 700000 + i, [], 80000 + i, [], false, Date.now() - (420 - i) * 1000);
    }
    const keys = Object.keys(st.replyIds);
    assert.equal(keys.length, 300, `应为 300 条，实际 ${keys.length}`);
    assert.equal(keys.includes('1'), false, '最早的应被淘汰');
    assert.equal(keys.includes('420'), true, '最新的必须保留');
  } finally { await h.close(); }
});

test('账本落盘/加载：白名单不能把 replyIds 丢掉', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    h.appendSocialV2Message('group:456', '群友', '要记的一条', '要记的一条', false, false, 123456789, [], 555, [], false, Date.now());
    const seq = st.lastUnreadSeq;
    // saveSocialV2State 在 append 之后会写盘（harness 的临时目录）
    const file = path.join(h.temp, 'state', 'social-v2.json');
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    const conv = disk.conversations?.['group:456'];
    assert.ok(conv, '会话应已落盘');
    assert.equal(String(conv.replyIds?.[String(seq)]), '123456789', 'replyIds 必须写进 state');
  } finally { await h.close(); }
});

test('账本加载：旧 state 里的 replyIds 要能读回来（并过滤非法键）', async () => {
  const h = await bridgeHarness({
    files: {
      'state/social-v2.json': {
        conversations: {
          'group:456': {
            lastUnreadSeq: 10,
            replyIds: { 7: '777', 8: 'abc', evil: '999', __proto__x: '1' }
          }
        }
      }
    }
  });
  h.setMode('reserved2');
  try {
    const st = h.getSocialV2State('group:456');
    assert.equal(String(st.replyIds['7']), '777', '合法条目必须读回');
    assert.equal(st.replyIds['8'], undefined, '非数字 messageId 要被过滤');
    assert.equal(st.replyIds['evil'], undefined, '非数字键要被过滤');
  } finally { await h.close(); }
});

test('升级兼容：老 state 没有 replyIds 时，用最近消息/未读自动补齐', async () => {
  const h = await bridgeHarness({
    files: {
      'state/social-v2.json': {
        conversations: {
          'group:456': {
            lastUnreadSeq: 42,
            recentMessages: [{ seq: 41, messageId: '900041', sender: '甲', text: 'x' }],
            unread: [{ seq: 42, messageId: '900042', sender: '乙', text: 'y' }]
          }
        }
      }
    }
  });
  h.setMode('reserved2');
  try {
    const st = h.getSocialV2State('group:456');
    assert.equal(String(st.replyIds['41']), '900041', '最近消息应补进账本');
    assert.equal(String(st.replyIds['42']), '900042', '未读也应补进账本');
  } finally { await h.close(); }
});
