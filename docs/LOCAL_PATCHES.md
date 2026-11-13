# 本地改动清单（相对上游 v0.2.1-r1）

> 生成：2026-11-13 ｜ 基线：上游 tag **v0.2.1-r1**（2026-10-31）源码
> 对照树：`<workspace>\_upstream\ref-0.2.1-r1` ｜ 差异数据：`<workspace>\_upstream\diff-r1.json`、`diff-stats.json`
>
> **为什么要有这个文件**：本目录**不是 git 仓库**，上游一升级就只能靠记忆对代码。每次改本地代码后请回来更新本表
> （第 6 节有重新生成差异的命令）。

## 0. 基线与规模

| 项 | 值 |
|---|---|
| 上游基线 | v0.2.1-r1 |
| 额外手工移植 | 2026-11-12 移植上游 r2 的 8 项（统一注入周期、per-key sendChain、outbox 补发、start.bat、黑话导出、删备用通道等），见 `R2-PORT-PROGRESS.md` |
| 本地文件数 / 上游文件数 | 198 / 156（排除 `node_modules`、`state`、`logs`、`config.json`） |
| 新增 | **42** |
| 缺失（上游有、本地无） | **0** |
| 内容不同 | **28** |
| 冲突面最大 | `src/bridge.js`：本地 14,564 行 vs 上游 12,075 行，**+2624 / −135** |

## 1. 自研新增模块（`src/`）——升级时最需要人工重接的部分

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/image-downscale.js` | 351 | 超阈值降采样（2.5 MB / q2 / 长边 1568）；**动图联系表** `planSheetTiles` / `contactSheetBuffer` / `pickSampleIndices` |
| `src/image-animation.js` | 183 | 按字节判动图（GIF 帧数 / APNG `acTL` / WebP `ANIM`），供收藏前拦截 |
| `src/prompt-gating.js` | 82 | 提示词分段注入决策 `decidePromptBlocks` / `PROMPT_META_BLOCKS` / 占位文案 |
| `src/role-card-gate.js` | 71 | 角色卡首投 + 周期补发 `decideRoleCardInjection` / `roleCardStubText` |
| `src/meme-lib.js` | — | dsh-meme 图库读取与发图 |
| `src/core/admin-status-command.mjs` | — | `#sl` 管理命令（状态查询） |
| `src/core/admin-status-command.test.mjs` | — | 上者的单测 |

对应测试：`test-image-downscale` `test-image-sheet` `test-image-animation` `test-prompt-gating(-e2e)` `test-role-card-gate` `test-meme-lib`。

## 2. 新增脚本（`scripts/`）

- **运行期脚本**：`bridge-supervisor.mjs`（桌面启动用的守护；子进程 exit 0 时自己也退出，只对非 0 退出重启）、`find-animated-messages.mjs`（排查用）、`tmp-audit-agent-auth.mjs`（临时审计）。
- **测试脚本（29 个）**：`test-at-diag`、`test-atself`、`test-backfill-retry`、`test-backfill-routing`、`test-gif-handling`、`test-image-animation`、`test-image-downscale`、`test-image-sheet`、`test-media-refresh`、`test-meme-lib`、`test-memory-reset`、`test-message-idempotent`、`test-missed-at`、`test-peer-typing`、`test-pending-replies`、`test-prompt-gating(-e2e)`、`test-quote-fallback`、`test-quote-ledger`、`test-role-card-gate`、`test-slang-exclude`、`test-stale-commands`、`test-stream-recovery`、`test-unified-injection`、`test-unread-demote`。

## 3. 新增的其他文件

| 文件 | 说明 |
|---|---|
| `roles/小鲸鱼软萌群友版.md` | 软萌群友版人格卡（本地自建） |
| `R2-PORT-PROGRESS.md` | r2 移植 8 项的执行单与状态 |
| `mcp-tools-dump.md` | 工具面快照（审计用） |
| `slang-review-20261112.xlsx` | 黑话词条导出（538 条，人工复核用） |
| `pnpm-lock.yaml` | 另一套包管理锁文件（与 `package-lock.json` 并存） |
| `start-with-turndiag.bat` / `_timing_patch3.mjs` | 排查辅助 |

