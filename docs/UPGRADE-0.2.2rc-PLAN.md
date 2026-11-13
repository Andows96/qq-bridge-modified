# 桥接 × DSH 0.2.2-rc.3 适配报告 + 升级到 0.2.2-rc 线的改动清单

> 2026-11-13 实测 ｜ 本机桥接 `0.2.1-r1`（+ 11-12 手工移植的 r2 八项）｜ 上游 `Derpyu520/qq-bridge`
> 说明：**0.2.2-rc3 是 DSH 的版本号；桥接侧没有 rc3**——桥接最新只有 `v0.2.2-rc1`（2026-11-06，prerelease），
> stable 停在 `v0.2.1-r2`（2026-10-31）。

## 0. 三条结论

1. **核心鉴权契约仍兼容**：DSH `0.2.2-rc.3` 的 `.credentials.yaml` 结构未变，我们的离线 cookie 铸造（HMAC）实测可用，
   带 cookie 打 RPC 从 `401 unauthorized` 变 `200`。
2. **桥接侧不会被 DSH 升级打断**，但有两处会被"环境变化"卡住：DSH 现在把模块全打进 `app.asar`（`app.asar.unpacked` 为空），
   我们那批"读安装目录 `node_modules`"的脚本失效；沙箱内跑桥接会因 `spawn EPERM` 误报"鉴权不可用/事件流协议不匹配"。
3. 上游若停维护，建议**以 `v0.2.2-rc1` 为一次性基线、本地 fork 自管**；第 2/3/4 节就是这次合并的清单。

## 1. 适配性实测（本次逐项验证）

| 检查项 | 方法 | 结果 | 判定 |
|---|---|---|---|
| DSH 版本 | 读 `app.asar` 内 `package.json` / `dsh/desktop-runtime.json` | `@deepseek-ai/dsh-desktop 0.2.2-rc.3`，`hostProtocolVersion: 4`，node 24.21.0 | 已知 |
| 判别接口 | `POST /api/agentPresets/list` 无 cookie | `401` + 纯文本 `unauthorized` | ✅ 不变 |
| 凭据结构 | 解析 `~/.dsh/.credentials.yaml` | `client-connection/browser-session`：`kind=grant`、`payload.version=1`、`payload.secret` 存在 | ✅ 不变 |
| cookie 铸造 | `readBrowserSessionSecret()` + `mintBrowserSessionCookie()` | secret 32 字节，cookie 224 字符 | ✅ 可用 |
| RPC 入口 | 带 cookie 再打 `/api/agentPresets/list` | `200`，`gateway/bad-request`（只因请求体不全） | ✅ 鉴权通过 |
| DSH 安装布局 | `ls resources/` | `app.asar` 209 MB，**`app.asar.unpacked` = 0 字节** | ❌ 依赖"安装目录 node_modules"的脚本会报"无法定位" |
| 事件流 `/api/remote.mux` | 未能验证 | 沙箱阻断 spawn/netstat，桥接找不到 DSH 端口 | ⏳ 必须非沙箱活体验证 |
| 已知环境坑 | 沙箱内跑桥接 | `netstat/icacls/spawn` 全 EPERM → 日志误报"鉴权不可用""协议不匹配" | ⚠️ 桥接必须沙箱外跑 |

> 结论口径：**DSH rc.3 没有破坏桥接的鉴权与 RPC 契约**；"桥接连不上 DSH"在本次是**沙箱**导致的假阳性。

## 2. 必保留的自研功能（丢了就是功能倒退）

