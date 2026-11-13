// 黑话入库关键词黑名单（slang.excludeKeywords）自检。
// 覆盖：关键词规范化、命中语义、真实场景（人名作为梗被收录）、与 JSON 存储往返。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  normalizeExcludeKeywords,
  createSlangKeywordFilter,
  planExtractionWrites,
  loadSlang,
  saveSlang,
  createSlangEntry,
  upsertSlangEntry,
  SLANG_STATUS,
} from '../src/slang-learner.js';

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`✅ ${name}`);
}

// 1. 规范化：去空白、丢空项、去重、大小写折叠、支持逗号分隔字符串
{
  assert.deepEqual(normalizeExcludeKeywords([' 陈赫尧 ', '', '陈赫尧', 'ABC', 'abc', null]), ['陈赫尧', 'abc']);
  assert.deepEqual(normalizeExcludeKeywords('张三, 李四 ,'), ['张三', '李四']);
  assert.deepEqual(normalizeExcludeKeywords(undefined), []);
  assert.deepEqual(normalizeExcludeKeywords('x'.repeat(101)), [], '超长关键词应被忽略');
  ok('normalizeExcludeKeywords 清洗与去重');
}

// 2. 空黑名单 = 全部放行（不能因为功能存在就改变默认行为）
{
  const f = createSlangKeywordFilter([]);
  assert.equal(f.check({ content: 'yyds', evidence: [{ text: '这波 yyds' }] }).blocked, false);
  ok('空黑名单不拦任何东西');
}

// 3. 命中词条名
{
  const f = createSlangKeywordFilter(normalizeExcludeKeywords(['陈赫尧']));
  const hit = f.check({ content: '陈赫尧', evidence: [] });
  assert.equal(hit.blocked, true);
  assert.equal(hit.field, 'content');
  assert.equal(hit.term, '陈赫尧');
  ok('命中词条名被拦');
}

// 4. 真实场景：人名是"梗的一部分"，词条名是人名之外的词，命中证据原文
{
  const f = createSlangKeywordFilter(normalizeExcludeKeywords(['陈赫尧']));
  const hit = f.check({
    content: '第二人格',
    evidence: [{ key: 'group:100000002', sender: '龙铛铛', text: '陈赫尧第二人格吧[表情2]' }],
  });
  assert.equal(hit.blocked, true, '证据原文含人名必须拦——泄露隐私的是那句话');
  assert.equal(hit.field, 'evidence');
  ok('真实场景：人名出现在证据原文里同样被拦');
}

// 5. 大小写不敏感（英文关键词）
{
  const f = createSlangKeywordFilter(normalizeExcludeKeywords(['Tony']));
  assert.equal(f.check({ content: 'tony老师', evidence: [] }).blocked, true);
  assert.equal(f.check({ content: 'x', evidence: [{ text: 'TONY说了' }] }).blocked, true);
  ok('英文关键词大小写不敏感');
}

// 6. 不误伤：无关词条放行
{
  const f = createSlangKeywordFilter(normalizeExcludeKeywords(['陈赫尧']));
  for (const c of ['下头', 'yyds', 'zdjd', '小美女']) {
    assert.equal(f.check({ content: c, evidence: [{ text: `${c}真不错` }] }).blocked, false, `${c} 不该被拦`);
  }
  ok('无关词条不被误伤');
}

// 7. 多关键词：任一命中即拦
{
  const f = createSlangKeywordFilter(normalizeExcludeKeywords(['张三', '李四']));
  assert.equal(f.check({ content: '李四梗', evidence: [] }).blocked, true);
  assert.equal(f.check({ content: 'x', evidence: [{ text: '张三说的' }] }).blocked, true);
  assert.equal(f.check({ content: '王五', evidence: [{ text: '王五来了' }] }).blocked, false);
  ok('多个关键词任一命中即拦');
}

