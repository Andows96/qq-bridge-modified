// 图片降采样：把过大的 QQ 图片缩到 DSH 能稳定接收的尺寸再交给模型。
//
// 为什么需要它（实测结论，别删）：
//   QQ 里一张 3072x4536 的 JPEG 是 3.27 MB，base64 后 4.57 MB 字符。桥接这一路全部正常
//   —— get_image 拿到带 rkey 的新 URL、HTTP 200、image/jpeg、尺寸与体积都在桥接限额内
//   （MAX_MEDIA_BYTES 4MB / MAX_MEDIA_PIXELS 64M），MCP 工具也返回 ok:true；桥接日志里
//   「get_image 解析失败 / 图片 URL 抓取失败 / 像素超限 / base64 超限 / 图片查询失败」
//   六类错误累计命中 **0 次**。
//
//   拒绝发生在 DSH 侧：它的图片准入会对每个 image 块做
//       if (data.toString("base64") !== block.data) throw …("image data must be canonical base64")
//   这一步在大图上报 `Maximum call stack size exceeded`，于是该图被替换成一条诊断文本
//   `[image unavailable: image/jpeg; Maximum call stack size exceeded; …]`，
//   模型因此"看不到图"。小图正常、大图失败——所以修法是在桥接侧先把图缩小。
//
// 设计取舍：
//   - 只在超过阈值时才动图，小图原样直通（不做无谓的二次编码）。
//   - 缩图**失败一律回退原图**：宁可照旧失败，也不要因为多了一个 ffmpeg 依赖把原本能看的图也弄坏。
//   - 输出统一转成 JPEG：QQ 图片绝大多数是 JPEG；透明图（PNG/WebP）为保留可见性铺白底。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolveFfmpeg } from './voice-core.js';

/**
 * 超过这个字节数才考虑缩小。
 *
 * 阈值由 DSH 侧的硬上限反推，而不是拍脑袋。DSH 的图片准入对每个 image 块跑
 * `/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/` 校验 canonical base64，
 * 该正则在大输入上会抛 `Maximum call stack size exceeded`。2026-10-16 实测（base64-cliff.mjs）：
 *   - base64 4.4M 字符 → ok；4.5M 字符 → 抛栈溢出（默认栈深与「+200 帧深栈」结果一致）；
 *   - 生产环境曾在 3072x4536（3.27MB，base64 4.36M 字符）上真实失败 → 真正的安全线在 4.3M 字符附近。
 * 2.5MB 图片 → base64 ≈3.33M 字符，距真实失败点留约 24% 余量。
 *
 * 为什么从 1MB 调上来：1MB 只是「够安全」，代价是把大量 1~3MB 的高质量图（QQ 收藏表情常见
 * 1~2MB）无谓地重编码成几十 KB 的小文件，图看着就糊——用户 2026-10-15 的反馈正是这个。
 */
export const DOWNSCALE_TRIGGER_BYTES = 2_500_000;
/** 缩小后的目标长边（像素）。1568 是视觉模型常见的高清档位，足够识图又远小于原图。 */
export const DOWNSCALE_TARGET_EDGE = 1568;
/**
 * 质量档：2 = ffmpeg mjpeg 的最高有效档（q:v 1 与 2 输出完全相同），4 会明显掉细节。
 * 实测同一张 603x600 / 1.74MB 收藏表情：q4 → 38,996B（PSNR 38.3dB，毛发纹理发糊），
 * q2 → 77,365B（PSNR 40.7dB）。体积翻倍也远在阈值之下，所以取 2。
 */
export const DOWNSCALE_QSCALE = 2;
/** 命令行超时：大图缩放在慢机器上也可能要几秒，给足但仍要有上限，避免挂死。 */
export const DOWNSCALE_TIMEOUT_MS = 60_000;

function tmpPath(ext) {
  return path.join(os.tmpdir(), `qq-img-${process.pid}-${crypto.randomBytes(6).toString('hex')}${ext}`);
}

/** 定位 ffprobe：优先取 ffmpeg 同目录（发行包通常成对），否则交给 PATH。 */
export function resolveFfprobe(ffmpegPath) {
  if (ffmpegPath && ffmpegPath !== 'ffmpeg') {
    const dir = path.dirname(ffmpegPath);
    for (const name of ['ffprobe.exe', 'ffprobe']) {
      const candidate = path.join(dir, name);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return process.env.FFPROBE_PATH || 'ffprobe';
}

/** 跑一个 ffmpeg/ffprobe 子进程，收集 stdout 与 stderr。 */
function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, error: `无法启动 ${path.basename(command)}：${error?.message ?? error}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { if (stdout.length < 4000) stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { if (stderr.length < 2000) stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({ ok: false, error: `超时（${timeoutMs}ms）` });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `执行失败：${error?.message ?? error}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, stdout, stderr });
      else resolve({ ok: false, error: `退出码 ${code}${stderr ? `：${stderr.trim().split('\n').slice(-2).join(' ')}` : ''}` });
    });
  });
}

