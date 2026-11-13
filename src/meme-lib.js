// 只读适配 dsh-meme 图库：让 QQ 桥接能用 DSH 的表情包，而不改动 dsh-meme 本体。
//
// 为什么是「只读适配」而不是「调用 dsh-meme」：
//   dsh-meme 在 DSH 进程里跑，它的 send_meme 工具只有两条通道 ——
//   ① companionQq.sendImage(path)（需要 dsh-companion，本机没装，且它只给路径不给会话 ⇒ 多群会串群）
//   ② Web 模式：只吐 `[表情: 描述]` 纯文本，靠前端配图（QQ 里没人配图）
//   所以桥接自己读它的索引、自己发图，是唯一不破坏 L7 安全边界的路子。
//
// 安全边界（这是本文件唯一的硬要求）：
//   **索引库里的 path 字段是不可信输入**。它虽然由 dsh-meme 写入，但 SQLite 文件可被
//   任意本机进程改写；一个 `../../../../etc/passwd` 就能变成本地文件外发通道。
//   因此每条 path 都必须过 safeJoinLibrary（含 realpath 复核，挡 symlink 逃逸），
//   验证失败即丢弃该行，而不是抛错中断整次查询。
//
// 缓存策略：**不缓存任何东西**。
//   dsh-meme 的加图/改图/删图全部同步写 index.db（见其 index.js 的 add/upload/update/delete），
//   所以每次现开现读就能拿到最新状态；反过来缓存 Db 句柄或查询结果会让「刚加的表情看不见」。
//   24 行的开销可以忽略，几百个包也只是一次 readdir + 每个包一次 open。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { safeJoinLibrary } from './voice-core.js';

/** dsh 主目录（dsh-meme 的 memes.js:27 用的同一套规则，含 DSH_MEME_HOME 覆盖）。 */
function dshHome() {
  return process.env.DSH_MEME_HOME || os.homedir();
}

/** dsh-meme 设置文件：`~/.dsh/dsh-expression.json`（升级插件不丢，见其 README）。 */
function settingsFile() {
  return path.join(dshHome(), '.dsh', 'dsh-expression.json');
}

/** 扫描目录默认值，与 dsh-meme 的 memes.js:36-38 一致。 */
function defaultPacksDir() {
  return path.join(dshHome(), '.dsh', 'meme-packs');
}

/**
 * 读 dsh-meme 的设置。任何异常都降级成 `{}`（等价于「全部用默认」），
 * 绝不因为设置文件损坏就让 QQ 侧的列表接口挂掉。
 */
function readSettings() {
  try {
    const text = fs.readFileSync(settingsFile(), 'utf8');
    const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 判断一个目录是不是图库（有 index.db）。 */
function isPackDir(dir) {
  try {
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'index.db'));
  } catch {
    return false;
  }
}

/** 读 manifest.json 的展示信息；没有 manifest 也能当包用（dsh-meme 同样容忍）。 */
function readPackMeta(dir, id, source) {
  let name = id;
  let description = '';
  let version = '';
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (m && m.name) name = String(m.name);
    if (m && m.description) description = String(m.description);
    if (m && m.version) version = String(m.version);
  } catch {
    /* 无 manifest 也能当包用 */
  }
  return { id, name, description, version, path: path.resolve(dir), source };
}

/**
 * 探测 dsh-meme 的**内置**图库目录。
 *
 * 内置包躺在 `~/.dsh/profiles/<profile>/node_modules/dsh-meme/memes/<id>/`，
 * profile 名不是固定的（desktop / web / 用户自建），所以这里扫所有 profile，
 * 而不是写死 `desktop`。额外顺序：
 *   1. 环境变量 DSH_MEME_ROOT（显式指定，最高优先级）
 *   2. 调用方传入的额外目录（config 的 socialV2.meme.bundledDirs）
 *   3. `~/.dsh/profiles/<profile>/node_modules/dsh-meme/memes`
 *
 * 返回 [{ dir, id }]（去重，同 id 只留第一个）。
 * 注意：注释里不要写 `profiles/<星号>/` 这种「星号紧跟斜杠」的路径通配 —— 那两字符
 * 合起来就是块注释的终止符，会把后面的说明文字整段变成代码（本文件初版就踩了，
 * 报错却指向几十行之外的一句 `Unexpected identifier`，极难归因）。
 */