| 功能 | 落点 | 依赖的调用点（合并时逐条重接） | 回归 |
|---|---|---|---|
| 图片降采样 + 动图联系表 | `src/image-downscale.js` | `maybeDownscaleImage`、`contactSheetBuffer`、`planSheetTiles` | `test-image-downscale` `test-image-sheet` |
| 动图判定 + 收藏拦截 | `src/image-animation.js` | `detectAnimatedImage`、`assertStickerCollectable` | `test-image-animation` |
| 提示词分段注入 | `src/prompt-gating.js` | `promptGatingCfg`、`promptGatingDecision`、`promptBlocksStubText`、`buildWakePromptV2` | `test-prompt-gating` `test-prompt-gating-e2e` `test-unified-injection` |
| 角色卡频次 | `src/role-card-gate.js` | `decideRoleCardInjection`、`roleBlockForPrompt`（+`fullOverride` 跟随） | `test-role-card-gate` |
| 表情间隔提醒 | `src/bridge.js`（`stickerGapRounds`） | 投递轮计数 + `qq_send_sticker/qq_send_meme` 清零 | `test-sticker-*` |
| 引用失败自动去引用 | `src/bridge.js`（`oneBotSend`/`quote` 段） | 发送失败分支重发 | `test-quote-fallback` `test-quote-ledger` |
| 黑话学习 / 排除词 | `src/slang-learner.js` | `[slang]` 回合、`injectableSlangEntries` | `test-slang-exclude` |
| 轻量记忆 / 记忆快照 | `src/bridge.js` | `formatMemoryV2`、`keepMemorySnapshot` | `test-memory-reset` |
| dsh-meme 图库发图 | `src/meme-lib.js` | `qq_send_meme` 工具 | `test-meme-lib` |
| `#sl` 管理命令 | `src/core/admin-status-command.mjs` | owner 私聊命令解析 | `admin-status-command.test` |
| 桌面守护启动 | `scripts/bridge-supervisor.mjs` | 桌面快捷方式 / supervisor | `test-restart-instance`（rc1 有） |
| 上下文压缩白名单 | `plugins/qq-agent-presets/qq-tool-restrict.mjs` | `SAFE_EXACT` / `BILLI_CONTEXT_TOOLS` | `test-preset-local-tools` |

## 3. 冲突清单（五类，逐项给处理方式）

| # | 冲突 | 我们 | rc1 | 处理方式 |
|---|---|---|---|---|
| ① | 发送排他 | `sendChainOf` / `setSendChain` + **outbox 文本补发** | `rememberSendChain` + `runWithDeliveryLock(sessionId)`，**无 outbox** | **两者都要**：保留 outbox；把 `runWithDeliveryLock` 加到投递/补投路径。删除我们的 `setSendChain` 需同步改 6 处调用点 |
| ② | 注入判据 | 统一周期 `role.injectEveryNWakes=5`，角色卡+规则块同进同出 | 只有角色卡分段（默认 4），规则块每轮全量 | **保留我们的**（更省）；只吸收 `roleCardSignature` 的 `mtime:size` 思路，做"改卡即生效" |
| ③ | 端口发现 | 三级 + 手工 `refollowKnownSessions()` | `discoverDshBaseUrl` + `rediscoverDshBase` + `api.rebind()` + 冷却 + `autoDiscoverPort` | **吸收 rc1 的收口**（把 refollow 收进重建函数），保留我们的三级顺序 |
| ④ | 回合级补投 | 只把 `session/snapshot` 喂给 token 账本（`bridge.js:13725`） | 交付游标 + 模式未知暂存 + `replayDeferredDeliveries` | **吸收**，但要先定幂等键（`key+turnId` vs 文本哈希）与补投窗口 |
| ⑤ | 撤回 / 快照 / 转发缓存 | 完全没有 | `handleRecallNotice`（正文换 `[该消息已被撤回]` 并清缓存） | **直接吸收**（纯增量） |

## 4. 要吸收的新功能（rc1 里有、我们没有）