// 8. 边界：脏数据不应抛异常
{
  const f = createSlangKeywordFilter(normalizeExcludeKeywords(['x']));
  assert.equal(f.check({}).blocked, false);
  assert.equal(f.check({ evidence: null }).blocked, false);
  assert.equal(f.check({ evidence: [null, undefined, { text: null }] }).blocked, false);
  assert.equal(f.check().blocked, false);
  ok('脏输入不抛异常');
}

// 9. 存储往返：拦下来的词条与放行的词条都要能正确落盘/读回
{
  const dir = mkdtempSync(path.join(tmpdir(), 'slang-exclude-'));
  const file = path.join(dir, 'slang.json');
  try {
    const filter = createSlangKeywordFilter(normalizeExcludeKeywords(['陈赫尧']));
    const incoming = [
      { content: '第二人格', evidence: [{ key: 'group:1', sender: '龙铛铛', text: '陈赫尧第二人格吧' }] },
      { content: '下头', evidence: [{ key: 'group:1', sender: '张三', text: '太下头了兄弟' }] },
    ];
    let entries = [];
    let blocked = 0;
    for (const item of incoming) {
      if (filter.check(item).blocked) { blocked += 1; continue; }
      const r = upsertSlangEntry(entries, item.content, { evidence: item.evidence, countIncrement: 1 });
      entries = r.entries;
    }
    assert.equal(blocked, 1, '应拦下 1 条');
    assert.equal(entries.length, 1, '只应入库 1 条');

    saveSlang(file, entries);
    const reloaded = loadSlang(file);
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].content, '下头');
    assert.ok(!JSON.stringify(reloaded).includes('陈赫尧'), '落盘内容里不应残留被拦词条的证据原文');
    ok('存储往返后黑名单词条与其证据均未落盘');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 10. upsert 语义不变：同一词条重复出现只累计、不新增
{
  const filter = createSlangKeywordFilter(normalizeExcludeKeywords(['陈赫尧']));
  let entries = [];
  for (const text of ['下头', '太下头了']) {
    const item = { content: '下头', evidence: [{ text }] };
    if (filter.check(item).blocked) continue;
    entries = upsertSlangEntry(entries, item.content, { evidence: item.evidence, countIncrement: 1 }).entries;
  }
  assert.equal(entries.length, 1);
  assert.equal(entries[0].count, 2);
  assert.equal(entries[0].status, SLANG_STATUS.CANDIDATE);
  ok('过滤不改变 upsert 的累计语义');
}

// 11. 已入库词条的事后拦截：往黑名单加新词后，旧词条也应被判定为拦
{
  const entry = createSlangEntry({
    content: '第二人格',
    evidence: [{ key: 'group:1', sender: '龙铛铛', text: '陈赫尧第二人格吧' }],
  });
  const before = createSlangKeywordFilter(normalizeExcludeKeywords([]));
  assert.equal(before.check(entry).blocked, false, '黑名单为空时应放行');
  const after = createSlangKeywordFilter(normalizeExcludeKeywords(['陈赫尧']));
  assert.equal(after.check(entry).blocked, true, '补加关键词后旧词条也应被拦（注入前过滤依赖这条）');
  ok('事后补加关键词能拦住库里已有的词条');
}

// 12. 回归：热更新关键词（替换 filter.keywords）必须立即生效。
// 这条是补的——原实现的 check 把关键词数组缓存在闭包里，`filter.keywords = 新值`
// 之后仍然只看得到创建时那份（空数组 ⇒ 永远放行）。所有"创建时就传关键词"的用法
// 都测不出这个缺陷，只有热更新路径能暴露，所以必须单独钉住。
{
  const filter = createSlangKeywordFilter([]);
  assert.equal(filter.check({ content: '陈赫尧' }).blocked, false, '换之前应放行');

  filter.keywords = normalizeExcludeKeywords(['陈赫尧']);
  assert.equal(filter.check({ content: '陈赫尧' }).blocked, true, '替换 keywords 后必须立刻生效');
  assert.equal(filter.check({ content: 'x', evidence: [{ text: '陈赫尧说的' }] }).blocked, true, '证据路径也要生效');

  filter.keywords = normalizeExcludeKeywords([]);
  assert.equal(filter.check({ content: '陈赫尧' }).blocked, false, '清空 keywords 后应恢复放行');

  filter.keywords = null;
  assert.equal(filter.check({ content: '陈赫尧' }).blocked, false, 'keywords 被置为脏值时不应抛异常');
  ok('热更新 filter.keywords 立即生效（回归防护）');
}