## 4. 修改过的文件（28 个）

| 文件 | 本地/上游行数 | +/− | 改了什么（已知） |
|---|---|---|---|
| `src/bridge.js` | 14564 / 12075 | +2624 / −135 | 主体：图片与动图链路、表情/收藏、黑话、记忆、提示词注入、发送链、outbox、回合诊断、控制台端点 |
| `src/mcp-snowluma-safe.js` | 1504 / 1408 | +102 / −6 | MCP 工具描述与闸门（动图收藏拒绝、等待节奏默认值、图片工具说明） |
| `src/slang-learner.js` | 478 / 382 | +96 / −0 | 黑话学习/排除词 |
| `plugins/qq-agent-presets/qq-tool-restrict.mjs` | 362 / 328 | +34 / −0 | 安全守卫名单（新增必须隐藏的工具名） |
| `dsh/agent-presets/qq-chat-v2/agent.cordis.yml` | 201 / 194 | +19 / −12 | preset 契约（等待节奏 60000/15000、工具面、`{{cwd}}` 相关修正） |
| `plugins/qq-agent-presets/presets/qq-chat-v2.patch.yml` | 68 / 67 | +9 / −8 | 同上，产物侧 |
| `roles/小鲸鱼.md` | 191 / 182 | +9 / −0 | 人格卡本地调整 |
| `README.md` | 749 / 368 | +382 / −1 | 本地文档（版本适配说明、章节扩充） |
| `RULES.md` | 111 / 111 | +1 / −1 | 权限边界措辞 |
| `config.example.json` | 282 / 279 | +4 / −1 | 新增配置项示例 |
| `package.json` | 88 / 72 | +17 / −1 | 新增 17 条脚本（自研模块测试、守护） |
| `start.bat` / `restart.bat` | 25/19、56/26 | +23/−17、+42/−12 | 绝对路径 + 守护启动方式 |
| `src/web-search.js` | 515 / 496 | +19 / −0 | 搜索源与回退 |
| `src/qq-model-view.js` | 141 / 134 | +8 / −1 | 模型视图 |
| `src/sticker-lib.js` | 304 / 303 | +2 / −1 | 表情库细节 |
| `scripts/audit-bridge-harness.mjs` | 261 / 230 | +60 / −29 | 审计框架适配本地模块 |
| `scripts/test-audit-bridge.mjs` 等 13 个测试 | — | 各 +2~+71 | 断言补齐（`test-wait-backlog` +71/−14、`test-qq-preset-contract` +40/−16 变化最大） |

## 5. 升级时的红线（务必按顺序）

1. **先备份**：`config.json`、`state/`、`roles/`、`dsh/agent-presets/`、`plugins/`，以及本文件第 1 节那 6 个自研模块。
2. **不要直接覆盖**整棵树：新版解压到临时目录，再按第 4 节逐文件比对。
3. `node scripts/setup-dsh.mjs` 会**重装 preset 与守卫**——它会覆盖 `dsh/agent-presets/qq-chat-v2/agent.cordis.yml` 与 `plugins/qq-agent-presets/`。跑之前先确认这些文件已备份，跑完用 `node scripts/build-agent-preset-patches.mjs` 重建，并对比第 4 节的差异是否还在。
4. `src/bridge.js` 的**调用点**必须逐一重接（上游新版会覆盖它们）：`maybeDownscaleImage`、`assertStickerCollectable`、`roleBlockForPrompt`、`buildWakePromptV2`、`sendChainOf`、`outboxPush/flushOutbox`、`detectAnimatedImage` 挂点。
5. 升级后必须跑的回归：`test:audit`、`test-image-*`、`test-prompt-gating*`、`test-role-card-gate`、`test-qq-preset-contract`、`test-wait-backlog`、`test-unified-injection`。

