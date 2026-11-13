// 动图识别模块测试：
//   1) 合成样本（纯 JS 构造 GIF/PNG/APNG/WebP/JPEG 头尾，不依赖 ffmpeg）
//   2) 真实文件交叉验证：拿本机 QQ 表情缓存里 Pillow 判定过 is_animated/n_frames 的
//      1678 张图（含 434 张动图）当基准，逐张对比，验证“不靠扩展名、只按字节判定”。
import { readFileSync, existsSync } from 'node:fs'
import { detectAnimatedImage, describeAnimation } from '../src/image-animation.js'

let pass = true
const check = (label, ok, detail = '') => {
  if (!ok) pass = false
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? '  ' + detail : ''}`)
}

// ---------- 合成样本构造 ----------
function gifBuffer(frames) {
  const parts = [
    Buffer.from('GIF89a', 'latin1'),
    Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]), // 1x1，带全局调色板
    Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff, 0xff]),       // 2 色调色板
    Buffer.from([0x21, 0xff, 0x0b]),                          // NETSCAPE2.0 循环扩展
    Buffer.from('NETSCAPE2.0', 'latin1'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ]
  for (let i = 0; i < frames; i += 1) {
    parts.push(Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])) // 图像描述符
    parts.push(Buffer.from([0x02, 0x02, 0x44, 0x01, 0x00]))                              // LZW 数据 + 结束
  }
  parts.push(Buffer.from([0x3b])) // trailer
  return Buffer.concat(parts)
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4) // 假 CRC：识别只看块结构
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc])
}

function pngBuffer({ apngFrames = 0 } = {}) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const out = [sig, pngChunk('IHDR', ihdr)]
  if (apngFrames) {
    const actl = Buffer.alloc(8)
    actl.writeUInt32BE(apngFrames, 0)
    out.push(pngChunk('acTL', actl))
  }
  out.push(pngChunk('IDAT', Buffer.alloc(6)))
  out.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(out)
}

function riffChunk(fourcc, payload) {
  const head = Buffer.alloc(8)
  head.write(fourcc, 0, 'latin1')
  head.writeUInt32LE(payload.length, 4)
  const pad = payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
  return Buffer.concat([head, payload, pad])
}

function webpBuffer({ animated = false } = {}) {
  const chunks = []
  if (animated) {
    const vp8x = Buffer.alloc(10)
    vp8x[0] = 0x02 // ANIMATION 标志位
    chunks.push(riffChunk('VP8X', vp8x))
    chunks.push(riffChunk('ANIM', Buffer.alloc(6)))
    chunks.push(riffChunk('ANMF', Buffer.alloc(16)))
    chunks.push(riffChunk('ANMF', Buffer.alloc(16)))
  } else {
    chunks.push(riffChunk('VP8 ', Buffer.alloc(10)))
  }
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks])
  const head = Buffer.alloc(8)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

function jpegBuffer() {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20), Buffer.from([0xff, 0xd9])])
}

console.log('=== 1) 合成样本 ===')
{
  const cases = [
    ['静态 GIF（1 帧）', gifBuffer(1), false, 'gif'],
    ['动图 GIF（2 帧）', gifBuffer(2), true, 'gif'],
    ['动图 GIF（5 帧）', gifBuffer(5), true, 'gif'],
    ['静态 PNG', pngBuffer(), false, 'png'],
    ['APNG（acTL 3 帧）', pngBuffer({ apngFrames: 3 }), true, 'png'],
    ['静态 WebP', webpBuffer(), false, 'webp'],
    ['动图 WebP（ANIM+2×ANMF）', webpBuffer({ animated: true }), true, 'webp'],
    ['JPEG', jpegBuffer(), false, 'jpeg'],
  ]
  for (const [label, buf, wantAnim, wantFormat] of cases) {
    const r = detectAnimatedImage(buf)
    check(label, r.animated === wantAnim && r.format === wantFormat,
      `→ animated=${r.animated} format=${r.format} frames=${r.frames} ${r.animated ? '(' + describeAnimation(r) + ')' : ''}`)
  }
}

console.log('\n=== 2) 异常输入不抛异常、按静态处理 ===')
{
  const junk = [
    ['null', null],
    ['undefined', undefined],
    ['空 buffer', Buffer.alloc(0)],
    ['3 字节', Buffer.from([0xff, 0xd8, 0xff])],
    ['非图片文本', Buffer.from('hello world, not an image at all')],
    ['截断的 GIF 头', Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x01, 0x00, 0x00])])],
    ['Uint8Array', new Uint8Array(gifBuffer(3))],
  ]
  for (const [label, input] of junk) {
    let ok = true
    let detail = ''
    try {
      const r = detectAnimatedImage(input)
      detail = `animated=${r.animated} format=${r.format}`
      ok = r.animated === (label === 'Uint8Array') // 只有真动图的 Uint8Array 才算动图
    } catch (error) {
      ok = false
      detail = `抛异常: ${error?.message ?? error}`
    }
    check(label, ok, detail)
  }
}

console.log('\n=== 3) 真实文件交叉验证（基准：Pillow is_animated/n_frames）===')
const JSON_PATH = process.env.QQ_EMOJI_SCAN || '<workspace>/imgtest/qq-emoji-scan.json'
if (!existsSync(JSON_PATH)) {
  console.log(`  ⚠️ 跳过：找不到基准文件 ${JSON_PATH}（先跑 scan-qq-emoji.py 生成）`)
} else {
  const rows = JSON.parse(readFileSync(JSON_PATH, 'utf8')).filter((r) => !r.error && existsSync(r.path))
  let animatedTotal = 0
  let staticTotal = 0
  const mismatches = []
  const frameMismatch = []
  for (const row of rows) {
    const buf = readFileSync(row.path)
    const r = detectAnimatedImage(buf)
    if (row.is_animated) {
      animatedTotal += 1
      if (!r.animated) mismatches.push({ path: row.path, pillow: `anim ${row.format} ${row.n_frames}f`, js: `${r.format}/${r.evidence}` })
      else if (r.frames && r.format === 'gif' && r.frames !== row.n_frames) {
        frameMismatch.push({ path: row.path, pillow: row.n_frames, js: r.frames })
      }
    } else {
      staticTotal += 1
      if (r.animated) mismatches.push({ path: row.path, pillow: `static ${row.format}`, js: `${r.format}/${r.evidence}` })
    }
  }
  console.log(`  基准：${rows.length} 张（动图 ${animatedTotal} / 静态 ${staticTotal}）`)
  check('动图/静态判定零误判', mismatches.length === 0, `${mismatches.length} 处不一致`)
  for (const m of mismatches.slice(0, 10)) console.log(`     ✗ ${m.path}\n        Pillow: ${m.pillow}  JS: ${m.js}`)
  check('GIF 帧数与 Pillow 完全一致', frameMismatch.length === 0, `${frameMismatch.length} 处不一致`)
  for (const m of frameMismatch.slice(0, 5)) console.log(`     ✗ ${m.path}  Pillow ${m.pillow} 帧 vs JS ${m.js} 帧`)
  const anim = rows.filter((r) => r.is_animated)
  if (anim.length) {
    const sample = anim[0]
    const r = detectAnimatedImage(readFileSync(sample.path))
    console.log(`  样例：${describeAnimation(r)}  ←  ${sample.path.split('\\').pop()}`)
  }
}

console.log(`\n${pass ? '全部通过 ✅' : '存在失败项 ❌'}`)
process.exit(pass ? 0 : 1)
