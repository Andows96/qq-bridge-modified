// 唤醒提示词「分段注入」的回归：跑真实的 buildWakePromptV2，断言投递出去的那份 prompt
// 里到底有哪些段。
//
// 为什么要这条测试（只测 prompt-gating.js 不够）：
//   纯函数只证明"第几轮该完整"，证明不了 buildWakePromptV2 真的把占位行接进去了、
//   也没有把【沉睡前强制等待】的数字一起省掉（那是行为闸门，省掉就没人等观察窗口了）。
//   另外还要钉住：预构建路径（commitPromptBlocks:false）不能记账，否则真正发出去的那条
//   会变成占位 —— 这正是角色卡当年踩过的坑。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
async function test(name, run) {
  try { await run(); console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, '—', error?.stack ?? error); }
}

const ADMIN = { 'x-console-token': 'fixture-console-token' };

function call(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers: { 'content-type': 'application/json', ...headers } },
      (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch {}
          resolve({ status: response.statusCode, body: data, json });
        });
      }
    );
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('request hung')));
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function withServer(h, run) {
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  try { await run(server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function makeHarness(extra = {}) {
  const base = { promptGating: { enabled: true, metaEveryWakes: 3, dedupeMs: 0 }, wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 300, preSleepWaitMs: 90000 } };
  const h = await bridgeHarness({
    // dedupeMs:0 —— 同一次唤醒里 buildWakePromptV2 会跑两次（预构建 + 投递），默认 8 秒去重；
    // 测试要连跑多轮，必须关掉，否则第 2 轮起的判定全被第 1 轮的时间窗吃掉。
    config: {
      ...extra,
      socialV2: {
        ...base,
        ...(extra.socialV2 ?? {}),
        // 深合并：各用例只改 metaEveryWakes/enabled，不能把 dedupeMs:0 冲掉，
        // 否则连跑多轮会被 8 秒去重窗口吃掉、第 2 轮起全继承第 1 轮判定。
        wake: { ...base.wake, ...((extra.socialV2 ?? {}).wake ?? {}) },
    promptGating: { ...base.promptGating, ...((extra.socialV2 ?? {}).promptGating ?? {}) }
      }
    }
  });
  h.setMode('reserved2');
  h.setSelfIdentity('小鲸鱼', '1000000001');
  await h.ensureSession('group:456'); // 建出会话 id，否则提示词按"取不到会话"走保守全量
  return h;
}

const FULL_MARKERS = [
  '【你的身份】',
  '【反AI味】你不是客服',
  '【积极性】',
  '【表情包策略',
  '【沉睡前强制等待】这是决定潜水收尾时的步骤',
  '【行动前】先判断',
  // 引用规则每轮常驻（0.2.2-rc1 合并后文案改成「只在必要时用」，并加了「引用失败别硬发」）
  '【引用：只在必要时用】',
  '别用更短的 timeoutMs 去凑',
];
const DYNAMIC_MARKERS = ['【会话令牌】', '【首回复节奏】', '【此刻状态】', '【当前唤醒】'];
// 占位行不含「行动前」：它属于每轮都发的尾段（见 buildWakePromptV2 的 filter）
const STUB_LINE = '【你的身份·反AI味·积极性·表情包策略·沉睡前强制等待】已在本会话上文完整给出，沿用即可。';

function assertFull(text, label) {
  for (const marker of FULL_MARKERS) assert.ok(text.includes(marker), `${label} 缺少完整段 ${marker}`);
  assert.equal(text.includes('已在本会话上文完整给出'), false, `${label} 不该出现占位行`);
  // 只属于完整轮（规则段）的收尾说明：一次等满、别拿更短的等待凑观察
  assert.ok(text.includes('若期间有人发新消息'), `${label} 缺少“观察期间有人发新消息”的处理说明`);
  assert.ok(text.includes('qq_wait_for_messages(timeoutMs='), `${label} 缺少沉睡前观察的调用示例`);
}

function assertStub(text, label, h) {
  // 闸门数字跟着 harness 的 config 走（默认值 2026-10-26 从 180000 改成 90000），不再写死。
  const preSleepMs = Math.max(0, Number(h?.cfg?.socialV2?.wake?.preSleepWaitMs) || 90000);
  assert.ok(text.includes(STUB_LINE), `${label} 缺少占位行`);
  assert.equal(text.includes('【反AI味】你不是客服'), false, `${label} 不该再带完整【反AI味】`);
  // 沉睡前闸门是「行为闸门」，每轮必带（占位行里也列了它的名字），不能省。
  assert.ok(text.includes('【沉睡前强制等待】这是决定潜水收尾时的步骤'), `${label} 必须保留沉睡前闸门（不可省略）`);
  // 【行动前】属于按 reason 拼的尾段，每轮都给（占位行特意不含它，见 buildWakePromptV2）
  assert.ok(text.includes('【行动前】先判断'), `${label} 必须保留每轮的【行动前】判断段`);
  // 引用规则已提到每轮常驻区：省略轮也必须带，否则回旧消息又会不引用。
  assert.ok(text.includes('【引用：只在必要时用】'), `${label} 省略轮也必须带引用规则`);
  // 每轮必带的动态段一段都不能少
  for (const marker of DYNAMIC_MARKERS) assert.ok(text.includes(marker), `${label} 缺少动态段 ${marker}`);
  // 闸门数字必须每轮都在
  assert.ok(text.includes(`qq_wait_for_messages(timeoutMs=${preSleepMs})`), `${label} 必须保留沉睡前观察的 timeoutMs`);
  // 观察窗口的数字每轮都要说清楚（preSleepWaitMs 跟着 config 走）
  assert.ok(text.includes(`qq_wait_for_messages(timeoutMs=${preSleepMs})`), `${label} 缺少观察窗口的 timeoutMs`);
}

// ── 1. 每 3 轮：全 / 占位 / 全 / 占位 / 占位 / 全 ────────────────────────────
await test('每 3 轮完整注入，动态段每轮都在', async () => {
  const h = await makeHarness();
  try {
    const texts = [];
    for (let i = 0; i < 6; i += 1) texts.push(h.buildWakePromptV2('group:456', 'admin'));
    [0, 3].forEach((i) => assertFull(texts[i], `第 ${i + 1} 轮`));
    [1, 2, 4, 5].forEach((i) => assertStub(texts[i], `第 ${i + 1} 轮`, h));
  } finally { await h.close(); }
});

// ── 2. 周期可调：每 2 轮 ──────────────────────────────────────────────────────
await test('改成每 2 轮后滚动序列变成 全/占位/全/占位', async () => {
  const h = await makeHarness({ socialV2: { promptGating: { enabled: true, metaEveryWakes: 2 }, wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 300 } } });
  try {
    const texts = [0, 1, 2, 3].map(() => h.buildWakePromptV2('group:456', 'admin'));
    assertFull(texts[0], '第 1 轮');
    assertStub(texts[1], '第 2 轮', h);
    assertFull(texts[2], '第 3 轮');
    assertStub(texts[3], '第 4 轮', h);
  } finally { await h.close(); }
});

// ── 3. 关掉分段 = 老行为（每轮完整），一键回退 ───────────────────────────────
await test('enabled=false 时每轮都是完整提示词', async () => {
  const h = await makeHarness({ socialV2: { promptGating: { enabled: false }, wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 300 } } });
  try {
    for (let i = 1; i <= 3; i += 1) assertFull(h.buildWakePromptV2('group:456', 'admin'), `第 ${i} 轮`);
  } finally { await h.close(); }
});