| 项 | 位置 | 价值 |
|---|---|---|
| 撤回处理 | `bridge.js:12111-12179`、notice 挂载 `:12790` | 群/好友撤回后不再拿旧内容接话 |
| 会话级投递锁 | `runWithDeliveryLock` | 同会话并发投递不再互相踩 |
| 交付游标 + 补投 | `delivery-cursors.json`、`handleSessionSnapshot`、`replayDeferredDeliveries` | 断线后"答完没发出去"的整轮能补 |
| 端口自愈收口 | `rediscoverDshBase`、`api.rebind`、`DSH_REDISCOVER_COOLDOWN_MS` | 换端口后不再"永久繁忙" |
| 模型强度 | `none`（跟随模型）、保留目录自定义强度、保存竞态修复 | 控制台改强度不再错位 |
| 守卫补名 | `apply_patch`、`schedule_view`、`schedule_edit` | 我们名单里缺这 3 个，且留着过时的 `schedule_update/delete` |
| 分条发送整批令牌预检 | 发送前整批校验会话令牌 | 防止半批外发 |
| 新脚本 | `verify-dsh-022-adaptation.mjs`、`test-delivery-regressions.mjs`、`test-role-injection-cadence.mjs`、`test-installed-preset-sync.mjs`、`stop-bridge-instance.mjs`、`adaptation-probe-helpers.mjs` | 适配/回归工具链 |
| 守卫名单差异 | `qq-tool-restrict.mjs`：rc1 94 vs 我们 89 个名字 | 合并时以并集为准，删掉我们已废弃的 `acp_*`/`schedule_*` 旧名 |

## 5. 执行步骤（每步都有验收）

0. **备份 + 打基线**：`git init && git add -A && git commit`，打 tag `local-0.2.1-r1`；备份 `config.json`、`state/`、`roles/`、`plugins/`、`dsh/agent-presets/`。
1. **取基线**：把 `v0.2.2-rc1` 源码覆盖到工作副本（不要直接覆盖生产树）；`npm install` 补齐 `@modelcontextprotocol/sdk ≥1.32.2`、`zod ≥4.6.7`。
2. **合并自研**：按第 2、3 节逐项重接；`node --check` 全部文件；跑 `test:audit`（rc1 基线 58/58，其中 3 项需非沙箱）。
3. **适配 DSH rc.3**：修"读安装目录 node_modules"的脚本（`scripts/dsh-modules.mjs` 改成从 `app.asar` 读，或改用 DSH API 取工具清单）；加 `hostProtocolVersion` 断言（rc.3 = 4）。
4. **活体验证（非沙箱）**：起桥接 → 看 `dshReady=true`、mux 有帧、preset 生效、工具面正确、`/api/status` 正常。
5. **回归 + 回滚**：跑第 2 节全部测试 + 新增 `test-delivery-regressions`；出问题回 tag `local-0.2.1-r1`。

## 6. 自维护策略（上游停维护后的长期做法）

- **git 化**：当前不是仓库；`git init` 后用"上游 tag 目录"当 vendor 基线，每次升级是一次 squash commit，便于 diff。
- **补丁清单常态化**：`docs/LOCAL_PATCHES.md` 每次改完跑一次差异脚本（见该文件第 6 节）。
- **DSH 升级例行三查**：① 判别接口 `401 unauthorized`；② `readBrowserSessionSecret()` 32 字节 + cookie 铸造；③ `hostProtocolVersion`。
  三条都过再谈"桥接要不要改"。
- **CI**：`test:audit` + `test-delivery-regressions` + `test-prompt-gating*` + `test-role-card-gate` + 自研图片/动图 4 个测试。

## 7. 决策记录

**2026-11-13 用户确认：第 3 节五处冲突全部按"处理方式"一列的推荐执行，下一轮开始动工。** 即：

| # | 已定方案 |
|---|---|
| ① | 保留我们的 outbox；引入 rc1 的 `runWithDeliveryLock`（两套并存，分工见第 3 节） |
| ② | 保留我们的统一注入周期（`injectEveryNWakes=5`）；只吸收 `mtime:size` 签名做"改卡即生效" |
| ③ | 吸收 rc1 的 `api.rebind` 收口，保留我们的三级发现顺序 |
| ④ | 吸收交付游标 + 补投；先定幂等键与补投窗口再动手 |
| ⑤ | 撤回处理直接吸收 |

## 8. fork 与上传清单（用户将 fork 上游并上传改版）