function discoverBundledPackDirs(extraDirs = []) {
  const roots = [];
  if (process.env.DSH_MEME_ROOT) roots.push(process.env.DSH_MEME_ROOT);
  for (const d of Array.isArray(extraDirs) ? extraDirs : []) {
    if (d) roots.push(String(d));
  }
  try {
    const profilesDir = path.join(dshHome(), '.dsh', 'profiles');
    for (const name of fs.readdirSync(profilesDir)) {
      roots.push(path.join(profilesDir, name, 'node_modules', 'dsh-meme', 'memes'));
    }
  } catch {
    /* 没有 profiles 目录就只剩显式来源 */
  }

  const found = [];
  const seenRoots = new Set();
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (seenRoots.has(resolved)) continue;
    seenRoots.add(resolved);
    let names = [];
    try {
      names = fs.readdirSync(resolved);
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = path.join(resolved, name);
      if (isPackDir(dir)) found.push({ dir, id: name });
    }
  }
  return found;
}

/**
 * 扫描可用图库，语义对齐 dsh-meme 的 scanPacks（memes.js:122）：
 *   - 用户包：扫描目录下一层子文件夹（带 index.db）
 *   - 内置包：dsh-meme 包内 memes 目录下的每个子文件夹
 *   - **同 id 时用户目录覆盖内置**（方便自己改官方包）
 *
 * 与上游的差异：上游还容忍「扫描目录本身就是包」「包下嵌套包」两种历史遗留形状
 * （issue #23）。桥接这里只做一层 + 内置，理由是那两种形状本来就是误操作产物，
 * 而桥接多认一层就多一条要审计的路径；真遇到时会表现为「图库为空」，
 * 比悄悄认下一个嵌套目录安全。
 */
export function scanPacks(options = {}) {
  const settings = readSettings();
  const packsDir = path.resolve(String(settings.packsDir || defaultPacksDir()));
  const byId = new Map();

  // 内置包先入，用户包后入即可覆盖同 id（Map.set 覆盖值但保留插入顺序）。
  for (const { dir, id } of discoverBundledPackDirs(options.bundledDirs)) {
    if (!byId.has(id)) byId.set(id, readPackMeta(dir, id, 'bundled'));
  }
  let userNames = [];
  try {
    userNames = fs.readdirSync(packsDir);
  } catch {
    /* 扫描目录不存在 = 只有内置包，这是当前机器的正常状态 */
  }
  for (const name of userNames) {
    const dir = path.join(packsDir, name);
    if (isPackDir(dir)) byId.set(name, readPackMeta(dir, name, 'custom'));
  }
  return [...byId.values()];
}

/**
 * 模型可用的图库 id，语义对齐 dsh-meme 的 enabledPackIds（memes.js:71）：
 *   - 没设置过 `enabledPacks` → **只算当前激活图库**（保持「装完即用」）
 *   - 设置过就以显式列表为准，可同时开多个
 *   - 已删除/已卸载的 id 过滤掉
 *
 * 这一步不能省：「用户在设置页关掉某个图库」是唯一能让桥接停用它图的开关，
 * 忽略它等于把用户的管理操作当空气。
 */
export function enabledPackIds(settings, packs, activeId = '') {
  const saved = Array.isArray(settings.enabledPacks) ? settings.enabledPacks.map(String) : null;
  if (saved === null) return activeId ? [activeId] : [];
  const alive = new Set(packs.map((p) => p.id));
  return saved.filter((id) => alive.has(id));
}

/**
 * 当前「模型可用」的图库列表（已按 enabledPacks 过滤）。
 * activeId 的推导与 dsh-meme 一致：settings.packId，兜底 settings.memeRoot 命中的包。
 */
export function activePacks(options = {}) {
  const settings = readSettings();
  const packs = scanPacks(options);
  let activeId = String(settings.packId || '');
  if (!activeId && settings.memeRoot) {
    const want = path.resolve(String(settings.memeRoot));
    activeId = (packs.find((p) => p.path === want) || {}).id || '';
  }
  // 没有 activeId（用户从没切过图库）时，上游 enabledPackIds 会返回空数组，
  // 但那样桥接就永远「没有图库」——而本机的真实状态正是如此（dsh-expression.json 不存在）。
  // 这里补一条与上游等价的兜底：优先内置包，否则取扫到的第一个。
  if (!activeId) {
    const saved = Array.isArray(settings.enabledPacks) ? settings.enabledPacks.map(String) : null;
    if (saved === null) {
      const bundled = packs.find((p) => p.source === 'bundled');
      activeId = (bundled || packs[0] || {}).id || '';
    }
  }
  const ids = enabledPackIds(settings, packs, activeId);
  return {
    packsDir: path.resolve(String(settings.packsDir || defaultPacksDir())),
    activeId,
    packs: packs.filter((p) => ids.includes(p.id)),
    allPacks: packs,
    settingsFound: fs.existsSync(settingsFile()),
  };
}

