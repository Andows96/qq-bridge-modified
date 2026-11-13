#!/usr/bin/env node
/**
 * 「引用失败降级」回归（2026-10-30）。
 *
 * 背景：唤醒提示里现在每轮都会让模型在回旧消息时用 qq_reply。但 QQ 侧对**老消息**的
 * message_id 可能已经不可引用：网关会直接拒绝这条消息，整条内容就发不出去。
 * 引用只是锦上添花，消息本身必须送达 —— 所以 onebotSend 在带 reply 段失败时，
 * 必须自动去掉引用重发一次。
 */
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const KEY = 'group:123456789';
let failures = 0;
let tests = 0;
async function check(name, fn) {
  tests += 1;
  try {
    await fn();
    console.log(`ok ${tests} - ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`not ok ${tests} - ${name}`);
    console.log(`  ${error?.message ?? error}`);
  }
}

async function boot() {
  const h = await bridgeHarness({
    config: {
      socialV2: {
        enabled: true,
        mode: 'reserved2',
        tools: { enabled: true, send: true, memory: true },
        wake: { enabled: true, batchWindowMs: 0, maxWakePerMinute: 0, maxWakePerHour: 0 },
      },
    },
  });
  h.calls.http.length = 0;
  return h;
}

const texts = (call) => (call.body?.message ?? []).filter((s) => s.type === 'text').map((s) => s.data.text);

await check('带引用发送被网关拒绝 → 自动去掉引用重发，内容仍然送达', async () => {
  const h = await boot();
  h.calls.failReplySend = 1;
  await h.onebotSend('group', 123456789, '引用试试', '1234567890');
  assert.equal(h.calls.http.length, 2, `应当发送两次（先带引用、失败后不带），实际 ${h.calls.http.length}`);
  const first = h.calls.http[0];
  const second = h.calls.http[1];
  assert.ok(first.body.message.some((s) => s.type === 'reply' && s.data.id === '1234567890'), '第一次应带引用段');
  assert.equal(second.body.message.some((s) => s.type === 'reply'), false, '第二次不该再带引用段');
  assert.deepEqual(texts(second), ['引用试试'], '降级后正文必须原样送达');
});

await check('不带引用的发送失败不会被误重试（只发一次，照常抛错）', async () => {
  const h = await boot();
  h.calls.failSend = 1;
  await assert.rejects(() => h.onebotSend('group', 123456789, '普通消息', null), /OneBot send_group_msg 失败/);
  assert.equal(h.calls.http.length, 1);
});

await check('引用失败降级后仍保留 @ 段', async () => {
  const h = await boot();
  h.calls.failReplySend = 1;
  await h.onebotSend('group', 123456789, '带@的回复', '555', '987654321');
  assert.equal(h.calls.http.length, 2);
  const second = h.calls.http[1];
  assert.ok(second.body.message.some((s) => s.type === 'at' && s.data.qq === '987654321'), '降级不该丢掉 @');
  assert.equal(second.body.message.some((s) => s.type === 'reply'), false);
});

await check('网关连续拒绝引用两次 → 第二次降级仍失败时抛出，不无限重试', async () => {
  const h = await boot();
  // 第一次带引用失败（触发降级），降级那次不带引用，所以 failReplySend 只消耗一次。
  h.calls.failReplySend = 1;
  await h.onebotSend('private', 987654321, '私聊引用', '777');
  assert.equal(h.calls.http.length, 2);
  assert.equal(h.calls.http.filter((c) => (c.body.message ?? []).some((s) => s.type === 'reply')).length, 1, '只有第一次带引用');
});

console.log(`\n${tests - failures}/${tests} 通过`);
process.exitCode = failures ? 1 : 0;