**许可与署名**：上游 `LICENSE` 是 MIT（`Copyright (c) 2026 Derpyu520 and qq-bridge / QSH contributors`），
`NOTICE.md` 需原样保留；README 顶部加一行 `Fork of Derpyu520/qq-bridge v0.2.2-rc1`。

**必须排除（不要上传）**

| 路径 | 原因 |
|---|---|
| `state/` | 会话令牌、聊天记录、记忆、黑话库、outbox —— 全是隐私与凭据 |
| `config.json` | 含 `snowluma.accessToken`、`consoleToken`、ownerQQ |
| `roles/`（`小鲸鱼.md`、`小鲸鱼软萌群友版.md`） | 私人人格卡 |
| `slang-review-*.xlsx` | 群聊黑话导出，含群成员发言 |
| `_upstream/`、`node_modules/`、`logs/`、`*.log`、`*.bak-*` | 体积与临时物 |
| `start-with-turndiag.bat`、`_timing_patch3.mjs`、`scripts/tmp-*` | 本机排查临时物 |

**建议的 git 结构**

1. `git init` → 第一笔提交放**上游 v0.2.2-rc1 原始树**，打 tag `upstream/v0.2.2-rc1`；
2. 第二笔提交放我们的合并结果，tag `custom/v0.2.2-rc1-r1`；
3. 之后自研改动走常规提交，`docs/LOCAL_PATCHES.md` 与第 6 节的差异脚本一起进仓库 —— 这样任何人都能用
   `git diff upstream/v0.2.2-rc1..main` 一眼看清我们改了什么；
4. `.gitignore` 至少包含：`state/`、`logs/`、`node_modules/`、`config.json`、`*.log`、`*.bak-*`、
   `slang-review-*.xlsx`、`_upstream/`、`scripts/tmp-*`。

**上传前自检**：`git status --porcelain | grep -E 'state/|config.json|\.log|\.xlsx'` 必须为空；
另外跑一遍令牌扫描（拿**你自己**的 `snowluma.accessToken` / `consoleToken` / `agentToken` 的前 8 位去 grep，别把真实串写进仓库）必须 0 命中。
> 本文件 2026-11-13 曾把一串真实令牌片段写进这一行，已删除——**任何"自检用的示例串"都不许是真值**。

## 9. 2026-11-13 讨论后的补充决定（覆盖第 3 节相关条）

### 9.1 时效规则的正确表述（原文见 `bridge.js:11830-11841`）

| 消息类型 | 时效 | 行为 |
|---|---|---|
| 任意（≤10 分钟） | 实时 | 正常接 |
| 任意（10~120 分钟） | 半新 | 可以接，但不用"刚/秒回"语气 |
| **普通消息 ≥120 分钟** | 旧 | **默认不回**，`qq_mark_read` 收尾 |
| **@你 / 引用你 ≤48 小时（2880 分钟）** | 必回 | 必须 `qq_reply` 引用 |
| **@你 / 引用你 >48 小时** | 过期 | 默认不回 |

> 之前的写法把「120 分钟」套到了 @/引用 上，是错的：120 分钟只约束**普通消息**，@/引用 的窗口是 **48 小时**。

### 9.2 决定：拆掉「引用失败去掉引用重发」

- 现行实现（`bridge.js:8599-8650` `onebotSend` 的 catch 分支）会剥掉 `reply` 段重发，日志 `[quote] … 已去掉引用重发`。
- **新规则：引用失败 = 这条不发**，不再静默降级。理由：引用是"在回哪条"的唯一线索，降级发出去反而让群友看不懂，且对 48 小时内的 @/引用 违反"必须引用"。
- 影响面（下一轮一起改）：
  1. `src/bridge.js` `onebotSend`：删降级分支，改为记录 `[quote] … 带引用发送失败（…），按规则不再降级重发` 后抛出；
  2. `scripts/test-quote-fallback.mjs`：断言从"降级成功且保留 @"改为"抛错且没有任何外发"（必要时改名 `test-quote-strict.mjs`）；
  3. `scripts/test-quote-ledger.mjs`：确认销账逻辑不受影响；
  4. 唤醒提示的 `quoteLine`：补一句「引用发送失败就别硬发，直接 `qq_mark_read` 收尾」；
  5. 文档：README 的引用小节、`docs/LOCAL_PATCHES.md` 第 4 节、MEMORY 里那条 critical 条目。