// ── 4. 首轮必完整；新会话（reset/重建）也必完整；会话之间计数独立 ─────────────
await test('新会话的第一轮一定是完整的，计数按会话隔离', async () => {
  const h = await makeHarness({ socialV2: { promptGating: { enabled: true, metaEveryWakes: 5 }, wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 300 } } });
  try {
    assertFull(h.buildWakePromptV2('group:456', 'admin'), '会话 A 第 1 轮');
    assertStub(h.buildWakePromptV2('group:456', 'admin'), '会话 A 第 2 轮', h);
    await h.ensureSession('private:123');
    assertFull(h.buildWakePromptV2('private:123', 'admin'), '会话 B 第 1 轮');
    // 模拟 DSH 侧 /reset 换会话：新 sessionId → 首轮必须重新完整
    h.state.sessions['group:456'] = 'session-after-reset';
    assertFull(h.buildWakePromptV2('group:456', 'admin'), '会话 A 换会话后的第 1 轮');
  } finally { await h.close(); }
});

// ── 5. 预构建不记账：否则真正投递的那条会变成占位 ─────────────────────────────
await test('commitPromptBlocks:false 的预构建不推进周期', async () => {
  const h = await makeHarness({ socialV2: { promptGating: { enabled: true, metaEveryWakes: 3 }, wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 300 } } });
  try {
    // 模拟 sendWakePromptV2 的预构建（只算不发）
    for (let i = 0; i < 2; i += 1) assertFull(h.buildWakePromptV2('group:456', 'admin', { commitPromptBlocks: false }), `预构建 ${i + 1}`);
    // 真正投递时才该记账
    assertFull(h.buildWakePromptV2('group:456', 'admin'), '首次投递');
    assertStub(h.buildWakePromptV2('group:456', 'admin'), '第二次投递', h);
  } finally { await h.close(); }
});

