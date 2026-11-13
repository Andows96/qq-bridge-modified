// Two questions:
//  1) does the bridge detect GIF mime correctly? (if not, GIFs get mislabeled JPEG)
//  2) does the downscale path flatten an animated GIF into a single-frame JPEG?
import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { downscaleImageBuffer } from '../src/image-downscale.js'
import { looksLikeImageBuffer } from '../src/safe-fetch.js'

const FF = process.env.FFMPEG_PATH || 'E:/ffmpeg-9.0-essentials_build/bin/ffmpeg.exe'
const TMP = mkdtempSync(path.join(tmpdir(), 'qq-giftest-'))
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }) } catch {} })

// --- mimeFromBuffer 的行为（从 bridge.js 复制其逻辑要点） ---
const bridgeSrc = readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8')
const mimeFnStart = bridgeSrc.indexOf('function mimeFromBuffer')
console.log('=== bridge.js 的 mimeFromBuffer 实现 ===')
console.log(bridgeSrc.slice(mimeFnStart, mimeFnStart + 520).split('\n').map((l) => '  ' + l).join('\n'))

// --- 生成一个真·动图 GIF（多帧） ---
const gif = path.join(TMP, 'anim.gif')
execFileSync(FF, [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc=size=600x600:duration=2:rate=10',
  '-vf', 'fps=10,scale=600:600',
  gif, '-y',
], { stdio: 'pipe' })
const gifBuf = readFileSync(gif)
const head = gifBuf.toString('ascii', 0, 6)
console.log(`\n=== 生成的动图 ===`)
console.log(`  魔数: ${JSON.stringify(head)}  大小: ${(gifBuf.length / 1024).toFixed(0)} KB`)

// 统计 GIF 帧数（粗略：数 image descriptor 0x2C 之前的 graphic control extension 0x21 0xF9）
let frames = 0
for (let i = 0; i < gifBuf.length - 1; i++) {
  if (gifBuf[i] === 0x21 && gifBuf[i + 1] === 0xf9) frames++
}
console.log(`  帧数（按 Graphic Control Extension 计）: ${frames}`)

console.log(`\n=== 1) looksLikeImageBuffer 认不认它 ===`)
console.log(`  ${looksLikeImageBuffer(gifBuf) ? '✅ 认（接受为图片）' : '❌ 不认'}`)

console.log(`\n=== 2) 缩图路径会不会破坏动图 ===`)
// 造一个超过阈值的动图，逼缩图路径介入
const bigGif = path.join(TMP, 'anim-big.gif')
execFileSync(FF, [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc=size=1200x1200:duration=3:rate=15',
  '-vf', 'fps=15,scale=1200:1200',
  bigGif, '-y',
], { stdio: 'pipe' })
const bigBuf = readFileSync(bigGif)
console.log(`  大动图: ${(bigBuf.length / 1024 / 1024).toFixed(2)} MB`)

const trig = 1 * 1024 * 1024
if (bigBuf.length > trig) {
  const r = await downscaleImageBuffer(bigBuf, { mimeType: 'image/gif', ffmpegPath: FF })
  if (!r.ok) {
    console.log(`  ❌ 缩图失败（调用方会回退原图，动图原样送给 DSH）: ${r.error}`)
    process.exitCode = 1
  } else {
    console.log(`  输出: ${(r.bytes / 1024).toFixed(0)} KB  mimeType=${r.mimeType}  ${r.width}x${r.height}`)
    const magic = r.buffer.toString('ascii', 0, 6)
    console.log(`  输出魔数: ${JSON.stringify(magic)}`)
    const isJpeg = r.buffer[0] === 0xff && r.buffer[1] === 0xd8
    console.log(`  ${isJpeg ? '✅ 缩图成功（动图按首帧转 JPEG —— 视觉模型本来也只能看首帧）' : '⚠️ 输出不是 JPEG'}`)
    console.log(`  压缩: ${(bigBuf.length / 1024).toFixed(0)} KB → ${(r.bytes / 1024).toFixed(0)} KB（${(bigBuf.length / r.bytes).toFixed(1)}x）`)
  }
} else {
  console.log(`  （大动图只有 ${(bigBuf.length / 1024).toFixed(0)} KB，未达阈值，不会走缩图）`)
}

// --- 回归：静态图仍然正常（加了 -frames:v 1 不该影响它们） ---
console.log('\n=== 回归：静态格式是否仍正常 ===')
const cases = [
  ['静态 JPEG', ['-f', 'lavfi', '-i', 'testsrc=size=2400x1800:duration=1', '-frames:v', '1', '-q:v', '2'], 'a.jpg', 'image/jpeg'],
  ['静态 PNG(带alpha)', ['-f', 'lavfi', '-i', 'testsrc=size=2400x1800:duration=1', '-frames:v', '1', '-pix_fmt', 'rgba'], 'a.png', 'image/png'],
]
for (const [label, args, name, mime] of cases) {
  const f = path.join(TMP, name)
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', ...args, f, '-y'], { stdio: 'pipe' })
  const buf = readFileSync(f)
  const r = await downscaleImageBuffer(buf, { mimeType: mime, ffmpegPath: FF, triggerBytes: 0 })
  const ok = r.ok && r.buffer[0] === 0xff && r.buffer[1] === 0xd8 && r.width > 0
  if (!ok) process.exitCode = 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${(buf.length / 1024).toFixed(0)} KB → ${r.ok ? (r.bytes / 1024).toFixed(0) + ' KB ' + r.width + 'x' + r.height : r.error}`)
}

console.log(`\n=== 判定 ===\n${process.exitCode ? '❌ 有失败项' : '✅ 全部通过'}`)
