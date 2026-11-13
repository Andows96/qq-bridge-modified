import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminStatusText, formatUptimeCn, matchStatusCommand } from './admin-status-command.mjs';

test('status command matches exactly #sl, ignoring case, spaces, full-width hash', () => {
  for (const text of ['#sl', ' #SL ', '#Sl', '＃sl', '#sl\n']) {
    assert.equal(matchStatusCommand(text), true, JSON.stringify(text));
  }
});

test('status command rejects arguments, variants, and non-strings', () => {
  for (const text of ['#sl 你好', '#sl状态', '/sl', '/sl@bot', '#s', '#sla', '', '   ', 'sl', null, undefined, 42, ['#sl']]) {
    assert.equal(matchStatusCommand(text), false, JSON.stringify(text));
  }
});

test('uptime text keeps at most two units and clamps negatives', () => {
  assert.equal(formatUptimeCn(0), '0 秒');
  assert.equal(formatUptimeCn(59_000), '59 秒');
  assert.equal(formatUptimeCn(60_000), '1 分');
  assert.equal(formatUptimeCn(3_600_000), '1 小时');
  assert.equal(formatUptimeCn(3_840_000), '1 小时 4 分');
  assert.equal(formatUptimeCn(86_400_000), '1 天');
  assert.equal(formatUptimeCn(90_000_000), '1 天 1 小时');
  assert.equal(formatUptimeCn(-5_000), '0 秒');
  assert.equal(formatUptimeCn(Number.NaN), '0 秒');
});

test('admin status text renders three readable lines', () => {
  const text = buildAdminStatusText({
    version: '1.14.22',
    linkText: '连接正常',
    accountId: '1000000001',
    accountName: '小鲸鱼',
    bridgeMode: 'reserved2',
    dshReady: true,
    sessionId: '1c76b1a5-3d0f-4c8e-9f21-8a7b6c5d4e3f',
    uptimeMs: 3_840_000,
    lastPacketAgoMs: 4_400,
  });
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'SnowLuma 1.14.22 · 连接正常 · 账号 小鲸鱼（1000000001）');
  assert.equal(lines[1], '桥接 reserved2 · DSH 就绪 · 会话 1c76b1a5');
  assert.equal(lines[2], '已运行 1 小时 4 分 · 最近事件 4 秒前');
});

test('session id is shortened and the session- prefix stripped', () => {
  const withPrefix = buildAdminStatusText({ sessionId: 'session-f5b8837e-5c17-4389-b4c1-bde18f1953c9' });
  assert.equal(withPrefix.split('\n')[1].includes('会话 f5b8837e'), true, withPrefix);
  const bare = buildAdminStatusText({ sessionId: '1c76b1a5-3d0f-4c8e' });
  assert.equal(bare.split('\n')[1].includes('会话 1c76b1a5'), true, bare);
  assert.equal(buildAdminStatusText({ sessionId: 'session-' }).includes('会话'), false);
});

test('admin status text omits unknown pieces instead of leaving dangling dots', () => {
  const text = buildAdminStatusText({});
  const lines = text.split('\n');
  assert.deepEqual(lines, ['SnowLuma', '桥接 未知模式', '已运行 0 秒']);
  for (const line of lines) {
    assert.equal(/·\s*·/.test(line), false, line);
    assert.equal(/·\s*$/.test(line), false, line);
  }
  const noDsh = buildAdminStatusText({ dshReady: null, sessionId: '' });
  assert.equal(noDsh.includes('DSH'), false);
  assert.equal(noDsh.includes('会话'), false);
  const offline = buildAdminStatusText({ linkText: '', accountId: '1000000001', accountName: '' });
  assert.equal(offline.split('\n')[0], 'SnowLuma · 账号 1000000001');
});
