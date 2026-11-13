// atSelf 回归（2026-11-01 定稿，2026-11-11 落地）
//
// 背景：10-24 修过「@ 了却要等两分钟才回」，修法是给 appendSocialV2Message 落 atSelf 字段，
// 让 qq_wait_for_messages 的 directedSince() 能打断 quiet 窗口立刻返回。
//
// 但那次反向合并 hunk 落错了函数：appendSocialV2Message 签名收了 atSelf、msg 字面量里却没有，
// 参数被静默丢弃 —— directedSince() 永远拿到 undefined，@ 短路一次都没生效
// （实测 state/social-v2.json 里 169 条 recentMessages，含 atSelf 字段的 0 条）。
// 同时不该动的 v1 路径 appendRecentMessage 反被塞进一行 atSelf，而它签名里根本没这个参数。
//
// 这个坑的形态是「签名有、函数体没用」—— 光看函数签名完全正常，所以必须钉住三件事：
//   ① 签名收 atSelf  ② msg 字面量真的写进去  ③ 判断逻辑真的读它
// 本测试就是这三条的守门人，改任何一处都会红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const SRC = readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');

/** 从源码里切出一个函数的完整文本（到下一个顶层 `  function` / `  async function` 为止）。 */
function sliceFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const after = src.slice(start + 1);
  const idx = after.search(/\n  (?:async )?function /);
  return idx < 0 ? src.slice(start) : src.slice(start, start + 1 + idx);
}

test('静态：appendSocialV2Message 签名收 atSelf', () => {
  const body = sliceFunction(SRC, 'appendSocialV2Message');
  assert.ok(body, '找不到 appendSocialV2Message，源码结构可能变了');
  assert.match(
    body,
    /function appendSocialV2Message\([^)]*\batSelf = false\b/,
    'appendSocialV2Message 签名必须收 atSelf 参数（默认 false）'
  );
});

test('静态：appendSocialV2Message 的 msg 字面量真的落 atSelf（10-24 就漏在这里）', () => {
  const body = sliceFunction(SRC, 'appendSocialV2Message');
  assert.ok(body, '找不到 appendSocialV2Message');
  // 用 `atSelf: !!atSelf` 而不是裸 `atSelf` 匹配：注释里也提到了 @，裸匹配会被注释骗过。
  assert.match(
    body,
    /atSelf:\s*!!atSelf/,
    'appendSocialV2Message 的 msg 对象必须写 atSelf: !!atSelf —— 只收参数不落库等于没修'
  );
});

test('静态：v1 的 appendRecentMessage 也收且落 atSelf', () => {
  const body = sliceFunction(SRC, 'appendRecentMessage');
  assert.ok(body, '找不到 appendRecentMessage');
  assert.match(
    body,
    /function appendRecentMessage\([^)]*\batSelf = false\b/,
    'appendRecentMessage 签名必须收 atSelf（否则函数体里用它就是 ReferenceError）'
  );
  assert.match(body, /atSelf:\s*!!atSelf/, 'appendRecentMessage 的 msg 对象必须写 atSelf');
});

test('静态：directedSince 真的读 atSelf（否则落库了也没人用）', () => {
  assert.match(
    SRC,
    /m\.atSelf === true\s*\|\|\s*m\.quoteTargetIsSelf === true/,
    'directedSince 必须同时认 atSelf 与 quoteTargetIsSelf'
  );
});

test('静态：atSelfNow 的声明在第一次使用之前', () => {
  const decl = SRC.indexOf('const atSelfNow =');
  assert.ok(decl > 0, '找不到 const atSelfNow = 声明');
  // 第一处消费点：补拉分支里的 appendSocialV2Message 调用。
  const firstUse = SRC.indexOf('appendSocialV2Message(key, sender, textContent, plainContent, quoteTargetIsSelf, isOwner, event.message_id');
  assert.ok(firstUse > 0, '找不到 appendSocialV2Message 的调用点');
  assert.ok(
    decl < firstUse,
    'atSelfNow 必须在 appendSocialV2Message 调用之前声明（TDZ / 未定义会静默传 undefined）'
  );
});

test('行为：@ 的消息落库后 atSelf === true', async () => {
  const h = await bridgeHarness({ config: { allow: { private: ['123'], groups: ['456'] } } });
  try {
    h.appendSocialV2Message(
      'group:456', '张三', '@小鲸鱼 在吗', '@小鲸鱼 在吗',
      false, false, 555001, [], 10001, [], true, 0
    );
    const st = h.getSocialV2State('group:456');
    const m = st.recentMessages.at(-1);
    assert.ok(m, '消息应已进入上文');
    assert.equal(m.atSelf, true, '@ 的消息必须 atSelf=true，否则 directedSince 短路失效');
  } finally { await h.close(); }
});

test('行为：普通消息也带 atSelf 字段（存在且为 false，不能缺字段）', async () => {
  const h = await bridgeHarness({ config: { allow: { private: ['123'], groups: ['456'] } } });
  try {
    h.appendSocialV2Message(
      'group:456', '李四', '今天天气不错', '今天天气不错',
      false, false, 555002, [], 10002, [], false, 0
    );
    const st = h.getSocialV2State('group:456');
    const m = st.recentMessages.at(-1);
    assert.ok(m, '消息应已进入上文');
    assert.ok('atSelf' in m, '字段必须存在 —— 缺字段和 false 在 JSON 里长得一样，但代码路径不同');
    assert.equal(m.atSelf, false);
  } finally { await h.close(); }
});
