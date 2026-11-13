// 取图失败后的"换新链接重试"（2026-10-29）。
// 背景：补拉的离线消息里图片/表情的 CDN 链接带时效，隔几小时就 403，
// 日志表现为 `[media] 表情获取失败（3 次尝试）`，模型只能回"看不了"。
// 现在失败后会用 get_msg 重新拉这条消息、换成新链接再试一次。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

// 连不上也不慢：safe-fetch 对内网/回环地址会直接拒绝，等价于"旧链接已过期"。
const STALE = 'http://127.0.0.1:1/expired-sticker.png';

test('取图失败后用 get_msg 换新链接重试成功', async () => {
  const h = await bridgeHarness();
  try {
    h.calls.messageFixtures['9001'] = {
      group_id: 456,
      message: [{ type: 'image', data: { file: 'fresh.image', summary: '新表情' } }],
    };
    const media = {
      kind: 'sticker',
      file: '',
      url: STALE,
      messageId: '9001',
      convKey: 'group:456',
    };
    const img = await h.fetchOneBotImage(media);
    assert.ok(img?.buffer?.length > 0, '应重试成功拿到图片');
    assert.ok(h.calls.messages.includes(9001), '应调用 get_msg 重新拉消息');
    assert.ok(h.calls.images.includes('fresh.image'), '重试应使用新拿到的 file');
  } finally {
    await h.close();
  }
});

test('归属不一致时不套用新链接（防跨会话取图）', async () => {
  const h = await bridgeHarness();
  try {
    // 网关返回的是另一个群的消息：必须拒绝，不能用它取图。
    h.calls.messageFixtures['9002'] = {
      group_id: 999,
      message: [{ type: 'image', data: { file: 'leak.image' } }],
    };
    const media = {
      kind: 'sticker',
      file: '',
      url: STALE,
      messageId: '9002',
      convKey: 'group:456',
    };
    const img = await h.fetchOneBotImage(media);
    assert.equal(img, null, '跨会话消息不应被用来取图');
    assert.ok(!h.calls.images.includes('leak.image'), '不应把别的会话的 file 交给网关');
  } finally {
    await h.close();
  }
});

test('没有 messageId 的旧数据照常失败，不额外发 get_msg', async () => {
  const h = await bridgeHarness();
  try {
    const media = { kind: 'sticker', file: '', url: STALE };
    const img = await h.fetchOneBotImage(media);
    assert.equal(img, null);
    assert.equal(h.calls.messages.length, 0);
  } finally {
    await h.close();
  }
});
