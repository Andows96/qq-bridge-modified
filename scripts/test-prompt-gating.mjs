// 唤醒提示词「分段注入」决策的单测（纯函数，不需要 DSH / QQ / 网络）。
// 跑法：node scripts/test-prompt-gating.mjs
import assert from 'node:assert/strict';
import { decidePromptBlocks, promptBlocksStubText, PROMPT_META_BLOCKS } from '../src/prompt-gating.js';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    fail += 1;
    console.log(`❌ ${name}`);
    console.log(`   ${error?.message ?? error}`);
  }
}

console.log('== 基本决策 ==');

check('新会话首轮 → 完整注入，计数归零（之后每 N 轮一次）', () => {
  const d = decidePromptBlocks({ sessionId: 's1', lastSessionId: '', wakes: 0, everyWakes: 5 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'new-session');
  assert.equal(d.nextWakes, 0);
  assert.equal(d.nextSessionId, 's1');
});

check('同会话第 2~5 轮 → 省略，计数递增', () => {
  for (const [wakes, next] of [[0, 1], [1, 2], [2, 3], [3, 4]]) {
    const d = decidePromptBlocks({ sessionId: 's1', lastSessionId: 's1', wakes, everyWakes: 5 });
    assert.equal(d.full, false, `wakes=${wakes}`);
    assert.equal(d.nextWakes, next);
    assert.match(d.reason, /same-session/);
  }
});

check('第 6 轮 → 再次完整注入，计数归零', () => {
  const d = decidePromptBlocks({ sessionId: 's1', lastSessionId: 's1', wakes: 4, everyWakes: 5 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'periodic(5/5)');
  assert.equal(d.nextWakes, 0);
});

check('每 5 轮的真实序列：1 全、2~5 省、6 全、7~10 省、11 全', () => {
  let wakes = 0;
  let lastSessionId = '';
  const full = [];
  for (let i = 1; i <= 11; i += 1) {
    const d = decidePromptBlocks({ sessionId: 's1', lastSessionId, wakes, everyWakes: 5 });
    if (d.full) full.push(i);
    wakes = d.nextWakes;
    lastSessionId = d.nextSessionId;
  }
  assert.deepEqual(full, [1, 6, 11]);
});

check('会话换了（reset/退役重建）→ 重新完整注入，计数归零', () => {
  const d = decidePromptBlocks({ sessionId: 's2', lastSessionId: 's1', wakes: 37, everyWakes: 5 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'new-session');
  assert.equal(d.nextWakes, 0);
});

check('everyWakes=3 时第 4 轮必完整（可调周期）', () => {
  const d = decidePromptBlocks({ sessionId: 's1', lastSessionId: 's1', wakes: 2, everyWakes: 3 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'periodic(3/3)');
});

check('周期为 0 / 未配置 → 每轮完整，且不动计数', () => {
  for (const everyWakes of [0, undefined]) {
    const d = decidePromptBlocks({ sessionId: 's1', lastSessionId: 's1', wakes: 3, everyWakes });
    assert.equal(d.full, true);
    assert.equal(d.nextWakes, 3);
  }
});

check('enabled=false → 每轮完整（回到老行为）', () => {
  const d = decidePromptBlocks({ sessionId: 's1', lastSessionId: 's1', wakes: 4, everyWakes: 5, enabled: false });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'gating-off');
  assert.equal(d.nextWakes, 4);
});

check('拿不到会话 id → 保守完整注入，不记账', () => {
  const d = decidePromptBlocks({ sessionId: '', lastSessionId: 's1', wakes: 4, everyWakes: 5 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'no-session-id');
  assert.equal(d.nextWakes, 4);
  assert.equal(d.nextSessionId, 's1');
});

check('非法输入不抛异常', () => {
  assert.equal(decidePromptBlocks().full, true);
  assert.equal(decidePromptBlocks({ sessionId: null, wakes: 'x', everyWakes: 'y' }).full, true);
  assert.equal(decidePromptBlocks({ sessionId: 's1', lastSessionId: 's1', wakes: -9, everyWakes: 5 }).full, false);
});

console.log('\n== 占位文案 ==');

check('占位行列出全部分段名，且以「沿用即可」收尾', () => {
  const text = promptBlocksStubText();
  assert.match(text, /^【你的身份·反AI味·积极性·表情包策略·沉睡前强制等待·行动前】/);
  assert.match(text, /已在本会话上文完整给出，沿用即可。$/);
  for (const name of PROMPT_META_BLOCKS) assert.equal(text.includes(name), true, name);
  // 引用规则已提到每轮常驻区，不该再出现在占位名单里（否则「已在上文给出」与每轮都在自相矛盾）。
  assert.equal(text.includes('引用'), false, '占位行不该再列【引用】');
  // 【可用表情包】同理：清单是素材，2026-10-30 起每轮都发，不能算进「已在上文给出」。
  assert.equal(text.includes('可用表情包'), false, '占位行不该再列【可用表情包】');
  assert.equal(text.length < 120, true, `占位行应当很短，实际 ${text.length}`);
});

check('可自定义显示哪几段', () => {
  const text = promptBlocksStubText(['反AI味', '行动前']);
  assert.equal(text, '【反AI味·行动前】已在本会话上文完整给出，沿用即可。');
  assert.equal(promptBlocksStubText([]), '已在本会话上文完整给出，沿用即可。');
});

console.log(`\n${fail === 0 ? '全部通过' : '有失败用例'}：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
