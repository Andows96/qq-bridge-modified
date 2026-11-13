// 回归：对方正在打字时，发送要顺延（issue #67）。
// 规则：只有私聊有 input_status；收到 event_type=1 顺延 graceMs、3（录音）顺延 voiceGraceMs；
// 补信号会顺延，但总等待受 maxWaitMs 封顶；enabled=false 时完全不管。
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const h = await bridgeHarness();
h.setMode('reserved2');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = async (fn) => { const t = Date.now(); await fn(); return Date.now() - t; };

// 用很短的窗口跑，避免测试拖 20 秒。
h.cfg.socialV2 = h.cfg.socialV2 ?? {};
h.cfg.socialV2.peerTyping = { enabled: true, graceMs: 200, voiceGraceMs: 400, maxWaitMs: 600, pollMs: 30 };

// ① 群聊没有输入事件：不记信号、不等待
assert.equal(h.notePeerTyping('group:123', 1), 0, '群聊不应记录打字信号');
const groupWait = await ms(() => h.waitForPeerTyping('group:123'));
assert.ok(groupWait < 120, `群聊不应等待（实测 ${groupWait}ms）`);

// ② 私聊普通输入：大约顺延 graceMs
const d1 = h.notePeerTyping('private:123', 1);
assert.ok(d1 >= 150 && d1 <= 260, `私聊应顺延约 graceMs，实际 ${d1}ms`);
const w1 = await ms(() => h.waitForPeerTyping('private:123'));
assert.ok(w1 >= 150 && w1 <= 320, `应等满 graceMs，实际 ${w1}ms`);

// ③ 录音（event_type=3）顺延更久
const d3 = h.notePeerTyping('private:456', 3);
assert.ok(d3 >= 350 && d3 <= 470, `录音应顺延约 voiceGraceMs，实际 ${d3}ms`);
h.resetPeerTyping('private:456');

// ④ 窗口内补信号顺延，但总等待不超过 maxWaitMs
h.resetPeerTyping('private:789');
let last = 0;
for (let i = 0; i < 20; i += 1) { last = h.notePeerTyping('private:789', 1); await wait(50); }
assert.ok(last <= 700, `连续输入时单次顺延应被 maxWaitMs 封顶，实际 ${last}ms`);
const capped = await ms(() => h.waitForPeerTyping('private:789'));
assert.ok(capped <= 900, `总等待应被 maxWaitMs 封顶，实际 ${capped}ms`);

// ⑤ 截止后不再等待，且状态被清掉
h.resetPeerTyping('private:321');
assert.equal(h.notePeerTyping('private:321', 1) > 0, true);
await wait(260);
const afterDeadline = await ms(() => h.waitForPeerTyping('private:321'));
assert.ok(afterDeadline < 120, `窗口已过应立即发送，实际 ${afterDeadline}ms`);

// ⑥ 关掉开关后完全不参与
h.cfg.socialV2.peerTyping.enabled = false;
assert.equal(h.notePeerTyping('private:654', 1), 0, '关闭后不应记录信号');
const offWait = await ms(() => h.waitForPeerTyping('private:654'));
assert.ok(offWait < 120, `关闭后不应等待，实际 ${offWait}ms`);
h.cfg.socialV2.peerTyping.enabled = true;

// ⑦ 默认值：不配 peerTyping 时用 6000/15000/20000
delete h.cfg.socialV2.peerTyping;
const cfgDefault = h.peerTypingCfg();
assert.equal(cfgDefault.graceMs, 6000);
assert.equal(cfgDefault.voiceGraceMs, 15000);
assert.equal(cfgDefault.maxWaitMs, 20000);
assert.equal(cfgDefault.enabled, true);
h.resetPeerTyping();

console.log('PASS 对方打字时发送顺延：只私聊、录音更久、补信号顺延、总等待封顶、可关闭');
