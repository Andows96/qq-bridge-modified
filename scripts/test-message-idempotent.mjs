// 消息幂等（2026-11-11，移植自上游 v0.2.1-r2）
//
// 场景：SnowLuma 重连时「补拉历史」会和「实时推送」撞车，两次补拉也可能交叠
// （后者已有 30 秒节流 lastBackfillAtMs 挡一部分，但挡不干净）。
// 同一句「在吗」被记成两个 seq 的后果不只是列表里多一行 ——
// AI 会当成两件事分别回应，而且 lastUnreadSeq 白涨一格，qq_mark_read 的水位跟着错位。
//
// 修法：appendSocialV2Message 里按 QQ messageId 去重（recentMessages + unread 两头查）。
// 没有 messageId 的事件（拍一拍、系统提示）不参与去重。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

function makeHarness() {
  return bridgeHarness({ config: { allow: { private: ['123'], groups: ['456'] } } });
}

test('同一个 messageId 第二次到达：不入上文、不涨 seq', async () => {
  const h = await makeHarness();
  try {
    h.appendSocialV2Message('group:456', '张三', '在吗', '在吗', false, false, 777001, [], 10001, [], false, 0);
    const st = h.getSocialV2State('group:456');
    const len1 = st.recentMessages.length;
    const seq1 = st.lastUnreadSeq;

    h.appendSocialV2Message('group:456', '张三', '在吗', '在吗', false, false, 777001, [], 10001, [], false, 0);

    assert.equal(st.recentMessages.length, len1, '重复消息不能再进上文');
    assert.equal(st.lastUnreadSeq, seq1, '重复消息不能涨 seq（否则 mark_read 水位会错位）');
    assert.equal(st.unread.length, 1, '未读里也只应有一条');
  } finally { await h.close(); }
});

test('不同 messageId 正常各自入账', async () => {
  const h = await makeHarness();
  try {
    h.appendSocialV2Message('group:456', '张三', '第一条', '第一条', false, false, 777101, [], 10001, [], false, 0);
    h.appendSocialV2Message('group:456', '张三', '第二条', '第二条', false, false, 777102, [], 10001, [], false, 0);
    const st = h.getSocialV2State('group:456');
    assert.equal(st.recentMessages.length, 2);
    assert.equal(st.lastUnreadSeq, 2);
  } finally { await h.close(); }
});

test('没有 messageId 的消息（拍一拍/系统提示）不参与去重，照常入账', async () => {
  const h = await makeHarness();
  try {
    h.appendSocialV2Message('group:456', '张三', '系统提示 A', '系统提示 A', false, false, null, [], 10001, [], false, 0);
    h.appendSocialV2Message('group:456', '张三', '系统提示 A', '系统提示 A', false, false, null, [], 10001, [], false, 0);
    const st = h.getSocialV2State('group:456');
    assert.equal(st.recentMessages.length, 2, '没有 messageId 就不该被当成重复');
  } finally { await h.close(); }
});