/** 打开一个包的索引库（只读）。调用方负责 close。 */
function openPackDb(pack) {
  return new DatabaseSync(path.join(pack.path, 'index.db'), { readOnly: true });
}

/**
 * 列出／搜索表情。
 *
 * @param {{tag?: string, query?: string, limit?: number, bundledDirs?: string[]}} options
 * @returns {{packs: object[], total: number, items: object[], activeId: string, error?: string}}
 *
 * 返回的 `path` 是**包内相对路径**（与 index.db 里的值一致），跨包时加 `packId/` 前缀
 * —— 与 dsh-meme 自己在跨包合并时的做法一致（其 index.js:609），这样阶段 2 的
 * `qq_send_meme` 只要把 `pack` + `path` 一起传就能唯一定位。
 *
 * 任何单包读失败都不影响其它包：坏包被跳过并在 `error` 里报一句。
 */
export function listMemes(options = {}) {
  const wanted = activePacks(options);
  const limit = Math.max(0, Math.min(500, Number(options.limit) || 0));
  const tag = String(options.tag || '').trim().toLowerCase();
  const query = String(options.query || '').trim().toLowerCase();
  const tokens = query ? query.split(/\s+/).filter(Boolean) : [];

  const items = [];
  const errors = [];
  for (const pack of wanted.packs) {
    let db = null;
    let rows = [];
    try {
      db = openPackDb(pack);
      rows = db.prepare(
        "SELECT path, tag, file_name, caption, COALESCE(keywords, '') AS keywords FROM memes"
      ).all();
    } catch (error) {
      errors.push(`${pack.id}: ${error?.message ?? error}`);
      continue;
    } finally {
      try { db?.close(); } catch { /* 已关 */ }
    }

    const multiPack = wanted.packs.length > 1;
    for (const row of rows) {
      const rel = String(row.path || '');
      const rowTag = String(row.tag || '');
      if (tag && rowTag !== tag) continue;
      if (tokens.length) {
        const hay = `${rowTag} ${row.caption || ''} ${row.keywords || ''} ${row.file_name || ''}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) continue;
      }
      items.push({
        pack: pack.id,
        packName: pack.name,
        // 多包时带上包前缀，单包时保持与 index.db 完全一致（少一层歧义）
        path: multiPack ? `${pack.id}/${rel}` : rel,
        tag: rowTag,
        caption: String(row.caption || ''),
        keywords: String(row.keywords || ''),
        file: String(row.file_name || ''),
      });
    }
  }

  // 排序：按 tag 分桶，桶内按 path 稳定排序，方便模型阅读与人工核对。
  items.sort((a, b) => (a.tag === b.tag ? a.path.localeCompare(b.path) : a.tag.localeCompare(b.tag)));
  const limited = limit > 0 ? items.slice(0, limit) : items;

  const result = {
    activeId: wanted.activeId,
    packs: wanted.packs.map((p) => ({
      id: p.id,
      name: p.name,
      count: items.filter((i) => i.pack === p.id).length,
      source: p.source,
    })),
    total: items.length,
    items: limited,
  };
  if (wanted.packs.length === 0) {
    result.error = '没有可用的表情图库：用户图库目录为空且没探测到 dsh-meme 内置图库';
  } else if (errors.length) {
    result.error = `部分图库读取失败：${errors.join('；')}`;
  }
  return result;
}

/**
 * 把「表情引用」解析成可发送的绝对路径。
 *
 * 安全边界（L7）：AI 只能从图库内取文件。
 *   - 拒绝 base64:// / data: / http(s):// / file:// 等外部来源
 *   - 相对路径只在图库内解析，且过 safeJoinLibrary（含 realpath 复核，挡 symlink）
 *   - **绝对路径也要求落在图库内**（不能因为 AI 传了绝对路径就放行）
 *
 * 错误消息只报包 id，不报绝对路径：这条消息会经 MCP 工具回给模型，而模型面对的是
 * 不可信的群聊内容（prompt injection 可能诱导它复述本机路径）。同 voiceCfg 的注释。
 *
 * @returns {{pack: object, abs: string, rel: string}}
 */
export function resolveMemePath(packRef, relOrAbs, options = {}) {
  const wanted = activePacks(options);
  if (!wanted.packs.length) throw new Error('没有可用的表情图库');

  const raw = String(relOrAbs ?? '').trim();
  if (!raw) throw new Error('缺少表情路径');

  // 外部来源一律拒绝（与语音库一致，见 bridge.js 的 resolveVoicePathForV2）
  if (/^(base64:\/\/|data:|https?:\/\/|file:\/\/)/i.test(raw)) {
    throw new Error('表情只能从图库取本地文件；不接受 base64://、data:、http(s):// 或 file:// 来源');
  }

  // 优先按传入的 pack 精确匹配；没传时若只有一个可用包就直接用，多个则要求明确指定。
  let pack = null;
  const packId = String(packRef ?? '').trim();
  if (packId) {
    pack = wanted.packs.find((p) => p.id === packId) || null;
    if (!pack) throw new Error(`未知或未启用的图库：${packId}（可用：${wanted.packs.map((p) => p.id).join(', ')}）`);
  } else if (wanted.packs.length === 1) {
    pack = wanted.packs[0];
  } else {
    throw new Error(`有多个可用图库，必须指定 pack（可用：${wanted.packs.map((p) => p.id).join(', ')}）`);
  }

  // 允许 path 自带 `packId/` 前缀（listMemes 多包时就是这么返回的），剥掉再用本包根解析。
  let rel = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.startsWith(`${pack.id}/`)) rel = rel.slice(pack.id.length + 1);
  if (!rel) throw new Error('缺少表情路径');

  const abs = safeJoinLibrary(pack.path, rel);
  if (!abs) throw new Error(`表情路径越界或不存在：只能取图库 ${pack.id} 内的文件`);
  let stat = null;
  try { stat = fs.statSync(abs); } catch { /* 下面统一报 */ }
  if (!stat || !stat.isFile()) throw new Error(`表情文件不存在：${pack.id} 内没有这条路径`);
  return { pack, abs, rel, bytes: stat.size };
}

/**
 * 查一条图库记录（tag/caption/keywords），用于发送后写进二代会话的 recentMessages，
 * 让模型知道「我刚才发的是哪张、它长什么样」。
 *
 * 找不到这条 path 不算错误（图库可能刚被删图），只是元数据为空 —— 发送本身不受影响。
 * 返回的 pack 对象**不含目录**（外层用脱敏字段），避免把绝对路径带进模型上下文。
 */
export function findMeme(packRef, relOrAbs, options = {}) {
  const resolved = resolveMemePath(packRef, relOrAbs, options);
  let row = null;
  let db = null;
  try {
    db = openPackDb(resolved.pack);
    row = db.prepare(
      "SELECT path, tag, file_name, caption, COALESCE(keywords, '') AS keywords FROM memes WHERE path = ?"
    ).get(resolved.rel);
  } catch {
    /* 坏库/刚删：元数据留空，不影响发送 */
  } finally {
    try { db?.close(); } catch { /* 已关 */ }
  }
  return {
    pack: resolved.pack,
    abs: resolved.abs,
    rel: resolved.rel,
    bytes: resolved.bytes,
    tag: String(row?.tag || ''),
    caption: String(row?.caption || ''),
    keywords: String(row?.keywords || ''),
    file: String(row?.file_name || path.basename(resolved.rel)),
  };
}

/**
 * 读一张表情的字节（阶段 2 的发送用；阶段 1 不调用，但先落地以便一次审完）。
 * `maxBytes` 默认取桥接的 socialV2.media.maxBytes（8MB）。
 */
export function readMemeBytes(packRef, relOrAbs, { maxBytes = 8 * 1024 * 1024, ...options } = {}) {
  const resolved = resolveMemePath(packRef, relOrAbs, options);
  if (resolved.bytes > maxBytes) {
    throw new Error(`表情文件过大：${resolved.bytes} 字节（上限 ${maxBytes}）`);
  }
  return { ...resolved, buffer: fs.readFileSync(resolved.abs) };
}