- 保留的旁路：模型**自己**改用不带引用的 `qq_send_message` 重发是允许的——被删掉的是"代码静默降级"，不是模型的选择权。

### 9.3 黑话：不自动确认，由用户去控制台复检

- 不做 `autoConfirm` 开关。
- 复检前必须先跑 `POST /api/slang/research`（批量补 `meaning/sources`），否则 `batch-confirm` 会以「缺少含义」把 540 条全部跳过。

### 9.4 上传安全：用户已同意第 8 节方案

`.gitignore`（`state/ logs/ config.json config.json.bak-* .bak-* *.log *.xlsx node_modules/`）+ pre-commit 令牌/QQ 号扫描钩子。

## 10. 2026-11-13 开工第一轮：合并范围的重要修正

**发现**：rc1 自带 `src/media-normalize.js`，是我们图片链路的**上位实现**，能力逐项对齐且有超出：

| 能力 | 我们的实现 | rc1 的 media-normalize |
|---|---|---|
| 动图判定（GIF 帧数 / WebP ANMF / APNG） | `image-animation.js` | `sniffImage()` / `describeImage()` |
| 抽帧拼图（3×2 网格） | `image-downscale.js` 的 `contactSheetBuffer` | `planAnimation()` + ffmpeg `fps=…,tile=…` |
| 体积悬崖（base64 栈溢出） | 阈值 2.5 MB / q2 | `MEDIA_DEFAULTS.maxModelBytes`=1 MB、`HARD_MAX_MODEL_BYTES`=3.0 MB |
| 小图直通 | 有 | 有（≤ maxModelBytes 且长边够小，零延迟） |
| 压不动时给可读原因 | 回退原图 | `ok:false` → 调用方转成一句"看不了"，不发注定被丢的字节 |
| 只动"给模型看"的那一份 | 我们改的是 `fetchOneBotImage`（也影响收藏） | 只接在 `toModelMedia`（`fetchMediaData`/`resolveMediaList`/贴纸图），**收藏仍用原始字节** |

**决定（范围缩小）**：

- ❌ **不再移植** `src/image-downscale.js`、`src/image-animation.js` —— 直接采用上游 `media-normalize`，避免两份实现打架（已在 `qq-bridge-022rc` 副本里删掉这两个文件）。
- ✅ **仍要移植**：`src/prompt-gating.js`、`src/role-card-gate.js`、`src/meme-lib.js`、`src/core/admin-status-command.mjs`。
- ✅ **仍要新增**：动图收藏拦截 —— rc1 的 `collectStickerV2` 仍用 `fetchOneBotImage` 原始字节送 `add_custom_face`（`bridge.js:2149-2151`），动图收藏进去仍会被 QQ 压成一帧；拦截改用上游的 `sniffImage()` 判 `animated`，不再自建判定。
- 随之作废的本地改动：`socialV2.image{triggerBytes,targetEdge,qscale}` 三个键（改由 rc1 的 `socialV2.media{maxModelBytes,maxLongEdge,gifFrames,gifTile,normalizeTimeoutMs}` 控制）。

## 11. 开工进度（2026-11-13）

