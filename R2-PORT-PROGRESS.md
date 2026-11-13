# r2 移植进度（2026-11-12 00:15 暂停点）

> 桥接仓库停止维护后，按用户拍板的「8 项执行单」把上游 r2 里值得吸收的东西移植进本地 0.2.1-r1。
> 本次是**行为保持型**改造：自研 7 项一律不动语义，只补上游有、本地没有的能力。

## 一、状态总览

8 项全部落地，核心链路回归 **20/20 全绿**。尚未做的是**实跑验证**（当时 SnowLuma 与 DSH 都没启动）。

| # | 项目 | 状态 | 落点 |
|---|---|---|---|
| — | atSelf 独立测试（前置） | ✅ | `scripts/test-atself.mjs`（7 断言） |
| — | messageId 幂等（前置） | ✅ | `appendSocialV2Message` 开头 + `scripts/test-message-idempotent.mjs`（3 断言） |
| 1 | 注入周期 `role.injectEveryNWakes=5` | ✅ | `promptGatingCfg` / `buildWakePromptV2` / `roleBlockForPrompt` + `scripts/test-unified-injection.mjs`（4 断言） |
| 2 | `sendChain` 全局单链 → per-key | ✅ | `sendChainOf` / `setSendChain`，6 个使用点 |
| 3 | 端口发现 + `refollowKnownSessions` | ✅ 原有保留 | `pumpMux` 的重探分支（未改） |
| 4 | 出站游标补发（outbox） | ✅ | `loadOutbox` / `saveOutbox` / `outboxPush` / `outboxRemove` / `flushOutbox` |
| 5 | 执行期会话绑定 | ✅ 审计确认已完备 | `agentTokenOk` 43 处调用，无漏洞 |
| 6 | `start.bat`（绝对路径 + Start-Process） | ✅ | `start.bat`（纯 ASCII + CRLF） |
| 7 | 黑话导出表格 | ✅ | `slang-review-20261112.xlsx`（538 条） |
| 8 | 删备用通道 | ✅ | 删 `scripts/import-memes-to-stickers.mjs` + `package.json` 两条脚本 |

## 二、每项的细节与理由

### 注入周期（第 1 项）

原先规则块与角色卡各有一套计数器，周期还可能不同（5 / 10）。现在配 `socialV2.role.injectEveryNWakes`
（r2 的键名）之后，**两者共用一个计数、同进同出**：这一轮完整注入就两样都给，其余轮次两样都退成占位行。

- `promptGatingCfg()` 新增 `unifiedEveryWakes`，并让 `metaEveryWakes` / `roleCardEveryWakes` 都以它为准。
- `buildWakePromptV2()` 里把 `promptGatingDecision()` **提到角色卡之前**，把 `metaFull` 通过
  `opts.fullOverride` 透传给 `roleBlockForPrompt()`。
- `roleBlockForPrompt()` 走跟随时**不写 `roleCardWakes`**，避免留下「一直在涨但永远用不到」的脏计数。

占位行保留（`promptBlocksStubText` / `roleCardStubText` 都还在）。

### sendChain per-key（第 2 项）

原来所有会话共用一个 Promise 链，一个群卡住（比如发图超时）会拖住所有会话的发送。现在按 `key` 分链：

```js
const sendChains = new Map();
function sendChainOf(key) { /* 没链就建 Promise.resolve() */ }
function setSendChain(key, p) { /* 存回；跑完且仍是当前值时删掉，防 Map 无限长 */ }
```

6 个使用点：`sendVoice` / `sendStickerV2` / `sendMemeV2` / `sendToQQ` / `sendBurst` / `sendMessagesV2`。

### outbox（第 4 项）

**只在发送失败时落盘**，正常路径零 IO —— 这样不会出现「其实已经发出去了，重启后又补发一遍」。
同会话同文本 10 分钟内只记一条；最多 50 条、6 小时、重试 3 次，超了丢弃。
接线在 `sendToQQ` 的 `.then` / `.catch`，补发挂在 `bot.on('open')` 的 `flushOutbox()`。

### 会话绑定（第 5 项）

审计结论：**已经完备，不需要改**。`agentTokenOk(key, token)` 早就是会话级的（43 处调用），
「读了 `x-agent-token` 却没校验」的 8 条路由全部是**显式拒绝 agent 访问**的控制台接口
（`该接口仅控制台可用` 403），或者只在 `tokenlessAgentAllowed` 白名单里（`/api/status` 之类只读）。

