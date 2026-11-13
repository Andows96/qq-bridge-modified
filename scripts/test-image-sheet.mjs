// 动图联系表（contact sheet）单测。
//
// 两部分：
//   1) 纯函数：抽帧计划 / 网格选择（不需要 ffmpeg，任何机器都能跑）
//   2) 真实文件：直接拿本机 QQ 表情缓存里的动图跑 contactSheetBuffer（需要 ffmpeg）
//      —— 沙箱里 spawn ffmpeg 会被拒（EPERM），所以这一部分要用真实权限跑：
//         node scripts/test-image-sheet.mjs
//
// 断言的重点不是"图生成出来了"，而是四条线上行为：
//   · 帧数/网格/抽帧号符合自适应规则（大单帧 2x2、长动图 3x3、其余 6 格）
//   · 抽帧号不重复、首尾都取到（避免 9 帧抽 6 帧时末帧重复）
//   · 整张不超过长边上限，且大图不被二次缩小（tileEdge 保持原帧边长）
//   · 静态图/垃圾输入不抛异常，只返回 ok:false（调用方据此回退原逻辑）
import fs from 'node:fs';
import path from 'node:path';
import {
  contactSheetBuffer,
  planSheetTiles,
  pickSheetGrid,
  pickSampleIndices,
  probeImageSize,
  SHEET_MAX_EDGE,
} from '../src/image-downscale.js';
import { detectAnimatedImage } from '../src/image-animation.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ───────────────────────── 1. 纯函数 ─────────────────────────
console.log('== 抽帧计划 ==');
{
  const expect = [
    // [frames, frameLongEdge, cols, rows, tiles]
    [2, 160, 2, 1, 2],
    [3, 160, 3, 1, 3],
    [5, 90, 3, 2, 5],
    [6, 160, 3, 2, 6],
    [11, 160, 3, 2, 6],
    [24, 603, 2, 2, 4],   // 大单帧 → 保细节，4 格
    [72, 160, 3, 3, 9],   // 长动图 → 多抽帧，9 格
    [30, 1200, 2, 2, 4],  // 又大又长 → 仍然是细节优先
  ];
  for (const [frames, long, cols, rows, tiles] of expect) {
    const p = planSheetTiles({ animatedFrames: frames, frameLongEdge: long });
    const ok = p && p.cols === cols && p.rows === rows && p.tiles === tiles;
    check(`frames=${frames} long=${long} → ${cols}x${rows}`, ok, p ? `实际 ${p.cols}x${p.rows} tiles=${p.tiles}` : 'null');
  }
  const p = planSheetTiles({ animatedFrames: 9, frameLongEdge: 300 });
  check('抽帧号无重复', new Set(p.sampled).size === p.sampled.length, p.sampled.join('/'));
  check('抽帧号首尾都取到（1 与末帧）', p.sampled[0] === 1 && p.sampled[p.sampled.length - 1] === 9, p.sampled.join('/'));
  check('抽帧号递增', p.sampled.every((v, i, a) => i === 0 || v > a[i - 1]), p.sampled.join('/'));
  check('非动图返回 null', planSheetTiles({ animatedFrames: 1, frameLongEdge: 100 }) === null);
  check('帧数非法返回 null', planSheetTiles({ animatedFrames: 0 }) === null && planSheetTiles({}) === null);
  check('maxTiles 可压到 4', (() => {
    const q = planSheetTiles({ animatedFrames: 72, frameLongEdge: 100, maxTiles: 4 });
    return q && q.tiles <= 4 && q.cols * q.rows >= q.tiles;
  })());
}
console.log('== 网格选择 ==');
{
  const table = [[1,2,1],[2,2,1],[3,3,1],[4,2,2],[5,3,2],[6,3,2],[7,3,3],[9,3,3],[12,3,3]];
  for (const [n, cols, rows] of table) {
    const g = pickSheetGrid(n);
    check(`pickSheetGrid(${n}) → ${cols}x${rows}`, g.cols === cols && g.rows === rows, `实际 ${g.cols}x${g.rows}`);
  }
  const idx = pickSampleIndices(24, 4);
  check('pickSampleIndices(24,4) 含首尾', idx[0] === 0 && idx[idx.length - 1] === 23, idx.join(','));
  check('pickSampleIndices(5,9) 不超过总帧数', pickSampleIndices(5, 9).length === 5);
}

// ───────────────────────── 2. 真实文件 ─────────────────────────
const EMOJI_DIRS = [
  'C:/Users/<user>/Documents/Tencent Files/<QQ>/nt_qq/nt_data/Emoji',
].filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });

function walk(dir, out, limit = 4000) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, limit);
    else out.push(full);
  }
}

console.log('== 真实动图（需要 ffmpeg）==');
const files = [];
for (const d of EMOJI_DIRS) walk(d, files);
const animated = [];
for (const f of files) {
  let buf;
  try {
    const st = fs.statSync(f);
    if (st.size > 8 * 1024 * 1024 || st.size < 12) continue;
    buf = fs.readFileSync(f);
  } catch { continue; }
  const info = detectAnimatedImage(buf);
  if (info.animated) animated.push({ file: f, buffer: buf, info });
}
console.log(`（扫到 ${files.length} 个文件，其中动图 ${animated.length} 个）`);

function pickOne(predicate) {
  return animated.find((a) => predicate(a));
}

