// Test the downscale module against a 3072x4536 JPEG of the same size as the image
// that failed, plus edge cases (small image untouched, PNG with alpha, bad input).
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  downscaleImageBuffer, probeImageSize, formatImageBytes,
  DOWNSCALE_TRIGGER_BYTES, DOWNSCALE_TARGET_EDGE,
} from '../src/image-downscale.js'

// 自建临时目录：早先这里硬编码 <workspace>/imgtest，一旦被清理掉测试就整体失败。
const TMP = mkdtempSync(path.join(tmpdir(), 'qq-imgtest-'))
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }) } catch {} })

// ffmpeg 位置：优先环境变量，其次本机已知路径，最后交给 PATH。
const FF = process.env.FFMPEG_PATH || 'E:/ffmpeg-9.0-essentials_build/bin/ffmpeg.exe'
const ffmpegPath = FF

function gen(args, out) {
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', ...args, out, '-y'], { stdio: 'pipe' })
  return readFileSync(out)
}

let pass = true
const check = (label, ok, detail = '') => {
  if (!ok) pass = false
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? '  ' + detail : ''}`)
}

console.log(`阈值 ${formatImageBytes(DOWNSCALE_TRIGGER_BYTES)} / 目标长边 ${DOWNSCALE_TARGET_EDGE}px\n`)

// --- 1) 真实规格的大图（与失败那张同尺寸） ---
console.log('=== 1) 3072x4536 大图（模拟失败那张）===')
const big = gen(['-f', 'lavfi', '-i', 'testsrc=size=3072x4536:duration=1', '-frames:v', '1', '-q:v', '2'], `${TMP}/t-big.jpg`)
console.log(`  原始: ${formatImageBytes(big.length)}`)
{
  const r = await downscaleImageBuffer(big, { mimeType: 'image/jpeg', ffmpegPath })
  check('缩图成功', r.ok, r.ok ? '' : r.error)
  if (r.ok) {
    console.log(`  结果: ${formatImageBytes(r.bytes)}  ${r.width}x${r.height}  ${r.mimeType}`)
    check('长边不超过目标', Math.max(r.width, r.height) <= DOWNSCALE_TARGET_EDGE, `实际 ${Math.max(r.width, r.height)}`)
    check('比例保持不变', Math.abs((r.width / r.height) - (3072 / 4536)) < 0.02, `${(r.width / r.height).toFixed(3)} vs ${(3072 / 4536).toFixed(3)}`)
    check('体积确实变小', r.bytes < r.originalBytes, `${formatImageBytes(r.originalBytes)} → ${formatImageBytes(r.bytes)}`)
    check('仍是合法 JPEG', r.buffer[0] === 0xff && r.buffer[1] === 0xd8)
    // 关键：base64 的规模是否降到安全区
    console.log(`  base64 规模: ${(big.length * 4 / 3 / 1024 / 1024).toFixed(2)}MB → ${(r.bytes * 4 / 3 / 1024 / 1024).toFixed(2)}MB`)
  }
}

// --- 2) 小图应原样直通（调用方按阈值判断，这里验证阈值语义） ---
console.log('\n=== 2) 小图（应低于阈值，调用方不缩）===')
const small = gen(['-f', 'lavfi', '-i', 'testsrc=size=320x240:duration=1', '-frames:v', '1'], `${TMP}/t-small.jpg`)
console.log(`  体积: ${formatImageBytes(small.length)}`)
check('小于触发阈值', small.length < DOWNSCALE_TRIGGER_BYTES)

// --- 3) 带透明通道的 PNG ---
console.log('\n=== 3) 带 alpha 的 PNG（应转成 RGB JPEG 不黑底）===')
const png = gen(['-f', 'lavfi', '-i', 'testsrc=size=2400x1800:duration=1', '-frames:v', '1', '-pix_fmt', 'rgba'], `${TMP}/t-alpha.png`)
console.log(`  原始 PNG: ${formatImageBytes(png.length)}（${png[0] === 0x89 ? '合法 PNG' : '非 PNG'}）`)
{
  const r = await downscaleImageBuffer(png, { mimeType: 'image/png', ffmpegPath })
  check('缩图成功', r.ok, r.ok ? '' : r.error)
  if (r.ok) {
    console.log(`  结果: ${formatImageBytes(r.bytes)}  ${r.width}x${r.height}  ${r.mimeType}`)
    check('输出为 JPEG', r.mimeType === 'image/jpeg' && r.buffer[0] === 0xff && r.buffer[1] === 0xd8)
  }
}

// --- 4) 异常输入不得抛出 ---
console.log('\n=== 4) 异常输入（必须优雅失败，不能抛）===')
for (const [label, input, opts] of [
  ['空 buffer', Buffer.alloc(0), {}],
  ['非图片字节', Buffer.from('这不是图片，只是文本'), {}],
  ['null', null, {}],
]) {
  try {
    const r = await downscaleImageBuffer(input, { ffmpegPath, ...opts })
    check(`${label} → 返回 ok:false 而不是抛异常`, r.ok === false, r.error ? `(${String(r.error).slice(0, 60)})` : '')
  } catch (e) {
    check(`${label} → 不应抛异常`, false, `抛了: ${e.message}`)
  }
}

// --- 5) ffmpeg 真的不可用时的行为 ---
// 注意：'ffmpeg' 裸名在本机**能**解析（voice 功能在用真实 ffmpeg），所以先前用
// ffmpegPath: 'Z:/nonexistent/ffmpeg.exe' 的写法并没有真正模拟"不可用"——
// resolveFfmpeg 会回退到 PATH 上的 ffmpeg 并成功。这里用空 PATH 真正断掉它。
console.log('\n=== 5) ffmpeg 不可用（回退而非崩溃）===')
{
  const savedPath = process.env.PATH
  const savedFf = process.env.FFMPEG_PATH
  process.env.PATH = 'Z:/nonexistent'
  delete process.env.FFMPEG_PATH
  try {
    const r = await downscaleImageBuffer(big, { mimeType: 'image/jpeg', timeoutMs: 8000 })
    check('返回 ok:false 让调用方回退原图', r.ok === false, r.error ? `(${String(r.error).slice(0, 70)})` : '')
  } finally {
    process.env.PATH = savedPath
    if (savedFf !== undefined) process.env.FFMPEG_PATH = savedFf
  }
}

console.log(`\n=== 判定 ===\n${pass ? '✅ 全部通过' : '❌ 有失败项'}`)
process.exit(pass ? 0 : 1)