审计脚本：`scripts/tmp-audit-agent-auth.mjs`（可复用，按 `url.pathname === '/api/...'` 切块）。

### start.bat（第 6 项）

- **纯 ASCII**：cmd.exe 按系统 ANSI 代码页读 .bat，中文注释字节数为奇数时会吞掉下一个 ASCII 字符。
- **CRLF**：这个文件必须是 CRLF，用 `write` 工具写出来是 LF，已用 node 转回。
- `%~dp0` 让脚本路径绝对化；`Start-Process` 让守护进程有自己的控制台，启动器立刻退出 ——
  关掉启动窗口（或 Ctrl+C）不再连带把机器人弄死，也永远不会出现 `Terminate batch job (Y/N)?`。

### 黑话表格（第 7 项）

`slang-review-20261112.xlsx`，538 条，按出现次数降序，灰底 = 只出现过 1 次。

**导出时实测的数据现状（很重要，决定了复核怎么做）**：

- `status` 全部 `candidate`，`source` 全部 `ai` —— 没有一条被确认过
- `meaning` / `usage` / `example` **全部为空** —— 模型能看到词，但不知道它什么意思
- `lastInferenceCount` 全部 `0` —— 没有任何一条被真正用过
- 出现次数：最多 82（大肥鱼），中位数 **1**，只出现 1 次的 **494 条 / 538**

也就是说这是一堆「自动抓来、没释义、基本只用过一次」的候选词。复核时大概率只留 count ≥ 3 的那十几条。

## 三、测试状态

### 核心链路（与本次改动相关）：20/20 通过

```
test-meme-lib  test-prompt-gating  test-prompt-gating-e2e  test-role-card-gate
test-unified-injection  test-message-idempotent  test-atself  test-reply-wait
test-qq-preset-contract  test-image-animation  test-backfill-retry  test-backfill-routing
test-quote-ledger  test-quote-fallback  test-pending-replies  test-wait-backlog
test-missed-at  test-at-diag  test-stream-recovery  test-mux-reconnect
```

跑法：`node scripts/<名字>.mjs`（**不要**用 `node --test`，沙箱里会 spawn EPERM）。

### 全量跑（`scripts/test-*.mjs`）60 通过 / 24 失败，失败全部是环境性的

| 失败 | 原因 |
|---|---|
| `test-preset-local-tools` | `无法定位 DSH 安装目录下的 node_modules`（DSH 现在在 asar 里，路径变了） |
| `test-console-ui` | Playwright 未安装 |
| `test-mcp-exec/host/safe/servers-stdio/web-search` | `spawn EPERM`（沙箱不允许起子进程） |
| `test-image-downscale` / `test-gif-handling` / `test-image-sheet` | 同上，ffmpeg 起不来 |
| `test-console` / `test-dsh-auth` / `test-dsh-v2-wait` | 3100 / 3080 端口没有服务在监听 |
| `test-onebot-connection` | SnowLuma 未启动 |
| `test-voice-system` | 缺 `docs/guides/VOICE.md` |
| `test-qq-model-view` | `spawn EPERM` |
| `test-time-awareness` / `test-qq-mode-plugin` / `test-tool-surface` / `test-audit*` / `test-setup-dsh-idempotent` / `test-dsh-session-retire` / `test-sticker-http-fallback` / `test-audit-setup` | 待白天逐个确认（多半同样依赖运行中的服务或外部网络） |

## 四、白天的第一件事

1. **启动 SnowLuma + 桥接**，看 `state/bridge.log` 有没有 `桥接已启动` → `SnowLuma 已连接` → `DSH 已就绪`。
2. **验证统一注入周期**：日志里应该同时出现
   `[promptGating] <key> 注入完整规则块（new-session）` 和 `[roleCard] <key> 注入完整角色卡（follow-gating）`
   —— 配对出现才说明两者同进同出。隔 5 轮应该一起退成占位。
3. **验证 outbox**：观察 `state/outbox.json` 是否在发送失败时出现、连上后是否清空。
4. **黑话复核**：打开 xlsx 删行，把保留的词条回填。

## 五、备份

