// 启动补拉「假完成」回归（2026-10-31）：
// 现象：SnowLuma 与桥接一起关掉一段时间，再打开时日志只有
//   「启动补拉完成，没有离线消息需要补」
// 原因：补拉在 SnowLuma 尚未登录完成时跑，历史接口要么 fetch failed、要么返回空数组，
//       旧逻辑把「一条都没拿到」当成「没有离线消息」，于是不会重试。
// 现在：全部失败 / 返回空 且一条没补 → 记「这次不算数」并安排重试（15s/45s/120s）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

async function makeHarness() {
  const h = await bridgeHarness({ config: { allow: { private: ['123'], groups: ['456'] } } });
  h.setMode('reserved2');
  h.setReady(true);
  h.setSelfIdentity('小鲸鱼', '1000000001');
  h.ensureSession('group:456');
  return h;
}

test('历史接口返回空：必须说「不算数」并安排重试，而不是宣称没有离线消息', async () => {
  const h = await makeHarness();
  try {
    const st = h.getSocialV2State('group:456');
    st.bootstrapSent = true;
    // 有锚点才会去补（没有 recent 时按设计跳过）
    h.appendSocialV2Message('group:456', '群友', '旧消息', '旧消息', false, false, 111111, [], 90001, [], false, Date.now() - 3600_000);
    await h.backfillOfflineMessages();
    const logs = h.getLogs().join('\n');
    assert.match(logs, /历史接口返回空（SnowLuma 可能还没登录完成），这次不算数/, '要明确说这次不算数');
    assert.match(logs, /补拉重试已安排：15 秒后重跑/, '要安排第一次重试（15 秒）');
    assert.doesNotMatch(logs, /没有离线消息需要补/, '不能再说「没有离线消息需要补」');
  } finally { await h.close(); }
});

test('重试退避：15 → 45 → 120 秒，超出表长按最后一档', async () => {
  const h = await makeHarness();
  try {
    assert.equal(h.backfillRetryDelayMs(0), 15000);
    assert.equal(h.backfillRetryDelayMs(1), 45000);
    assert.equal(h.backfillRetryDelayMs(2), 120000);
    assert.equal(h.backfillRetryDelayMs(9), 120000, '超出表长不要无限加码');
  } finally { await h.close(); }
});