const buckets = [
  { name: '短动图（2~4 帧）', want: 3, pred: (a) => a.info.frames >= 2 && a.info.frames <= 4 },
  { name: '中动图（5~9 帧）', want: 6, pred: (a) => a.info.frames >= 5 && a.info.frames <= 9 },
  { name: '长动图（10~30 帧）', want: 6, pred: (a) => a.info.frames >= 10 && a.info.frames <= 30 },
  { name: '超长动图（>30 帧）', want: 9, pred: (a) => a.info.frames > 30 },
];

if (!animated.length) {
  console.log('⚠️ 本机找不到动图样本，跳过真实文件测试（纯函数部分已通过）');
} else {
  for (const b of buckets) {
    const sample = pickOne(b.pred);
    if (!sample) {
      console.log(`（没有 ${b.name} 的样本，跳过）`);
      continue;
    }
    const r = await contactSheetBuffer(sample.buffer, {
      mimeType: sample.info.format === 'png' ? 'image/png' : sample.info.format === 'webp' ? 'image/webp' : 'image/gif',
      animatedFrames: sample.info.frames,
      maxEdge: SHEET_MAX_EDGE,
    });
    const okShape = r.ok && r.buffer?.length > 0 && r.mimeType === 'image/jpeg';
    check(`${b.name} 生成联系表`, okShape, okShape
      ? `${r.frames} 帧 → ${r.tiles} 帧 ${r.cols}x${r.rows}，${r.width}x${r.height}，${Math.round(r.bytes / 1024)}KB（tileEdge=${r.tileEdge}）`
      : String(r.error));
    if (!r.ok) continue;
    check(`${b.name} 整张不超过长边 ${SHEET_MAX_EDGE}`,
      (!r.width || r.width <= SHEET_MAX_EDGE) && (!r.height || r.height <= SHEET_MAX_EDGE),
      `${r.width}x${r.height}`);
    check(`${b.name} 体积远小于 2.5MB 阈值`, r.bytes < 2_500_000, `${Math.round(r.bytes / 1024)}KB`);
    check(`${b.name} 抽帧号无重复`, new Set(r.sampled).size === r.sampled.length, r.sampled.join('/'));
    // 不放大也不额外缩小：每格边长 = min(原帧长边, floor(1568/列数))
    const cap = Math.floor(SHEET_MAX_EDGE / r.cols);
    check(`${b.name} 每格边长不超封顶`, r.tileEdge <= cap, `tileEdge=${r.tileEdge} cap=${cap}`);
  }

  // 大单帧样本：验证"不被二次缩小"（这是"97% 无损"结论的落点）
  // 注意：detectAnimatedImage 只给帧数/格式，不给尺寸，所以要单独用 ffprobe 量。
  let big = null;
  for (const a of animated) {
    const size = await probeImageSize(a.file, {}).catch(() => null);
    const long = Math.max(size?.width || 0, size?.height || 0);
    if (long >= 512) {
      big = { ...a, size, long };
      break;
    }
  }
  if (big) {
    const r = await contactSheetBuffer(big.buffer, {
      mimeType: big.info.format === 'png' ? 'image/png' : big.info.format === 'webp' ? 'image/webp' : 'image/gif',
      animatedFrames: big.info.frames,
      maxEdge: SHEET_MAX_EDGE,
    });
    check('大单帧用 2x2 且不比原帧更小',
      r.ok && r.cols === 2 && r.rows === 2 && r.tileEdge >= Math.min(big.long, Math.floor(SHEET_MAX_EDGE / 2)),
      r.ok ? `原帧长边=${big.long} tileEdge=${r.tileEdge} 联系表=${r.width}x${r.height}` : String(r.error));
    check('大单帧/竖构图拼图也压到长边上限内',
      r.ok && (!r.width || r.width <= SHEET_MAX_EDGE) && (!r.height || r.height <= SHEET_MAX_EDGE),
      r.ok ? `${r.width}x${r.height}` : String(r.error));
  } else {
    console.log('（本机缓存里没有单帧长边 ≥512 的动图样本，跳过"大单帧"用例）');
  }

  // 静态图：必须不生成联系表（调用方回退原逻辑）
  const staticFile = files.find((f) => {
    try {
      const st = fs.statSync(f);
      if (st.size > 3 * 1024 * 1024) return false;
      const buf = fs.readFileSync(f);
      const info = detectAnimatedImage(buf);
      return !info.animated && /^(png|jpeg|webp)$/.test(info.format);
    } catch { return false; }
  });
  if (staticFile) {
    const r = await contactSheetBuffer(fs.readFileSync(staticFile), { animatedFrames: 1 });
    check('静态图不生成联系表', r.ok === false, String(r.error ?? ''));
  }
}

console.log('== 异常输入 ==');
{
  const cases = [
    ['空 buffer', Buffer.alloc(0)],
    ['非图片文本', Buffer.from('hello world, not an image')],
    ['截断 GIF 头', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(4)])],
  ];
  for (const [name, buf] of cases) {
    let threw = false;
    let r = null;
    try { r = await contactSheetBuffer(buf, { animatedFrames: 4 }); } catch { threw = true; }
    check(`${name} 不抛异常且返回失败`, !threw && r && r.ok === false, threw ? '抛异常了' : String(r?.error ?? ''));
  }
}

console.log('');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exitCode = 1;