/** 用 ffprobe 读图片像素尺寸；失败返回 null（不阻断，调用方按体积决策）。 */
export async function probeImageSize(file, { ffmpegPath = null, timeoutMs = 15_000 } = {}) {
  const ffprobe = resolveFfprobe(resolveFfmpeg({ ffmpegPath }));
  const r = await run(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    file,
  ], timeoutMs);
  if (!r.ok) return null;
  // csv 输出走 stdout（"3072,4536"），早期版本误读 stderr 导致尺寸恒为 null。
  const m = /(\d+)\s*,\s*(\d+)/.exec(String(r.stdout).trim());
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * 把图片降到目标长边以内。
 *
 * @param {Buffer} buffer   原始图片字节
 * @param {object} opts
 *   mimeType     原始 MIME（用于决定输入扩展名）
 *   targetEdge   目标长边，默认 DOWNSCALE_TARGET_EDGE
 *   qscale       JPEG 质量档，默认 DOWNSCALE_QSCALE
 *   ffmpegPath   显式 ffmpeg 路径（来自 config.json）
 *   timeoutMs    命令行超时
 * @returns {Promise<{ok:true, buffer:Buffer, mimeType:string, width:number|null, height:number|null, originalBytes:number, bytes:number}
 *                 | {ok:false, error:string}>}
 */
export async function downscaleImageBuffer(buffer, {
  mimeType = 'image/jpeg',
  targetEdge = DOWNSCALE_TARGET_EDGE,
  qscale = DOWNSCALE_QSCALE,
  ffmpegPath = null,
  timeoutMs = DOWNSCALE_TIMEOUT_MS,
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, error: '空图片' };
  const ffmpeg = resolveFfmpeg({ ffmpegPath });
  const srcExt = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : mimeType === 'image/gif' ? '.gif' : '.jpg';
  const src = tmpPath(srcExt);
  const dst = tmpPath('.jpg');
  try {
    fs.writeFileSync(src, buffer);
    // scale 用 min(edge, 原边) 保证**只缩不放**；force_original_aspect_ratio=decrease 保持比例。
    // 非 JPEG（PNG/WebP 可能带 alpha）额外套 format=rgb24：JPEG 不支持透明通道，不转换会得到黑底。
    const needsRgb = mimeType !== 'image/jpeg';
    const vf = `scale='min(${targetEdge},iw)':'min(${targetEdge},ih)':force_original_aspect_ratio=decrease`
      + (needsRgb ? ',format=rgb24' : '');
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', src,
      '-vf', vf,
      // 必须只出一帧。动图（GIF / 动 WebP / APNG）有多帧，而 image2 是"图像序列"封装格式：
      // 多帧写同一个输出文件名会直接失败——
      //   "Cannot write more than one file with the same name. Are you missing the -update
      //    option or a sequence pattern?"（实测退出码 -22）
      // 后果不是"动图被压平"那么轻：整个缩图被判定为失败、调用方回退原图，于是几 MB 的
      // 动图原样塞给 DSH，缩图等于没做。静态图是单帧，所以这个问题一直没暴露。
      // 取首帧也是视觉模型唯一能用的那一帧——多帧图像对模型就是一张静态图。
      '-frames:v', '1',
      '-q:v', String(qscale),
      '-f', 'image2',
      dst, '-y',
    ];
    const r = await run(ffmpeg, args, timeoutMs);
    if (!r.ok) return { ok: false, error: r.error };
    let out;
    try { out = fs.readFileSync(dst); } catch (error) { return { ok: false, error: `读不到输出：${error?.message ?? error}` }; }
    if (out.length === 0) return { ok: false, error: '输出为空' };
    // 只在输出膨胀到离谱时才放弃。
    // 不能写成 `out.length >= buffer.length 就放弃`：源图若是高度优化的 PNG，
    // 重编码成 JPEG 会变大（实测 27KB → 78KB），那样会把**本该缩小的图**也挡回去，
    // 违背这个模块存在的理由。真正要守住的是"别把结果搞得比原图大一个量级"。
    if (out.length > Math.max(buffer.length * 4, 8 * 1024 * 1024)) {
      return { ok: false, error: `缩小后异常膨胀（${buffer.length} -> ${out.length}）` };
    }
    const size = await probeImageSize(dst, { ffmpegPath, timeoutMs: 15_000 });
    return {
      ok: true,
      buffer: out,
      mimeType: 'image/jpeg',
      width: size?.width ?? null,
      height: size?.height ?? null,
      originalBytes: buffer.length,
      bytes: out.length,
    };
  } finally {
    for (const f of [src, dst]) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}