## 6. 重新生成差异（改了本地代码就跑一次）

```bash
# 上游参照树（一次即可）
python - <<'PY'
import os, zipfile
z = zipfile.ZipFile(r'<workspace>\_upstream\v0.2.1-r1.zip')
clean = r'<workspace>\_upstream\ref-0.2.1-r1'
prefix = 'qq-bridge-0.2.1-r1/'
for n in z.namelist():
    if not n.startswith(prefix) or n.endswith('/'): continue
    dst = os.path.join(clean, n[len(prefix):].replace('/', os.sep))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'wb').write(z.read(n))
PY
# 再按 _upstream/diff-r1.json 同样的排除规则（node_modules/state/logs/config.json/.bak-*）做 sha256 对比
```

> 说明：本文件由人工维护的说明 + 脚本生成的客观差异共同组成。**只改说明不重跑脚本 = 表会过期**，反之亦然。

---

# 附：迁移到 0.2.2-rc1 基线后的本地改动（2026-11-13 起）

> 上面第 1~6 节描述的是「相对上游 v0.2.1-r1」的旧账。从 2026-11-13 起，本地基线改成
> **上游 v0.2.2-rc1 + 下列改动**，迁移在隔离副本 `<workspace>\qq-bridge-022rc` 里完成。
> 下一次升级上游时，只需按这份清单重接（第 1~6 节可作历史参考）。

## A. 保留的自研模块（落在 rc1 树上）

| 模块 | 用途 | rc1 侧接线点 |
|---|---|---|
| `src/prompt-gating.js` | 规则块分段判据（`decidePromptBlocks`/`promptBlocksStubText`/`PROMPT_META_BLOCKS`） | `promptGatingCfg()` / `promptGatingDecision()` / `buildWakePromptV2` |
| `src/role-card-gate.js` | 角色卡注入判据（`decideRoleCardInjection`/`roleCardStubText`） | `roleForWake(key, { fullOverride })` |
| `src/meme-lib.js` | 本地表情库（pack/path 索引） | `qq_send_meme` 工具链 |
| `src/core/admin-status-command.mjs` | `#sl` 运维命令 | 控制台/消息命令分发 |

## B. 相对 rc1 的代码改动（6 处，全部在 `src/bridge.js` + 1 个测试装置）

1. **import**：`prompt-gating` / `role-card-gate` 的绑定；`media-normalize` 额外引入 `sniffImage`。
2. **默认配置**：`socialV2.role{injectEveryNWakes}`、`socialV2.roleCard{mode,digest,fullEveryWakes}`、`socialV2.promptGating{enabled,dedupeMs}`。
   统一周期取值顺序：`socialV2.role.injectEveryNWakes` → 上游 `cfg.role.injectEveryNWakes` → `promptGating.metaEveryWakes` → 4。
3. **计数落盘**：`state/prompt-gating.json`（**不能塞 social-v2.json**，白名单持久化会静默丢字段）。
4. **`buildWakePromptV2(key, reason, opts)`**：规则块省略时在【你的身份】位置留一行占位；表情包策略进规则块、清单每轮都发。
5. **`roleForWake`**：新增 `fullOverride`（周期跟随规则块），但「换卡 / 换 DSH 会话」仍立刻全量。
6. **`assertStickerCollectable(buffer, key)`**：`collectStickerV2` 的图片 / face 两分支在拼 `base64://` 之前调用，用 `sniffImage()` 判 `animated`，命中即抛错（不落 `add_custom_face`）。
7. **测试装置** `scripts/audit-bridge-harness.mjs`：注入两个新模块的绑定（VM 会剥 import）；新增 `imageBase64` 选项与 `add_custom_face` 返回 `emoji_id`。

## C. 明确不再移植（rc1 已有上位实现）

