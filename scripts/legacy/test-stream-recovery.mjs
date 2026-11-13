#!/usr/bin/env node
/**
 * 回归测试：DSH 换端口后的事件流自愈。
 *
 * 背景（2026-10-30 12:25 事故）：DSH 桌面版换端口（8708 → 9161）时桥接会
 * `api = createDshApi(probed)` 重建客户端。新客户端的 `_desiredFollows` 是空的，
 * 不同步重放订阅就再也收不到 `turn/end`：
 *   - `pendingWakeKeys` 永远不清 → QQ 侧表现为「会话繁忙，暂存唤醒原因」
 *   - 后续消息全堆在 pendingWakeReasons，直到**唤醒租约到期**才补发
 * 本次修复：地址变更后调用 `refollowKnownSessions()`；事件流静默看门狗（5 分钟无帧
 * 且有在途回合就主动 abort 重连）；兜底租约 10 分钟 → 3 分钟。
 */
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
let tests = 0;
function check(name, fn) {
  tests += 1;
  try {
    fn();
    console.log(`ok ${tests} - ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`not ok ${tests} - ${name}`);
    console.log(`  ${error?.message ?? error}`);
  }
}

const baseConfig = (extra = {}) => ({
  socialV2: {
    enabled: true,
    mode: 'reserved2',
    tools: { enabled: true, memory: true, send: true },
    wake: { enabled: true, batchWindowMs: 0, maxWakePerMinute: 0, maxWakePerHour: 0 },
    ...extra,
  },
});

const h1 = await bridgeHarness({ config: baseConfig() });
check('WAKE_BUSY_LEASE_MS 是 3 分钟（原来 10 分钟太长）', () => {
  assert.equal(h1.WAKE_BUSY_LEASE_MS, 3 * 60 * 1000);
});
check('TURN_BUSY_LEASE_MS 仍是 15 分钟（长工具调用不能误杀）', () => {
  assert.equal(h1.TURN_BUSY_LEASE_MS, 15 * 60 * 1000);
});

const h2 = await bridgeHarness({
  config: baseConfig(),
  files: {
    'state/sessions.json': {
      sessions: {
        'private:987654321': 'session-aaaa1111-0000-0000-0000-000000000000',
        'group:123456789': 'session-bbbb2222-0000-0000-0000-000000000000',
      },
    },
  },
});
check('refollowKnownSessions 把已持久化的会话全部重新订阅', () => {
  h2.calls.follows.length = 0;
  const n = h2.refollowKnownSessions('测试重建客户端');
  assert.equal(n, 2);
  assert.deepEqual(
    [...h2.calls.follows].sort(),
    ['session-aaaa1111-0000-0000-0000-000000000000', 'session-bbbb2222-0000-0000-0000-000000000000'],
  );
});

check('refollowKnownSessions 在没有映射时安全返回 0', () => {
  h1.calls.follows.length = 0;
  const n = h1.refollowKnownSessions('');
  assert.equal(n, 0);
  assert.equal(h1.calls.follows.length, 0);
});

check('没有在途回合时 isConversationBusyV2 为 false（基线，避免负优化误判忙）', () => {
  assert.equal(h1.isConversationBusyV2('private:987654321'), false);
});

console.log(`\n${tests - failures}/${tests} 通过`);
process.exitCode = failures ? 1 : 0;
