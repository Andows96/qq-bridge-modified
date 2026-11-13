// meme-lib 回归测试（离线，不依赖 DSH / SnowLuma）。
//
// 覆盖三件事：
//   1. 图库能被发现并读出（本机只有 dsh-meme 内置包 dafeiyu-001，24 张）
//   2. 路径逃逸一律被拒（这是 L7 边界的落点，不是"顺带测一下"）
//   3. 搜索 / tag 过滤按预期工作
//
// 用法：node scripts/test-meme-lib.mjs
import assert from 'node:assert/strict';
import { activePacks, listMemes, resolveMemePath, readMemeBytes } from '../src/meme-lib.js';

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    fail++;
    console.log(`  ✗ ${name}\n      ${error?.message ?? error}`);
  }
}

console.log('meme-lib 回归测试');

// ---- 1. 图库发现 ----
const found = activePacks();
console.log(`\n[图库] packsDir=${found.packsDir} activeId=${found.activeId} 可用=${found.packs.map((p) => p.id).join(',') || '(无)'}`);

ok('至少发现一个可用图库', () => {
  assert.ok(found.packs.length >= 1, '没有可用图库：本机应至少有 dsh-meme 内置包');
});
ok('activeId 非空', () => assert.ok(found.activeId));

const pack = found.packs[0];
ok('图库带 name/source 元信息', () => {
  assert.ok(pack.id);
  assert.ok(pack.path);
  assert.ok(['bundled', 'custom'].includes(pack.source));
});

// ---- 2. 列表 ----
const all = listMemes({ limit: 0 });
console.log(`\n[列表] total=${all.total} error=${all.error ?? '(none)'}`);
ok('能读出表情条目', () => assert.ok(all.total > 0, 'total 为 0'));
ok('每条都有 path/tag/caption', () => {
  for (const item of all.items) {
    assert.ok(item.path, '缺 path');
    assert.ok(item.tag, `缺 tag: ${item.path}`);
    assert.ok(typeof item.caption === 'string');
  }
});
ok('caption 是中文且非乱码', () => {
  const withCaption = all.items.filter((i) => i.caption);
  assert.ok(withCaption.length > 0, '一条 caption 都没有');
  const sample = withCaption[0].caption;
  assert.ok(/[\u4e00-\u9fa5]/.test(sample), `caption 不含中文: ${sample}`);
  assert.ok(!/\uFFFD/.test(sample), `caption 有替换字符: ${sample}`);
});
ok('limit 生效', () => {
  const limited = listMemes({ limit: 3 });
  assert.equal(limited.items.length, 3);
  assert.equal(limited.total, all.total, 'total 不应被 limit 影响');
});

// ---- 3. 搜索与过滤 ----
const byTag = listMemes({ tag: 'sad' });
ok('tag 过滤只返回该桶', () => {
  assert.ok(byTag.total > 0, 'tag=sad 没结果');
  for (const item of byTag.items) assert.equal(item.tag, 'sad');
});

const byQuery = listMemes({ query: '生气' });
ok('query 能命中关键词', () => assert.ok(byQuery.total > 0, 'query=生气 没结果'));

const noHit = listMemes({ query: '不存在的词zzz' });
ok('无命中时返回空而不是报错', () => {
  assert.equal(noHit.total, 0);
  assert.equal(noHit.error, undefined);
});

// ---- 4. 路径安全边界（核心）----
console.log('\n[安全] 路径逃逸必须全部被拒');

const escapes = [
  ['../../../../etc/passwd', '上层逃逸'],
  ['memes/../../../Windows/win.ini', '混合逃逸'],
  ['..\\..\\Windows\\win.ini', '反斜杠逃逸'],
  ['C:/Windows/win.ini', '绝对路径'],
  ['\\\\server\\share\\x.jpg', 'UNC 路径'],
  ['file:///C:/Windows/win.ini', 'file://'],
  ['https://example.com/x.jpg', 'http(s)'],
  ['data:image/png;base64,AAAA', 'data:'],
  ['base64://AAAA', 'base64://'],
  ['', '空路径'],
];
for (const [input, label] of escapes) {
  ok(`拒绝 ${label}`, () => {
    assert.throws(() => resolveMemePath(pack.id, input), undefined, `竟然放行了: ${input}`);
  });
}

ok('未知图库 id 被拒', () => {
  assert.throws(() => resolveMemePath('__no_such_pack__', all.items[0]?.path || 'x'), /未知或未启用/);
});

// ---- 5. 合法路径必须通过 ----
const legal = all.items[0];
// 多包时 listMemes 返回的 path 自带 `packId/` 前缀（跨包唯一定位），单包时是裸路径。
// 这里取裸路径做基准，两种形态都测一遍 —— 发送时 AI 可能抄到任意一种。
const legalBare = legal.path.startsWith(`${pack.id}/`) ? legal.path.slice(pack.id.length + 1) : legal.path;
ok('裸相对路径可解析', () => {
  const r = resolveMemePath(pack.id, legalBare);
  assert.ok(r.abs.startsWith(pack.path), '解析结果不在图库内');
  assert.ok(r.bytes > 0, '文件为空');
});
ok('path 自带包前缀也能解析', () => {
  const r = resolveMemePath(pack.id, `${pack.id}/${legalBare}`);
  assert.ok(r.abs.startsWith(pack.path));
});
ok('不传 pack 时单包可解析、多包必须报错', () => {
  if (found.packs.length === 1) {
    const r = resolveMemePath('', legalBare);
    assert.ok(r.abs.startsWith(pack.path));
  } else {
    assert.throws(() => resolveMemePath('', legalBare), /必须指定 pack/);
  }
});
ok('每张图的 pack+path 组合都能解析', () => {
  for (const item of all.items) {
    const r = resolveMemePath(item.pack, item.path);
    assert.ok(r.bytes > 0, `${item.pack}/${item.path} 解析失败`);
  }
});
ok('读字节与大小一致', () => {
  const r = readMemeBytes(pack.id, legalBare, { maxBytes: 8 * 1024 * 1024 });
  assert.equal(r.buffer.length, r.bytes);
  assert.ok(r.buffer.length > 100, '读到的字节太少，可能是坏文件');
});
ok('超上限时拒绝读取', () => {
  const r = resolveMemePath(pack.id, legalBare);
  assert.throws(() => readMemeBytes(pack.id, legalBare, { maxBytes: r.bytes - 1 }), /过大/);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