// 13. 自动提取路径：planExtractionWrites 必须跳过命中黑名单的候选（含证据一起丢）。
// 提取路径依赖 learner 会话与真实群消息，端到端难以复现，所以把"该写哪些"抽成纯函数单测。
{
  const filter = createSlangKeywordFilter(normalizeExcludeKeywords(['陈赫尧']));
  const messages = [
    { sender: '龙铛铛', text: '陈赫尧第二人格吧[表情2]', time: 1 },
    { sender: 'Androidows', text: '太下头了兄弟', time: 2 },
    { sender: '龙铛铛', text: 'zdjd？', time: 3 },
  ];
  const items = [
    { content: '第二人格', source_id: '1' },   // 证据含关键词 → 应拦
    { content: '陈赫尧', source_id: '1' },      // 词条名本身命中 → 应拦
    { content: '下头', source_id: '2' },        // 正常 → 应入库
    { content: 'zdjd', source_id: '3' },        // 正常 → 应入库
    { content: '下头', source_id: '2' },        // 重复项 → 去重，不重复入库
    { content: '  ', source_id: '1' },          // 空词条 → 忽略
  ];
  const plan = planExtractionWrites(items, messages, { key: 'group:1', filter: (candidate) => filter.check(candidate) });

  assert.deepEqual(plan.accepted.map(a => a.content), ['下头', 'zdjd'], '只应放行两条');
  assert.deepEqual(plan.blocked.map(b => b.content), ['第二人格', '陈赫尧'], '应拦下两条');
  assert.equal(plan.blocked.find(b => b.content === '第二人格').field, 'evidence', '第二人格应由证据原文命中');
  assert.equal(plan.blocked.find(b => b.content === '陈赫尧').field, 'content', '陈赫尧应由词条名命中');
  assert.equal(plan.blocked.find(b => b.content === '第二人格').term, '陈赫尧');

  // 被拦的词条绝不能把证据带出去——泄露隐私的正是那句话
  const leaked = JSON.stringify(plan.accepted);
  assert.ok(!leaked.includes('陈赫尧'), 'accepted 里不应残留被拦词条的证据原文');

  // 证据要跟对消息（source_id 指向第 2 条）
  assert.equal(plan.accepted[0].evidence[0].text, '太下头了兄弟');
  assert.equal(plan.accepted[0].evidence[0].key, 'group:1');
  ok('自动提取路径：命中即跳过且不带走证据（planExtractionWrites）');
}

// 14. planExtractionWrites 的健壮性：脏输入不炸、无 filter 时全放行
{
  const noFilter = planExtractionWrites([{ content: 'a', source_id: '1' }], [{ text: 'x' }], { key: 'k' });
  assert.equal(noFilter.accepted.length, 1);
  assert.equal(noFilter.blocked.length, 0);

  const dirty = planExtractionWrites(
    [null, { content: '' }, { content: 'ok', source_id: '99' }],
    null,
    { key: 'k', filter: () => ({ blocked: false }) },
  );
  assert.deepEqual(dirty.accepted.map(a => a.content), ['ok']);
  assert.deepEqual(dirty.accepted[0].evidence, [], '越界 source_id 应得到空证据而不是抛错');
  ok('planExtractionWrites 脏输入健壮');
}

console.log(`\n🎉 黑话关键词黑名单测试通过（${passed} 项）`);
