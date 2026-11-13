// B 项：directed（@我/引用我）唤醒被剪掉或被容量挤掉时，留一行 `[missed@]`。
// 目的不是修行为，而是让「@ 到底有没有被漏」可测量：
//   - `处理=剪枝（已读水位 X）` → 她看过之后收尾时没回
//   - `处理=容量淘汰` → 还没看就被 unreadLimit 挤出，这是真丢
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const SELF = '1000000001';

function groupEvent({ atSelf = false, messageId, text = '在吗' }) {
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
      ? [{ type: 'at', data: { qq: SELF } }, { type: 'text', data: { text: ` ${text}` } }]
      : [{ type: 'text', data: { text } }],
    raw_message: atSelf ? `[CQ:at,qq=${SELF}] ${text}` : text,
  };
}

test('剪枝：reason 带 @seq 后缀（atMention@seq1129）也必须留一行 [missed@]', async () => {
  // 2026-10-31 13:07 实测：一次清理 17 条却零 [missed@]，因为当时只按 ':' 切 reason，
  // `atMention@seq1129` 整串喂给 Set.has() 永远不命中。这里锁住这个形态。
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    h.setReady(true);
    h.setSelfIdentity('小鲸鱼', SELF);
    const st = h.getSocialV2State('group:456');
    st.pendingWakeReasons = [{ reason: 'atMention@seq1129', seq: 1129 }];
    st.lastReadThroughSeq = 1147;
    st.unread = [];
    h.replayPendingWakeReasonsV2('group:456');
    const line = h.getLogs().find((l) => l.includes('[missed@]') && l.includes('seq=1129'));
    assert.ok(line, `带 @seq 后缀的 directed 原因也要记，实际：${h.getLogs().slice(-5).join(' | ')}`);
  } finally { await h.close(); }
});

test('剪枝：被已读水位越过的 @ 唤醒留一行 [missed@]', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    h.setReady(true);
    h.setSelfIdentity('小鲸鱼', SELF);
    const st = h.getSocialV2State('group:456');
    st.pendingWakeReasons = [{ reason: 'atMention', seq: 1 }];
    st.lastReadThroughSeq = 5;
    st.unread = [];
    h.replayPendingWakeReasonsV2('group:456');
    const line = h.getLogs().find((l) => l.includes('[missed@]') && l.includes('处理=剪枝'));
    assert.ok(line, `应有一条剪枝日志，实际：${h.getLogs().slice(-5).join(' | ')}`);
    assert.match(line, /原因=atMention/);
    assert.match(line, /已读水位 5/);
  } finally {
    await h.close();
  }
});

test('容量淘汰：没看过的 @ 被挤出未读队列时留一行 [missed@]', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    h.setReady(true);
    h.setSelfIdentity('小鲸鱼', SELF);
    h.cfg.socialV2.context.unreadLimit = 2;
    for (const id of [8001, 8002, 8003]) {
      await h.handleIncoming('group', '456', groupEvent({ atSelf: true, messageId: id, text: `第${id}条` }), h.cfg);
    }
    const line = h.getLogs().find((l) => l.includes('[missed@]') && l.includes('处理=容量淘汰'));
    assert.ok(line, `应有一条容量淘汰日志，实际：${h.getLogs().slice(-5).join(' | ')}`);
    assert.match(line, /seq=1/);
    assert.match(line, /@我/);
    assert.match(line, /第8001条/);
  } finally {
    await h.close();
  }
});

test('容量淘汰：没有被 @/引用的消息不记 [missed@]', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    h.setReady(true);
    h.setSelfIdentity('小鲸鱼', SELF);
    h.cfg.socialV2.context.unreadLimit = 2;
    for (const id of [8101, 8102, 8103]) {
      await h.handleIncoming('group', '456', groupEvent({ atSelf: false, messageId: id, text: `闲聊${id}` }), h.cfg);
    }
    assert.equal(h.getLogs().filter((l) => l.includes('[missed@]')).length, 0);
  } finally {
    await h.close();
  }
});
