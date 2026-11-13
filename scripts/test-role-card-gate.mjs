// 角色卡注入频次决策的单测（纯函数，不需要 DSH / QQ / 网络）。
// 跑法：node scripts/test-role-card-gate.mjs
import assert from 'node:assert/strict';
import { decideRoleCardInjection, roleCardStubText, ROLE_CARD_MODES } from '../src/role-card-gate.js';

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

check('新会话（上次没有记录）→ 带完整卡，并记下本会话', () => {
  const d = decideRoleCardInjection({ mode: 'first', sessionId: 's1', lastSessionId: '', wakes: 0 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'new-session');
  assert.equal(d.nextWakes, 1);
  assert.equal(d.nextSessionId, 's1');
});

check('同会话第二次 → 不带完整卡，计数 +1', () => {
  const d = decideRoleCardInjection({ mode: 'first', sessionId: 's1', lastSessionId: 's1', wakes: 1 });
  assert.equal(d.full, false);
  assert.equal(d.reason, 'same-session');
  assert.equal(d.nextWakes, 2);
  assert.equal(d.nextSessionId, 's1');
});

check('会话换了（reset / 退役重建）→ 重新带完整卡，计数归 1', () => {
  const d = decideRoleCardInjection({ mode: 'first', sessionId: 's2', lastSessionId: 's1', wakes: 37 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'new-session');
  assert.equal(d.nextWakes, 1);
  assert.equal(d.nextSessionId, 's2');
});

check('mode=always → 每次都带（老行为）', () => {
  const d = decideRoleCardInjection({ mode: 'always', sessionId: 's1', lastSessionId: 's1', wakes: 99 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'mode=always');
});

check('mode=digest 也是同会话只带一次（区别只在替代文案）', () => {
  const d = decideRoleCardInjection({ mode: 'digest', sessionId: 's1', lastSessionId: 's1', wakes: 3 });
  assert.equal(d.full, false);
});

console.log('\n== 边界与异常 ==');

check('拿不到会话 id（会话还没建好）→ 保守带完整卡，且不动计数', () => {
  const d = decideRoleCardInjection({ mode: 'first', sessionId: '', lastSessionId: 's1', wakes: 4 });
  assert.equal(d.full, true);
  assert.equal(d.reason, 'no-session-id');
  assert.equal(d.nextWakes, 4);
  assert.equal(d.nextSessionId, 's1');
});

check('mode 非法/缺失 → 按 first 处理（不静默变成 always）', () => {
  for (const mode of [undefined, null, '', 'FIRST', 'nonsense', 42]) {
    const first = decideRoleCardInjection({ mode, sessionId: 's1', lastSessionId: '', wakes: 0 });
    assert.equal(first.full, true, `mode=${String(mode)} 首次应带卡`);
    const second = decideRoleCardInjection({ mode, sessionId: 's1', lastSessionId: 's1', wakes: 1 });
    assert.equal(second.full, false, `mode=${String(mode)} 同会话应省略`);
  }
});

check('wakes 传垃圾值不会算出负数/NaN', () => {
  const d = decideRoleCardInjection({ mode: 'first', sessionId: 's1', lastSessionId: 's1', wakes: 'abc' });
  assert.equal(d.full, false);
  assert.equal(d.nextWakes, 1);
});

console.log('\n== 周期性重发 fullEveryWakes ==');

check('fullEveryWakes=5：第 5 次投递重发一次，其余省略', () => {
  const seq = [];
  let wakes = 1; // 首投已经算过 1 次
  for (let i = 0; i < 8; i += 1) {
    const d = decideRoleCardInjection({ mode: 'first', sessionId: 's1', lastSessionId: 's1', wakes, fullEveryWakes: 5 });
    seq.push(d.full);
    wakes = d.nextWakes;
  }
  assert.deepEqual(seq, [false, false, false, true, false, false, false, false]);
});

check('fullEveryWakes=0 / 负数 → 永不重发', () => {
  for (const every of [0, -3, undefined]) {
    let wakes = 1;
    for (let i = 0; i < 20; i += 1) {
      const d = decideRoleCardInjection({ mode: 'first', sessionId: 's1', lastSessionId: 's1', wakes, fullEveryWakes: every });
      assert.equal(d.full, false, `every=${String(every)} 不应重发（第 ${i} 次）`);
      wakes = d.nextWakes;
    }
  }
});

console.log('\n== 替代文案 ==');

check('digest 模式且有摘要 → 用摘要', () => {
  assert.equal(roleCardStubText('digest', '我是小鲸鱼，软热黏馋'), '我是小鲸鱼，软热黏馋');
});

check('digest 模式但摘要为空 → 回落到一行提示', () => {
  assert.ok(roleCardStubText('digest', '   ').includes('上文'));
});

check('first 模式即使配了摘要也不用（避免误配）', () => {
  assert.ok(roleCardStubText('first', '我是小鲸鱼').includes('上文'));
});

console.log('\n== 端到端形态：一个会话连续 6 次唤醒 ==');

check('6 次唤醒里只有第 1 次带完整卡（节省比例可算）', () => {
  let st = { sessionId: '', wakes: 0 };
  const results = [];
  for (let i = 0; i < 6; i += 1) {
    const d = decideRoleCardInjection({
      mode: 'first',
      sessionId: 'session-abc',
      lastSessionId: st.sessionId,
      wakes: st.wakes
    });
    results.push(d.full);
    st = { sessionId: d.nextSessionId, wakes: d.nextWakes };
  }
  assert.deepEqual(results, [true, false, false, false, false, false]);
});

check('ROLE_CARD_MODES 只暴露三种模式', () => {
  assert.deepEqual(ROLE_CARD_MODES, ['first', 'digest', 'always']);
});

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exitCode = 1;