- ❌ `src/image-downscale.js`、`src/image-animation.js` —— 改用 rc1 的 `src/media-normalize.js`（`sniffImage`/`planAnimation`/`tile=`），配置从 `socialV2.image{triggerBytes,targetEdge,qscale}` 改为 `socialV2.media{maxModelBytes,maxLongEdge,gifFrames,gifTile,normalizeTimeoutMs}`。
  - 注：这两个文件与对应测试（`test-image-downscale.mjs`、`test-image-animation.mjs`、`test-image-sheet.mjs`、`test-gif-handling.mjs`、`find-animated-messages.mjs`）**仍留在树里作参考**，但 `src/bridge.js` 已不再 import 它们（唯一引用是 `media-normalize`）。下次上游若删改 `media-normalize`，优先复查这里而不是把旧实现接回来。
- ❌ 「引用失败去掉引用重发」与 outbox —— rc1 的 `onebotSend` 直接抛错、不重发，「引用失败=这条作废」天然成立。
- ❌ `_timing_patch3.mjs`、`R2-PORT-PROGRESS.md`、`slang-review-*.xlsx` 等临时产物。

## D. 新增 / 修改的测试

| 脚本 | 覆盖 |
|---|---|
| `scripts/test-role-injection-cadence.mjs` | 8/8：首轮全卡、每 N 轮补、换卡即全量、换会话即全量、8s 去重、`injectEveryNWakes=1` |
| `scripts/test-sticker-animated-guard.mjs` | 2/2：动图收藏 500 + 日志拒绝 + 无成功日志；静态图 200 |
| `scripts/test-time-awareness.mjs` | 13/13：新增「@/引用 48 小时档、120 分钟只约束普通消息」回归 |

## E. 升级到下一版上游时的红线（追加）

1. 先跑 `test-audit` 记基线：**52/58**（2026-11-13 合入 preset/许可改动后的实测值）。6 个失败分两类，别把它们当成新回归：
   - **环境类（3 个，沙箱限制）**：`test-audit-runtime-boundaries`、`test-audit-setup`、`test-qq-model-view` —— 全是 `spawn EPERM`，给权限单跑应 10/11 pass 0 fail。
   - **fork 内容分歧（3 个，预期长期红）**：`test-qq-preset-contract`（4 条断言上游措辞）、`test-preset-local-tools`（2 条断言上游 restrict 清单）、`test-tool-restrict-guard`（1 条运行时断言）—— 我们保留自有 preset 文案（60/15 秒节奏、本地图库段）与 bili 压缩白名单，所以它们注定对不上。若哪天决定全绿，只有「整份替换上游 preset/插件」或「改测试期望值」两条路。
2. 上面 B 的 7 处必须逐一重接。依赖已就位（2026-11-13 实测）：`@modelcontextprotocol/sdk` **1.32.2**、`zod` **4.6.7**。注意本机**没有 npm**：当时是用自带的 `pnpm 11.28.5`（`C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs`，由 runtime node 执行）把包下到临时目录，再拷进 `node_modules`；旧包备份在 `<workspace>\_backups\node_modules-old-20261113\`。`package-lock.json` 因此仍是旧版本号，下次能跑 npm 时补一次 `npm i` 即可对齐。
3. 桥接必须**非沙箱**运行，否则 `netstat/icacls/spawn` 全 EPERM，会误报「DSH 鉴权不可用」。
4. 许可已统一到 `PolyForm-Noncommercial-1.0.0`（根 `package.json` 与 `plugins/qq-agent-presets`、`plugins/qq-mode-console` 三处一致）；`test-audit-setup-guards` 会强制检查这件事，加新插件时别漏。
5. 改完 `dsh/agent-presets/**/agent.cordis.yml` 必须跑 `node scripts/build-agent-preset-patches.mjs` 重新生成 patch（否则 `test-agent-preset-patches` 会红），并且要**重启 DSH** 才生效（只重启桥接不管用）。
