/**
 * 动图（多帧图片）识别 —— 纯 JS 解析容器结构，不依赖 ffmpeg / ffprobe / 外部库。
 *
 * 为什么要自己判：QQ 客户端把 GIF 存成 .jpg / .png 扩展名（本机实测 1678 张表情里
 * 434 张是动图，其中大量文件名是 .jpg），所以既不能按扩展名也不能按 mime 猜，
 * 必须看字节。
 *
 * 用在哪：QQ 的 add_custom_face（收藏表情）只吃静态图。桥接在图片超过阈值时会走
 * image-downscale，而那条路径用 ffmpeg `-frames:v 1` 只取首帧并输出 JPEG —— 动图
 * 一旦经过降采样，动图信息就没了，收藏进 QQ 只会得到一张“死掉”的静态帧。因此
 * 收藏前必须**在降采样之前**用原始字节判定，是动图就直接拒绝收藏。
 *
 * 支持：GIF（多帧）、APNG（acTL）、动图 WebP（VP8X ANIM + ANMF）、JPEG（永不动图）。
 * 结构异常一律按静态处理并返回 format='unknown'，绝不抛异常。
 */

const STATIC_UNKNOWN = Object.freeze({ animated: false, format: 'unknown', frames: null, evidence: 'unrecognized' });

/** 把各种二进制入参统一成 Buffer 视图；不复制数据。 */
function asView(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  return null;
}

function hasAscii(buf, offset, text) {
  if (offset + text.length > buf.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(buf) {
  if (buf.length < 16) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buf[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function isGif(buf) {
  return buf.length >= 13 && (hasAscii(buf, 0, 'GIF87a') || hasAscii(buf, 0, 'GIF89a'));
}

function isWebp(buf) {
  return buf.length >= 16 && hasAscii(buf, 0, 'RIFF') && hasAscii(buf, 8, 'WEBP');
}

function isJpeg(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** APNG：acTL 块（必须在 IDAT 之前）出现即为多帧。 */
function detectPng(buf) {
  let off = 8;
  let guard = 0;
  while (off + 8 <= buf.length && guard < 4096) {
    guard += 1;
    const dataLen = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'acTL') {
      const frames = dataLen >= 4 && off + 12 <= buf.length ? buf.readUInt32BE(off + 8) : null;
      return { animated: true, format: 'png', frames, evidence: 'acTL (APNG)' };
    }
    // acTL 必须出现在 IDAT 之前；到这里就说明是普通 PNG 了。
    if (type === 'IDAT' || type === 'IEND') break;
    if (dataLen > buf.length) break;
    off += 12 + dataLen;
  }
  return { animated: false, format: 'png', frames: 1, evidence: 'static png' };
}

/** GIF：数图像描述符（0x2C）个数，>1 即动图。 */
function detectGif(buf) {
  let off = 6;
  if (off + 7 > buf.length) return { animated: false, format: 'gif', frames: null, evidence: 'truncated gif' };
  const packed = buf[off + 4];
  off += 7;
  if (packed & 0x80) off += 3 * (1 << ((packed & 0x07) + 1)); // 全局调色板
  let frames = 0;
  let sawLoopExt = false;
  let guard = 0;
  while (off < buf.length && guard < 200000) {
    guard += 1;
    const marker = buf[off];
    if (marker === 0x3b) break; // trailer
    if (marker === 0x21) {
      // 扩展块：label + 若干子块
      const label = buf[off + 1];
      if (label === 0xff && hasAscii(buf, off + 3, 'NETSCAPE2.0')) sawLoopExt = true;
      off += 2;
      while (off < buf.length) {
        const size = buf[off];
        off += 1 + size;
        if (size === 0) break;
      }
      continue;
    }
    if (marker === 0x2c) {
      frames += 1;
      if (off + 10 > buf.length) break;
      const flags = buf[off + 9];
      off += 10;
      if (flags & 0x80) off += 3 * (1 << ((flags & 0x07) + 1)); // 局部调色板
      off += 1; // LZW 最小码长
      while (off < buf.length) {
        const size = buf[off];
        off += 1 + size;
        if (size === 0) break;
      }
      continue;
    }
    break; // 结构不符，别再猜
  }
  if (frames > 1) {
    return { animated: true, format: 'gif', frames, evidence: `gif frames=${frames}${sawLoopExt ? ' + NETSCAPE2.0' : ''}` };
  }
  return { animated: false, format: 'gif', frames: frames || 1, evidence: 'single-frame gif' };
}

/** 动图 WebP：VP8X 的 ANIMATION 标志位，或存在 ANIM/ANMF 块。 */
function detectWebp(buf) {
  let off = 12;
  let frames = 0;
  let sawAnim = false;
  let animFlag = false;
  let guard = 0;
  while (off + 8 <= buf.length && guard < 4096) {
    guard += 1;
    const fourcc = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (fourcc === 'VP8X') {
      const flags = buf[off + 8];
      if (flags & 0x02) animFlag = true;
    } else if (fourcc === 'ANIM') {
      sawAnim = true;
    } else if (fourcc === 'ANMF') {
      sawAnim = true;
      frames += 1;
    }
    if (size > buf.length) break;
    off += 8 + size + (size % 2); // RIFF 块按偶数字节对齐
  }
  if (animFlag || sawAnim) {
    return {
      animated: true,
      format: 'webp',
      frames: frames || null,
      evidence: `webp animated${animFlag ? ' (VP8X flag)' : ''}${frames ? ` frames=${frames}` : ''}`,
    };
  }
  return { animated: false, format: 'webp', frames: 1, evidence: 'static webp' };
}

/**
 * 判定一张图片是不是动图（多帧）。
 * @param {Buffer|Uint8Array|ArrayBuffer} input 图片原始字节
 * @returns {{animated: boolean, format: string, frames: number|null, evidence: string}}
 */
export function detectAnimatedImage(input) {
  const buf = asView(input);
  if (!buf || buf.length < 12) return { ...STATIC_UNKNOWN };
  try {
    if (isPng(buf)) return detectPng(buf);
    if (isGif(buf)) return detectGif(buf);
    if (isWebp(buf)) return detectWebp(buf);
    if (isJpeg(buf)) return { animated: false, format: 'jpeg', frames: 1, evidence: 'jpeg' };
  } catch {
    // 结构异常（截断/损坏）一律按静态处理，避免误拦正常图片。
  }
  return { ...STATIC_UNKNOWN };
}

/** 生成给日志/错误信息用的一句话描述，如 “GIF 80 帧”“APNG 12 帧”“动图 WebP”。 */
export function describeAnimation(info) {
  if (!info?.animated) return '';
  const name = info.format === 'gif' ? 'GIF' : info.format === 'png' ? 'APNG' : info.format === 'webp' ? '动图 WebP' : '动图';
  return info.frames ? `${name} ${info.frames} 帧` : name;
}
