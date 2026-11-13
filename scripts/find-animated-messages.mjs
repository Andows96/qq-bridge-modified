// 找出会话里"最近带动图媒体"的消息，用于验证联系表端到端链路。
import fs from 'node:fs';
import path from 'node:path';
import { detectAnimatedImage } from '../src/image-animation.js';

const STATE = 'state/social-v2.json';
const EMOJI_ROOT = 'C:/Users/<user>/Documents/Tencent Files/<QQ>/nt_qq/nt_data/Emoji';

const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));

// 建索引：文件名 → 完整路径（QQ 用内容 MD5 做文件名，可能出现同名多份）
const index = new Map();
function walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth + 1);
    else if (!index.has(e.name.toLowerCase())) index.set(e.name.toLowerCase(), full);
  }
}
walk(EMOJI_ROOT);

const rows = [];
for (const [key, conv] of Object.entries(state.conversations || {})) {
  for (const m of conv.recentMessages || []) {
    if (!Array.isArray(m?.media) || !m.media.length) continue;
    for (const media of m.media) {
      const file = String(media?.file || '');
      if (!file) continue;
      const full = index.get(path.basename(file).toLowerCase());
      if (!full) continue;
      let buf;
      try { buf = fs.readFileSync(full); } catch { continue; }
      const info = detectAnimatedImage(buf);
      if (!info.animated) continue;
      rows.push({
        key,
        seq: m.seq,
        messageId: m.messageId,
        sender: m.sender,
        kind: media.kind,
        file: path.basename(full),
        size: buf.length,
        format: info.format,
        frames: info.frames,
        at: new Date(Number(m.time) || 0).toISOString(),
      });
    }
  }
}

rows.sort((a, b) => (b.at > a.at ? 1 : -1));
console.log(`带动图的消息共 ${rows.length} 条，最近 12 条：`);
for (const r of rows.slice(0, 12)) {
  console.log(`  ${r.at} ${r.key.padEnd(20)} seq=${String(r.seq).padEnd(4)} id=${String(r.messageId).padEnd(12)} ${r.kind.padEnd(7)} ${r.format.toUpperCase().padEnd(4)} ${String(r.frames).padStart(4)} 帧 ${(r.size / 1024).toFixed(0)}KB ${r.file}`);
}
fs.writeFileSync('state/_anim-candidates.json', JSON.stringify(rows.slice(0, 12), null, 2), 'utf8');
console.log('\n（写入 state/_anim-candidates.json）');