// ── 6. 计数要落盘（重启桥接不重新从 1 数） ────────────────────────────────────
await test('分段计数落盘在 state/prompt-gating.json（重启后不重新从 1 数）', async () => {
  const h = await makeHarness();
  try {
    assertFull(h.buildWakePromptV2('group:456', 'admin'), '第 1 轮');
    assertStub(h.buildWakePromptV2('group:456', 'admin'), '第 2 轮', h);
    // social-v2.json 只持久化白名单字段，自定义字段会被静默丢弃；
    // 所以计数单独落在 prompt-gating.json（这也是 0.2.1-r1 踩过的坑）。
    const saved = JSON.parse(fs.readFileSync(path.join(h.temp, 'state', 'prompt-gating.json'), 'utf8'));
    const rec = saved['group:456'];
    assert.equal(rec.wakes, 1, '第 2 轮之后计数应为 1');
    assert.ok(rec.session, '必须记下会话 id');
  } finally { await h.close(); }
});

// ── 7. 角色卡周期也能在 promptGating 里统一调 ────────────────────────────────
await test('角色卡与规则块同频：统一周期下一起全量、一起占位', async () => {
  const roleText = '〔二代〕\n你是测试角色，说话简短。\n';
  const h = await bridgeHarness({
    config: {
      socialV2: {
        roleCard: { mode: 'first', fullEveryWakes: 99 },   // 故意配成 99：统一周期要压住它
        promptGating: { enabled: true, metaEveryWakes: 2, dedupeMs: 0 },
        wake: { maxWakePerMinute: 0, maxWakePerHour: 0, batchWindowMs: 300, preSleepWaitMs: 90000 }
      }
    },
    files: {
      'roles/测试角色.md': roleText,
      'state/current-role.json': { role: '测试角色', mode: 'active' }
    }
  });
  try {
    h.setMode('reserved2');
    h.setSelfIdentity('小鲸鱼', '1000000001');
    await h.ensureSession('group:456');
    const texts = [0, 1, 2].map(() => h.buildWakePromptV2('group:456', 'admin'));
    // 完整角色卡的标志是「【角色卡 —— 以下是你的设定」，省略轮只有一行提醒
    assert.ok(texts[0].includes('【角色卡 —— 以下是你的设定'), '第 1 轮要带完整角色卡');
    assert.ok(texts[1].includes('角色卡已在本会话前面完整给过'), '第 2 轮应省略完整卡');
    assert.ok(texts[2].includes('【角色卡 —— 以下是你的设定'), '第 3 轮（每 2 轮）应重发完整卡');
  } finally { await h.close(); }
});