/** 人类可读的体积，用于日志。 */
export function formatImageBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

// ─────────────────────────── 动图联系表（联系表 = contact sheet）───────────────────────────
//
// 为什么需要它（2026-10-21 实测，别删）：
//   视觉 API 对多帧图像只会解**第一帧**，所以动图无论是 GIF 原样直通、还是被 `-frames:v 1`
//   压成首帧，模型看到的永远是一张静态图。实测两张真实 QQ 动图：
//     · 11 帧 Pusheen 猫（嘴巴一张一合）——单帧只看到"嘴张着"，拼图才看出在吃；
//     · 24 帧灰猫（转头+眨眼）——单帧只看到"皱眉的猫"，拼图才看出它在转头。
//   拼成 3x2 联系表后，动作一眼可读，而**图片张数不变**（1 张），token 只按像素涨。
//
// 设计取舍：
//   · 只出一张图，不拆成 N 张：拆图会 N 倍图片 token，还会吃掉单条消息的图片数/字节预算
//     （MAX_MEDIA_COUNT / MAX_MEDIA_BYTES），把同一条消息里的其他图挤成"已跳过"。
//   · **不放大**：每格边长取"原单帧长边"，再用 1568/列数 封顶，所以只有大动图才缩。
//     实测用户那 434 张动图里 74% 单帧长边 <200px，97% 在 3x2 下是"每格不小于原尺寸"。
//   · 白边分隔（padding/margin=6）：不让相邻帧糊成一张大图，模型才好按格子比对。
//   · 格子数按风险自适应：大单帧（≥512）用 2x2 保住细节；长动图（≥30 帧）用 3x3 少漏动作；
//     其余默认 6 格。帧数装不满网格时铺白格，而不是留黑块。
export const SHEET_MAX_TILES = 9;
export const SHEET_MAX_EDGE = DOWNSCALE_TARGET_EDGE;
const SHEET_GRIDS = [[2, 1], [3, 1], [2, 2], [3, 2], [3, 3]];

/** 选一个能装下 n 格、面积最省的行列组合。 */
export function pickSheetGrid(n) {
  const want = Math.max(1, Math.min(SHEET_MAX_TILES, Math.floor(Number(n) || 1)));
  for (const [cols, rows] of SHEET_GRIDS) {
    if (cols * rows >= want) return { cols, rows };
  }
  return { cols: 3, rows: 3 };
}

/**
 * 均匀抽帧的帧号（0 基）。用"N 个采样点铺满整段"而不是固定步长：
 * 固定步长（round(total/tiles)）在 9 帧抽 6 帧这类情况下会把末帧重复采两次，
 * 得到 1,3,5,7,9,9 —— 既浪费一格又误导模型。这里首尾都取，中间等距，重复自动去重。
 */
export function pickSampleIndices(total, tiles) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const k = Math.max(1, Math.min(n, Math.floor(Number(tiles) || 1)));
  if (n <= 0) return [];
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k === 1) return [0];
  const out = [];
  for (let i = 0; i < k; i += 1) out.push(Math.round((i * (n - 1)) / (k - 1)));
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/**
 * 抽帧计划：决定抽几帧、几行几列、取第几帧。
 * @param {{animatedFrames:number, frameLongEdge:number, maxTiles?:number}} opts
 */
export function planSheetTiles({ animatedFrames, frameLongEdge = 0, maxTiles = SHEET_MAX_TILES } = {}) {
  const total = Math.max(0, Math.floor(Number(animatedFrames) || 0));
  if (total < 2) return null;
  const cap = Math.max(2, Math.min(SHEET_MAX_TILES, Math.floor(Number(maxTiles) || SHEET_MAX_TILES)));
  const long = Number(frameLongEdge) || 0;
  const want = long >= 512
    ? Math.min(total, cap, 4)
    : total >= 30
      ? Math.min(total, cap, 9)
      : Math.min(total, cap, 6);
  const samples = pickSampleIndices(total, want); // 0 基，给 ffmpeg 用
  const tiles = samples.length;
  const { cols, rows } = pickSheetGrid(tiles);
  const sampled = samples.map((i) => i + 1); // 1 基，给模型看的"第几帧"
  return { total, tiles, cols, rows, step: tiles > 1 ? Math.max(1, Math.round((total - 1) / (tiles - 1))) : 1, samples, sampled };
}