改动前完整备份在 `<workspace>\qq-bridge\.bak-r2port-20261111-234514\`：

```
src/bridge.js             815878 B
src/mcp-snowluma-safe.js   88476 B
dsh/agent-presets/qq-chat-v2/agent.cordis.yml  27500 B
config.json                 7980 B
package.json                4703 B
src/prompt-gating.js        4836 B
```

回滚 = 把这 6 个文件拷回去。

---

# 2026-11-12 白天：验证 + 两项补丁

## 一、统一注入周期：已彻底验证（六个场景）

| 场景 | 证据 |
|---|---|
| `no-session-id`（会话未建） | 日志：两侧都完整 |
| `new-session`（刚建会话） | 日志：两侧都完整 |
| `same-session(2/5)` | 日志：两侧都占位 |
| `periodic(5/5)` | 日志：两侧都完整 |
| 单元测试 7 轮 | 第 1/4/7 完整，2/3/5/6 占位 |
| 运行时计数 | 5 个会话的 `roleCardWakes` 25 分钟零增长 |

**踩过一个会让人误判的陷阱**：行为测试第一次跑出来是「每轮角色卡都完整」，看着像 `fullOverride` 没生效。实际是 harness 没建角色卡文件，`roleBlockForPrompt` 在 `if (!roleState.role) return ''` 就提前返回了，**根本走不到决策逻辑** —— 测试把「没渲染」误读成了「渲染了全文」。现在测试会先写 `state/current-role.json` + `roles/测试角色.md`（带 `〔二代〕` 标记）。

## 二、atSelf：实跑验证通过

```
13:05:18 [atDiag] group:123456789 seq=1977 来自=群友A at段=Y 引用我=N 文本@昵称=Y → 唤醒=atMention
```

`at段=Y` = `atSelfNow` 正确识别 → 传进 `appendSocialV2Message` → 落库。10-24 那个「签名有、函数体没用」的坑，代码到运行时都闭合了。

## 三、新增：陈年未读下沉（48 小时）

**问题**：`group:123456789` 积了 11-01 晚上的 5 条未读（254 小时前），10 天过去每轮唤醒还在把它们塞进提示词 —— 白烧上下文，还会把 AI 引去接冷掉的话题。

**改法**（`src/bridge.js`）：

```js
const UNREAD_MAX_AGE_MS = 48 * 3600 * 1000;
function demoteStaleUnread(st, key) { /* 超过 48h 的从 unread 摘掉 */ }
function demoteAllStaleUnread()      { /* 启动时遍历已有会话 */ }
```

三个触发点：

| 触发点 | 覆盖场景 |
|---|---|
| `appendSocialV2Message` 末尾 | 有新消息进来时顺手清 |
| `buildWakePromptV2` 开头 | 桥接长时间静默、靠唤醒才发现 |
| 启动补拉前 `demoteAllStaleUnread()` | 群十天没说话，等不到上面两个 |

**为什么只摘不删**：这些消息进 `unread` 时已经同时 push 进 `recentMessages` 了（见 `appendSocialV2Message`），所以从 `unread` 摘掉就等于「沉到上文」，不需要搬数据。`lastUnreadSeq` 也不动 —— 它是单调计数器，退回去会让 `mark_read` 的水位错位。`time=0`（时间不明）的保守保留。

**测试**：`scripts/test-unread-demote.mjs`（4 条：10 天沉掉 / 47h 留 49h 沉 / time=0 保留 / 补拉旧账不受影响）。

## 四、补丁：跟随模式也更新 `roleCardSession`

原先跟随模式整个跳过记账，`roleCardSession` 停在 12:44 被停用的旧会话 id。虽然现在不读它，但**哪天去掉 `injectEveryNWakes` 切回独立计数，它会拿旧 id 跟当前会话比，误判成「换会话」多注入一轮全文**。

现在：`roleCardSession` 两种模式都写，只跳过 `roleCardWakes`。

## 五、待生效

**以上两项（未读下沉 + roleCardSession）还没重启，当前运行的是旧代码。** 下次桥接重启后自动生效，不需要额外操作。

重启后应能看到：

```
[unread] group:123456789 5 条超过 48 小时的未读已沉到上文（剩余 11 条待处理）
```

## 六、新一轮测试脚本挂载

| 脚本 | 断言数 | package.json | test-audit 清单 |
|---|---|---|---|
| `test-atself.mjs` | 7 | `test:atself` | ✅ |
| `test-message-idempotent.mjs` | 3 | `test:message-idempotent` | ✅ |
| `test-unified-injection.mjs` | 5 | `test:unified-injection` | ✅ |
| `test-unread-demote.mjs` | 4 | `test:unread-demote` | ✅ |

`test-audit.mjs` 是**手写清单**不是 glob，不加进去永远不会被跑到。