// ── 8. 走真实投递链路（控制台立即唤醒 → deliverPrompt）也生效 ─────────────────
await test('控制台立即唤醒真正投递的 prompt 采用分段注入', async () => {
  // 一次唤醒里 buildWakePromptV2 会被调用多次（预构建 + 投递 + 复核），
  // 必须保留去重窗口，否则后几次会读到已经推进过的计数、把首轮变成占位。
  const h = await makeHarness({ socialV2: { promptGating: { dedupeMs: 8000 } } });
  try {
    await withServer(h, async (port) => {
      // 首轮走 bootstrap 引导文案（它故意只带基本段）；这里要看的是「分段注入」，
      // 所以先标记引导已发，让唤醒走正常唤醒路径。
      h.getSocialV2State('group:456').bootstrapSent = true;
      const res = await call(port, '/api/socialV2/wake', { method: 'POST', headers: ADMIN, body: { key: 'group:456', reason: 'admin' } });
      assert.equal(res.status, 200, res.body);
      for (let i = 0; i < 200 && !h.calls.prompts.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(h.calls.prompts.length >= 1, '唤醒必须真的投递一次 prompt');
      const text = (h.calls.prompts[0].content || []).map((c) => String(c?.text ?? '')).join('\n');
      // 投递前 withSlangContext 会补【当前时间】；首轮（bootstrap）尾部是【引导唤醒】，没有【行动前】。
      assert.ok(text.includes('【当前时间】'), '投递的 prompt 必须以【当前时间】开头');
      for (const marker of ['【你的身份】', '【反AI味】你不是客服', '【积极性】', '【表情包策略', '【沉睡前强制等待】这是决定潜水收尾时的步骤']) {
        assert.ok(text.includes(marker), `投递的 prompt 缺少完整段 ${marker}`);
      }
      assert.equal(text.includes('已在本会话上文完整给出'), false, '首轮不该出现占位行');
      assert.ok(text.includes('【引导唤醒】') || text.includes('【唤醒】'), '要带唤醒原因');
    });
  } finally { await h.close(); }
});

// ── 9. 表情包：清单每轮都在；连续 3 轮没发提醒一次，发过就清零 ────────────────
await test('表情包清单每轮都在，连续 3 轮没发会提醒，发过后清零', async () => {
  const h = await makeHarness();
  try {
    // harness 默认没有收藏表情，先塞两张假的，清单才有内容可渲染。
    h.setStickerEntries([
      { id: 'fixture-a', url: 'https://public.invalid/a.png', desc: '无语', tags: ['无语'] },
      { id: 'fixture-b', url: 'https://public.invalid/b.png', desc: '笑哭', tags: ['笑哭'] },
    ]);
    const rounds = [0, 1, 2, 3].map(() => h.buildWakePromptV2('group:456', 'admin'));
    // 清单是素材：完整轮和占位轮都必须有（否则她想发图时不知道该发哪张）。
    for (const [i, text] of rounds.entries()) {
      assert.ok(text.includes('【可用表情包】'), `第 ${i + 1} 轮缺少表情清单`);
    }
    // 策略是规则：只在完整轮出现。
    assert.ok(rounds[0].includes('【表情包策略'), '第 1 轮应带完整策略');
    assert.equal(rounds[1].includes('【表情包策略'), false, '占位轮不该再带策略');
    // 前三轮还没到提醒门槛（gap 依次 0/1/2 → 第 3 轮时读到的 gap 是 2）。
    assert.equal(rounds[2].includes('轮没发了'), false, '第 3 轮（gap=2）还不该提醒');
    assert.ok(rounds[3].includes('已经 3 轮没发了'), '第 4 轮（gap=3）必须提醒');
    // 落盘 + 发图清零
    const gapFile = path.join(h.temp, 'state', 'prompt-gating.json');
    assert.equal(JSON.parse(fs.readFileSync(gapFile, 'utf8'))['group:456'].stickerGap, 4);
    h.noteStickerSentV2('group:456');
    const after = h.buildWakePromptV2('group:456', 'admin');
    assert.equal(after.includes('轮没发了'), false, '发过图后不该再提醒');
    assert.equal(JSON.parse(fs.readFileSync(gapFile, 'utf8'))['group:456'].stickerGap, 1, '清零后再投递一轮应为 1');
  } finally { await h.close(); }
});

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