/**
 * 把动图拼成一张"联系表"（网格拼图），让模型能看到多个时间点。
 *
 * @returns {Promise<{ok:true, buffer:Buffer, mimeType:'image/jpeg', width:number|null, height:number|null,
 *                    frames:number, tiles:number, cols:number, rows:number, step:number, sampled:number[],
 *                    tileEdge:number, originalBytes:number, bytes:number} | {ok:false, error:string}>}
 */
export async function contactSheetBuffer(buffer, {
  mimeType = 'image/gif',
  animatedFrames = 0,
  maxTiles = SHEET_MAX_TILES,
  maxEdge = SHEET_MAX_EDGE,
  qscale = DOWNSCALE_QSCALE,
  ffmpegPath = null,
  timeoutMs = DOWNSCALE_TIMEOUT_MS,
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, error: '空图片' };
  const total = Math.floor(Number(animatedFrames) || 0);
  if (total < 2) return { ok: false, error: `不是动图或帧数不可用（${animatedFrames}）` };
  const ffmpeg = resolveFfmpeg({ ffmpegPath });
  const srcExt = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : mimeType === 'image/gif' ? '.gif' : '.jpg';
  const src = tmpPath(srcExt);
  const dst = tmpPath('.jpg');
  try {
    fs.writeFileSync(src, buffer);
    // 首帧尺寸决定每格能有多大（tile 要求所有格子等大，同一段视频流的每帧本来就等大）。
    const frameSize = await probeImageSize(src, { ffmpegPath, timeoutMs: 15_000 });
    const frameLongEdge = Math.max(frameSize?.width || 0, frameSize?.height || 0);
    const plan = planSheetTiles({ animatedFrames: total, frameLongEdge, maxTiles });
    if (!plan) return { ok: false, error: '帧数不足 2' };
    // 每格边长：不放大（取原帧长边），且整张宽高都不超过 maxEdge。JPEG 要求偶数边。
    // 用 max(cols,rows) 封顶：竖构图动图（例如 568x1011）按列数封顶会算出 2046px 高的拼图。
    const capBySheet = Math.floor(Math.max(64, maxEdge) / Math.max(plan.cols, plan.rows));
    let tileEdge = Math.min(frameLongEdge || capBySheet, capBySheet);
    tileEdge = Math.max(2, tileEdge - (tileEdge % 2));
    // 用显式帧号列表抽帧（eq(n,0)+eq(n,4)+…），而不是固定步长 select：
    // 固定步长在"9 帧抽 6 帧"这类情况下会把末帧重复取两次；显式列表不会。
    // 表达式整体用单引号包住，filtergraph 就不会把里面的逗号当成滤镜分隔符。
    // 最后再套一层 scale：极端长宽比的拼图（很瘦很高的动图）也要压到 maxEdge 以内。
    // -2 让缩放后高度取偶数（JPEG 的 yuvj420p 不接受奇数边）。
    const selectExpr = plan.samples.map((i) => `eq(n,${i})`).join('+');
    const vf = `select='${selectExpr}',scale=${tileEdge}:-2:flags=lanczos,`
      + `tile=${plan.cols}x${plan.rows}:padding=6:margin=6:color=white,`
      + `scale='min(${Math.max(64, maxEdge)},iw)':'min(${Math.max(64, maxEdge)},ih)':`
      + 'force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos';
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', src,
      '-vf', vf,
      '-frames:v', '1',
      '-q:v', String(qscale),
      '-f', 'image2',
      dst, '-y',
    ];
    const r = await run(ffmpeg, args, timeoutMs);
    if (!r.ok) return { ok: false, error: r.error };
    let out;
    try { out = fs.readFileSync(dst); } catch (error) { return { ok: false, error: `读不到输出：${error?.message ?? error}` }; }
    if (!out.length) return { ok: false, error: '输出为空' };
    const size = await probeImageSize(dst, { ffmpegPath, timeoutMs: 15_000 });
    return {
      ok: true,
      buffer: out,
      mimeType: 'image/jpeg',
      width: size?.width ?? null,
      height: size?.height ?? null,
      frames: plan.total,
      tiles: plan.tiles,
      cols: plan.cols,
      rows: plan.rows,
      step: plan.step,
      sampled: plan.sampled,
      tileEdge,
      originalBytes: buffer.length,
      bytes: out.length,
    };
  } finally {
    for (const f of [src, dst]) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}
