// 统一注入周期：角色卡与规则块共用同一个计数、同进同出。
//
// 背景：原先两者各有一套计数器 —— 规则块走 prompt-gating.js（promptBlocksWakes），
// 角色卡走 role-card-gate.js（roleCardWakes），周期还可能不同（5 / 10）。
// r2 引入 `socialV2.role.injectEveryNWakes` 后，一个周期同时管两样：
// 这一轮完整注入就两样都给，其余轮次两样都退成占位行。
//
// 这里只做静态断言（源码级），因为真正的效果要靠实跑一轮唤醒才看得到；
// 静态断言防的是"以后有人又把它拆回两套计数"这种回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const src = readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');

/** 切出 `function <name>(` 到下一个顶层函数声明之间的源码。 */
function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到函数 ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n  (?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('promptGatingCfg 读取 role.injectEveryNWakes 并暴露 unifiedEveryWakes', () => {
  const body = sliceFunction(src, 'promptGatingCfg');
  assert.match(body, /role\.injectEveryNWakes/, '必须读 socialV2.role.injectEveryNWakes');
  assert.match(body, /unifiedEveryWakes/, '必须返回 unifiedEveryWakes 供调用方判断');
  // 统一周期必须同时覆盖两个周期字段，否则会出现一边跟随、一边没跟
  assert.match(body, /metaEveryWakes:\s*unified\b/, 'metaEveryWakes 要以统一周期为准');
  assert.match(body, /roleCardEveryWakes:\s*roleCardPeriod\s*\?\?\s*unified/, '没显式配 roleCardEveryWakes 时跟随统一周期');
});

test('buildWakePromptV2 先算规则块决策，再让角色卡跟随', () => {
  const body = sliceFunction(src, 'buildWakePromptV2');
  const iDecision = body.indexOf('promptGatingDecision(');
  const iRole = body.indexOf('roleForWake(');
  assert.ok(iDecision >= 0, '必须调用 promptGatingDecision');
  assert.ok(iRole >= 0, '必须调用 roleForWake');
  assert.ok(
    iDecision < iRole,
    'promptGatingDecision 必须在 roleForWake 之前（否则角色卡跟随的是旧的计数）'
  );
  assert.match(
    body,
    /roleForWake\([^)]*fullOverride:\s*metaFull/,
    '配了统一周期时要把 metaFull 透传给角色卡'
  );
});

test('roleForWake 接受 fullOverride，并按「角色@会话」签名决定要不要重发全文', () => {
  const body = sliceFunction(src, 'roleForWake');
  assert.match(body, /fullOverride !== undefined/, '必须识别 fullOverride（统一周期由规则块决定）');
  // 计数落在独立 store 里：social-v2.json 只持久化白名单字段，塞进去会被静默丢弃（rc1 自己踩过）。
  assert.match(body, /roleInjectStore\(\)/, '计数必须走 roleInjectStore，不能塞进 social-v2 的状态字段');
  // 签名里带 roleCardSignature()（换卡）与 state.sessions[key]（换 DSH 会话）：
  // 两者任一变化都必须立刻重发全文，否则新会话的人格等于没注入。
  assert.match(body, /roleCardSignature\(\)/, '签名必须包含角色卡签名，换卡要重发');
  assert.match(body, /state\.sessions\[key\]/, '签名必须包含 DSH 会话 id，换会话要重发');
  assert.match(body, /allowStub/, '必须支持 allowStub（引导轮/预构建不该被占位行顶掉）');
});

test('config.json 里配了统一的注入周期', () => {
  const cfg = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  const n = cfg?.socialV2?.role?.injectEveryNWakes;
  assert.equal(typeof n, 'number', 'socialV2.role.injectEveryNWakes 应是数字');
  assert.ok(n >= 1 && n <= 50, `周期应在 1~50 之间，实际 ${n}`);
});

// ── 行为层：真的跑 7 轮 buildWakePromptV2 ───────────────────────────────────
//
// 静态断言只能证明"代码写得对"，证明不了"跑起来确实同进同出"。
// 这里把两个周期都故意设成和统一周期不同的值：
//   promptGating.metaEveryWakes = 9、roleCard.fullEveryWakes = 10
// 如果哪一边没被统一周期压住，就会看到 9 轮 / 10 轮的节奏，一眼能看出来。
test('行为：7 轮里角色卡与规则块同进同出，且 roleCardWakes 不再上涨', async () => {
  const h = await bridgeHarness({
    config: {
      allow: { private: ['123'], groups: ['456'] },
      socialV2: {
        // dedupeMs 必须关掉：同一次唤醒里 buildWakePromptV2 会跑两次（预构建 + 真正投递），
        // 默认 8 秒去重会让 7 轮连跑全落到第一轮判定上，看起来像「每轮都完整」。
        promptGating: { enabled: true, metaEveryWakes: 9, roleCardEveryWakes: 10, dedupeMs: 0 },
        role: { injectEveryNWakes: 3 },
        roleCard: { mode: 'first', digest: '', fullEveryWakes: 10 },
        wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 300 }
      }
    }
  });
  try {
    h.setMode('reserved2');
    h.setSelfIdentity('小鲸鱼', '1000000001');
    // 角色卡必须真的有内容，否则 roleBlockForPrompt 在 `if (!roleState.role) return ''`
    // 那一行就提前返回了，压根走不到决策逻辑 —— 测试会误判成"每轮都完整"。
    writeFileSync(
      path.join(h.temp, 'state', 'current-role.json'),
      JSON.stringify({ role: '测试角色', mode: 'active' }),
      'utf8'
    );
    mkdirSync(path.join(h.temp, 'roles'), { recursive: true });
    writeFileSync(
      path.join(h.temp, 'roles', '测试角色.md'),
      '## 人设 〔二代〕\n你是一只测试用的小鲸鱼，说话简短。\n',
      'utf8'
    );
    await h.ensureSession('group:456'); // 没有会话 id 会走"保守全量"，测不出周期
    const st = h.getSocialV2State('group:456');
    const roleWakesBefore = st.roleCardWakes;

    const rounds = [];
    for (let i = 1; i <= 7; i += 1) {
      const text = h.buildWakePromptV2('group:456', 'admin');
      rounds.push({
        i,
        // 完整轮带「【你的身份】你在 QQ 上的昵称」；省略轮只有一行「【…】已在本会话上文完整给出，沿用即可。」
        ruleFull: text.includes('【你的身份】你在 QQ 上的昵称'),
        // 完整轮带「【角色卡 —— 以下是你的设定」；省略轮只剩一行提醒
        roleFull: text.includes('【角色卡 —— 以下是你的设定'),
      });
    }

    const ruleFullRounds = rounds.filter((r) => r.ruleFull).map((r) => r.i);
    assert.deepEqual(ruleFullRounds, [1, 4, 7], '规则块应按统一周期 3 走（不是 metaEveryWakes=9）');

    const roleFullRounds = rounds.filter((r) => r.roleFull).map((r) => r.i);
    assert.deepEqual(roleFullRounds, [1, 4, 7], '角色卡必须跟随规则块（不是 fullEveryWakes=10）');

    for (const r of rounds) {
      assert.equal(r.ruleFull, r.roleFull, `第 ${r.i} 轮：规则块与角色卡必须同进同出`);
    }

    assert.equal(
      h.getSocialV2State('group:456').roleCardWakes,
      roleWakesBefore,
      '跟随模式下不得写 roleCardWakes（写了就会留下一直在涨但永远用不到的脏计数）'
    );
  } finally { await h.close(); }
});
