// 陈年未读下沉（2026-11-12）
//
// 背景：`group:123456789` 积了 11-01 晚上的 7 条未读，10 天过去每轮唤醒还在把它们
// 塞进提示词 —— 白烧上下文，还会把 AI 引去接一个早就冷掉的话题。
// 根因是桥接停机 / 白名单变动 / 补拉失败都会让旧消息一直压在 unread 里，
// 而 unread 只有一个「容量 30 条」的淘汰规则，没有时间维度。
//
// 现在：超过 48 小时的未读从 unread 摘掉（它们本来就已经在 recentMessages 里当上文），
// lastUnreadSeq 不动（单调计数器，退回去会让 mark_read 水位错位）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const DAY = 24 * 3600 * 1000;

function makeHarness() {
  return bridgeHarness({ config: { allow: { private: ['123'], groups: ['456'] } } });
}

/** 造一条未读，然后把它的事件时间改成指定毫秒前（绕开 normalizeEventTimeMs 可能的钳制）。 */
function seedUnread(h, key, { messageId, text, ageMs }) {
  h.appendSocialV2Message(key, '张三', text, text, false, false, messageId, [], 10001, [], false, 0);
  const st = h.getSocialV2State(key);
  st.unread.at(-1).time = Date.now() - ageMs;
  return st;
}

test('超过 48 小时的未读在下一条消息进来时被沉到上文', async () => {
  const h = await makeHarness();
  try {
    const st = seedUnread(h, 'group:456', { messageId: 910001, text: '十天前的老话', ageMs: 10 * DAY });
    assert.equal(st.unread.length, 1, '前提：未读里先有一条');

    // 新消息进来 → appendSocialV2Message 末尾会调用 demoteStaleUnread
    h.appendSocialV2Message('group:456', '李四', '新消息', '新消息', false, false, 910002, [], 10002, [], false, 0);

    assert.equal(st.unread.length, 1, '老未读应被摘掉，只剩新的那条');
    assert.equal(st.unread[0].messageId, '910002');
    assert.equal(st.recentMessages.length, 2, '老消息必须仍在上文里（不是删掉，是沉下去）');
    assert.ok(
      st.recentMessages.some((m) => m.messageId === '910001'),
      '老消息要留在 recentMessages'
    );
    assert.equal(st.lastUnreadSeq, 2, 'lastUnreadSeq 是单调计数器，不能因为下沉而回退');
  } finally { await h.close(); }
});

test('47 小时内的未读保留，49 小时的沉掉（边界两侧各测一次）', async () => {
  const h = await makeHarness();
  try {
    const st = seedUnread(h, 'group:456', { messageId: 920001, text: '刚过两天线', ageMs: 47 * 3600 * 1000 });
    h.appendSocialV2Message('group:456', '李四', 'A', 'A', false, false, 920002, [], 10002, [], false, 0);
    assert.equal(st.unread.length, 2, '47 小时的还该留在未读里');

    st.unread[0].time = Date.now() - 49 * 3600 * 1000;
    h.appendSocialV2Message('group:456', '李四', 'B', 'B', false, false, 920003, [], 10003, [], false, 0);
    assert.equal(st.unread.length, 2, '49 小时那条被沉掉，剩 920002/920003 两条');
    // 不用 deepEqual：harness 用 vm 加载 bridge，跨 realm 的数组原型不同，深比较会误报
    assert.equal(Array.from(st.unread).map((m) => String(m.messageId)).join(','), '920002,920003');
  } finally { await h.close(); }
});

test('time 缺失（0）的未读一律保留，不凭"时间不明"丢消息', async () => {
  const h = await makeHarness();
  try {
    const st = seedUnread(h, 'group:456', { messageId: 930001, text: '没有时间戳', ageMs: 0 });
    st.unread.at(-1).time = 0;
    h.appendSocialV2Message('group:456', '李四', 'X', 'X', false, false, 930002, [], 10002, [], false, 0);
    assert.equal(st.unread.length, 2, 'time=0 的那条必须留下');
    assert.equal(Array.from(st.unread).map((m) => String(m.messageId)).join(','), '930001,930002');
  } finally { await h.close(); }
});

test('补拉来的旧账本来就不占未读，不受这条规则影响', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    h.appendSocialV2Message(
      'group:456', '张三', '补拉的旧账', '补拉的旧账',
      false, false, 940001, [], 10001, [], false, Date.now() - 10 * DAY,
      { toUnread: false, stale: true }
    );
    assert.equal(st.unread.length, 0, 'toUnread:false 的补拉消息不进未读');
    assert.equal(st.recentMessages.length, 1);
  } finally { await h.close(); }
});