1. ✅ `git init -b main` + `.gitignore` 扩写（新增 runtime 状态/配置/人格卡/xlsx/备份目录等 8 类），实测 `git check-ignore` 7/7 命中；
2. ✅ 基线提交 `0621b4d`（192 个文件，仅源码/文档/脚本），tag `local-0.2.1-r1`；`state/`、`config.json`、`roles/`、`.bak-r2port-*` 均在库外（24 条 ignored）；
3. ✅ 4 个待移植模块在 `qq-bridge-022rc` 副本里通过 `node --check`；
4. ⏳ 待办：把 role-card / prompt-gating 的调用点接进 rc1 `bridge.js`（rc1 里 `roleBlockForPrompt`、`promptGatingCfg` 均不存在，需以 `roleForWake` 为锚点改写）；接收藏拦截；跑 rc1 `test:audit`；
5. ⏳ 待办（同一棵树里一次改完，避免改两遍）：拆「引用失败去引用重发」+ 引用失败不进 outbox（用户已确认"这条作废"）。

### 11.1 2026-11-13 第二轮（步骤 ①②③④ 已落地，全部在隔离副本 `qq-bridge-022rc`）

**① 分段注入接线**（`src/bridge.js`）
- 新增 import：`decidePromptBlocks/promptBlocksStubText/PROMPT_META_BLOCKS`、`decideRoleCardInjection`；`sniffImage` 一并从 `media-normalize` 引入。
- 新增默认值 `socialV2.role / roleCard / promptGating`；统一周期取值顺序：`socialV2.role.injectEveryNWakes` → 上游 `cfg.role.injectEveryNWakes` → `promptGating.metaEveryWakes` → 4（不配置时与上游口味一致）。
- 新增 `promptGatingCfg()` / `promptGatingDecision()`；计数落 **`state/prompt-gating.json`**（social-v2.json 白名单持久化会丢自定义字段，rc1 自己踩过）。
- `buildWakePromptV2(key, reason, opts)`：规则块省略时在【你的身份】位置留一行占位；表情包**策略**进规则块、**清单**每轮都发。
- `roleForWake(key, { fullOverride })`：周期跟随规则块，但「换卡 / 换 DSH 会话」仍立刻全量。
- 测试装置：`scripts/audit-bridge-harness.mjs` 注入两个新模块的绑定（VM 会剥 import，否则 `ReferenceError`）。

**② 动图收藏拦截**
- `collectStickerV2` 图片/face 两分支在拼 `base64://` 之前调 `assertStickerCollectable(buffer, key)`；判定用 `sniffImage()`，命中即抛错（不落 `add_custom_face`），日志 `[sticker] 拒绝收藏动图表情（GIF N 帧）`。
- 新增 `scripts/test-sticker-animated-guard.mjs`（动图 500 + 日志拒绝 + 无成功日志；静态图 200）。夹具增补：`bridgeHarness({ imageBase64 })`、`add_custom_face` 返回 `emoji_id`。

**③ 审计**
- `node scripts/test-audit.mjs` → **55/58**，失败的 3 个仍是 `test-audit-runtime-boundaries` / `test-audit-setup` / `test-qq-model-view`（沙箱 `spawn EPERM`，给权限单跑 10 passed / 11 pass 0 fail），与改动前基线一致。
- `test-role-injection-cadence.mjs` 8/8、`test-time-awareness.mjs` 13/13、`test-sticker-animated-guard.mjs` 2/2 全过。

**④ 引用降级 / outbox**
- grep 确认 rc1 **没有**「引用失败去引用重发」，也**没有** outbox → `onebotSend` 直接抛错、不重发，「引用失败=这条作废」天然成立，无需删代码。
- 按 2026-11-13 的口径改写时间感分档：`@/引用 ≤48 小时（2880 分钟）必回且必须 qq_reply；>48 小时不回`、`普通消息超过 staleSilentMinutes（默认 120）不回`，两条都写明 `qq_mark_read` 收尾。
- 【引用：只在必要时用】补一句「引用发送失败时不要去掉引用硬发：那条就作废，直接 qq_mark_read 收尾」。
- 新增回归用例（写在 `scripts/test-time-awareness.mjs`）：断言 48 小时档存在、且不会把 @/引用 塞进 120 分钟档。

**下一步**：`LOCAL_PATCHES.md` 汇总本地改动 → 正式目录切换（先备份 `qq-bridge` → 用副本替换 → 用真实配置跑冒烟）→ 用户验收后再定 git 提交与 tag。
