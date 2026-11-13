// 动图收藏拦截（2026-11-13 合并自 0.2.1-r1 fork）：
//   QQ 的 add_custom_face 只吃一帧静态图，动图收进去等于压成首帧 —— 必须整条拒绝，不能"降级收藏"。
//   判定在字节层（media-normalize 的 sniffImage），发生在 add_custom_face 之前，失败不留副作用。
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const KEY = 'group:456';
const CONSOLE_TOKEN = 'fixture-console-token';

// 2 帧的合法 GIF（111 字节，Pillow 生成并验证 n_frames=2）：足够让 sniffImage 数出 frames=2。
const GIF_BASE64 = 'R0lGODlhAgACAIEAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBCgABACwAAAAAAgACAIH///8AAAAAAAAAAAAIBgABCAQQEAA7';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=';

const seedFiles = () => ({
  'state/social-v2.json': JSON.stringify({
    paused: {},
    conversations: {
      [KEY]: {
        recentMessages: [
          {
            seq: 7,
            messageId: '-9001',
            sender: '群友',
            text: '',
            time: Date.now(),
            media: [{ kind: 'image', file: 'fixture-anim.gif', url: '' }]
          }
        ]
      }
    }
  })
});

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}\n     ${error?.message ?? error}`); }
}

function post(server, pathname, body, agentToken) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: pathname,
      method: 'POST',
      headers: {
        'x-console-token': CONSOLE_TOKEN,
        'x-agent-call': '1',
        ...(agentToken ? { 'x-agent-token': agentToken } : {}),
        'content-type': 'application/json'
      }
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('fixture request timed out')));
    req.end(JSON.stringify(body));
  });
}

await test('动图表情被拒绝收藏（不落 add_custom_face）', async () => {
  const h = await bridgeHarness({ files: seedFiles(), imageBase64: GIF_BASE64 });
  try {
    h.setMode('reserved2');
    h.setReady(true);
    const server = h.startConsoleServer();
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    const token = h.getSocialV2State(KEY).agentToken;
    const res = await post(server, '/api/socialV2/collect-sticker', { key: KEY, messageId: '7' }, token);
    const logText = (() => { try { return fs.readFileSync(path.join(h.temp, 'state/bridge.log'), 'utf8'); } catch { return '(no log)'; } })();
    // 500 的响应体是脱敏后的通用文案，真正的原因只在本地日志里 —— 这正是生产行为。
    assert.equal(res.status, 500, `应回 500，实际 ${res.status}：${res.text}`);
    assert.match(logText, /拒绝收藏动图表情/, `日志里应有拒绝记录，实际：\n${logText.slice(-800)}`);
    assert.doesNotMatch(logText, /\[sticker\] AI 收藏表情 group:456:/, '不能出现"收藏成功"的日志');
  } finally { await h.close(); }
});

await test('静态图仍然可以收藏（守卫不误伤）', async () => {
  const h = await bridgeHarness({ files: seedFiles(), imageBase64: PNG_1PX });
  try {
    h.setMode('reserved2');
    h.setReady(true);
    const server = h.startConsoleServer();
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    const token = h.getSocialV2State(KEY).agentToken;
    const res = await post(server, '/api/socialV2/collect-sticker', { key: KEY, messageId: '7' }, token);
    const logText = (() => { try { return fs.readFileSync(path.join(h.temp, 'state/bridge.log'), 'utf8'); } catch { return '(no log)'; } })();
    assert.equal(res.status, 200, `静态图应收藏成功，实际 ${res.status}：${res.text}\n--- log ---\n${logText.slice(-800)}`);
    assert.equal(res.json?.ok, true);
  } finally { await h.close(); }
});

console.log(`\n${failures ? 'FAILED' : 'ALL PASS'}  failures=${failures}`);
process.exit(failures ? 1 : 0);
