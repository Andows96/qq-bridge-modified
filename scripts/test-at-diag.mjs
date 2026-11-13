// 「任何 @ 到我的消息都记一行」诊断（2026-10-29）。
// 这里只验证接线没坏：@ 段能正确判定为 atSelf 并入库（诊断行本身走 bridge.log，
// 测试环境不捕获日志），避免为了排查把正常收消息的路径改出问题。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const SELF = '1000000001';

function groupEvent({ atSelf, messageId }) {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 456,
    user_id: 10001,
    self_id: SELF,
    message_id: messageId,
    time: Math.floor(Date.now() / 1000),
    sender: { nickname: '测试群友', card: '测试群友' },
    message: atSelf
      ? [{ type: 'at', data: { qq: SELF } }, { type: 'text', data: { text: ' 在吗' } }]
      : [{ type: 'text', data: { text: '今天吃什么' } }],
    raw_message: atSelf ? `[CQ:at,qq=${SELF}] 在吗` : '今天吃什么',
  };
}

test('@ 我的群消息：判定 atSelf 并入库', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    h.setReady(true);
    h.setSelfIdentity('小鲸鱼', SELF);
    await h.handleIncoming('group', '456', groupEvent({ atSelf: true, messageId: 7001 }), h.cfg);
    const st = h.getSocialV2State('group:456');
    const last = st.unread[st.unread.length - 1];
    assert.equal(last?.atSelf, true);
    assert.equal(last?.messageId, '7001');
  } finally {
    await h.close();
  }
});

test('没 @ 我的群消息：atSelf 保持 false', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    h.setReady(true);
    h.setSelfIdentity('小鲸鱼', SELF);
    await h.handleIncoming('group', '456', groupEvent({ atSelf: false, messageId: 7002 }), h.cfg);
    const st = h.getSocialV2State('group:456');
    const last = st.unread[st.unread.length - 1];
    assert.equal(last?.atSelf, false);
  } finally {
    await h.close();
  }
});

test('@ 消息的媒体带上了刷新用的 messageId / convKey', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    h.setReady(true);
    h.setSelfIdentity('小鲸鱼', SELF);
    const event = groupEvent({ atSelf: true, messageId: 7003 });
    event.message.push({ type: 'image', data: { file: 'abc.image', url: 'https://multimedia.invalid/x' } });
    await h.handleIncoming('group', '456', event, h.cfg);
    const st = h.getSocialV2State('group:456');
    const last = st.unread[st.unread.length - 1];
    assert.equal(last?.media?.[0]?.messageId, '7003');
    assert.equal(last?.media?.[0]?.convKey, 'group:456');
  } finally {
    await h.close();
  }
});

// 2026-10-30：补拉的旧消息原本都给盖成 Date.now()，模型看到的 ago 全是「几秒前」，
// 引用规则里「ago ≥ 2 分钟就必须引用」永远不触发，回旧消息也全是裸消息。
test('消息时间取事件时间，不是入库时刻（补拉旧消息的 ago 才对）', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    h.setReady(true);
    h.setSelfIdentity('小鲸鱼', SELF);
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const event = groupEvent({ atSelf: false, messageId: 7004 });
    event.time = twoHoursAgo;
    await h.handleIncoming('group', '456', event, h.cfg);
    const st = h.getSocialV2State('group:456');
    const last = st.unread[st.unread.length - 1];
    assert.equal(last?.time, twoHoursAgo * 1000, '入库时间必须是 QQ 的原始时间');
    const { compactModelMessage } = await import('../src/qq-model-view.js');
    // harness 里的消息对象建在 vm 的 realm 里（prototype 不是本文件的 Object.prototype），
    // 先转成本 realm 的普通对象，否则 isRecord() 为假、视图会原样返回。
    const plain = JSON.parse(JSON.stringify(last));
    const view = compactModelMessage(plain, { now: Date.now() });
    assert.match(String(view.ago), /^(2h|3h)$/, `ago 应是小时级，实际 ${view.ago}`);
  } finally {
    await h.close();
  }
});

test('模型视图：atSelf 只在为真时出现', async () => {
  const { compactModelMessage } = await import('../src/qq-model-view.js');
  const at = compactModelMessage({ seq: 1, text: '在吗', atSelf: true }, { now: Date.now() });
  assert.equal(at.atSelf, true, '@ 我的消息必须带标记，否则模型容易当闲聊扫过去');
  const notAt = compactModelMessage({ seq: 2, text: '今天吃什么', atSelf: false }, { now: Date.now() });
  assert.equal('atSelf' in notAt, false, 'false 不该占 token');
});
