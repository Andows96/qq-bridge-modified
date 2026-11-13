# qq-bridge

> [!NOTE]
> **这是个人改版（fork）**：本仓库基于上游 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) 的 `v0.2.2-rc1`，改版仓库为 [Andows96/qq-bridge-modified](https://github.com/Andows96/qq-bridge-modified)。
> 相对上游的改动见下方「改版说明」；其余章节（安装、配置、架构、故障排查）沿用上游原文，尚未逐一改写。

## 改版说明（相对上游 v0.2.2-rc1）

改动分三类：**新增能力**、**行为修正**、**与上游的分歧**。文件路径均相对仓库根。

**1. 提示词分段注入（省 token）**
规则块（你的身份／反AI味／积极性／表情包策略／沉睡前强制等待）与角色卡不再每轮全文注入：同一 DSH 会话首轮全量，之后按统一周期（默认每 5 轮）补一次，其余轮只留一行占位；表情包**清单**、引用规则、时间感等动态段每轮照发。
- `src/prompt-gating.js`（判据 `decidePromptBlocks` + 占位文案）、`src/role-card-gate.js`（`decideRoleCardInjection`）
- 接线：`src/bridge.js` 的 `promptGatingCfg()` / `promptGatingDecision()` / `roleForWake()`；`buildWakePromptV2` 组装占位
- 计数落 `state/prompt-gating.json`（**不能**塞 `social-v2.json`，那里只持久化白名单字段）
- 配置：`socialV2.promptGating{enabled,metaEveryWakes,dedupeMs}`、`socialV2.role.injectEveryNWakes`、`socialV2.roleCard{mode,fullEveryWakes}`

**2. 动图表情收藏拦截**
QQ 的 `add_custom_face` 只吃一帧静态图，收藏动图等于把它压成首帧。现在在拼 `base64://` 之前用 `media-normalize` 的 `sniffImage()`（字节级，不看扩展名 —— QQ 会用 `.jpg` 存 GIF）判定 `animated`，命中即整条拒绝，不上传。
- `src/bridge.js` 的 `assertStickerCollectable()`，接入 `collectStickerV2()` 的图片与 face 两条分支
- 回归：`scripts/test-sticker-animated-guard.mjs`

**3. 时效规则分档修正**
`@你 / 引用你` 的窗口是 **48 小时**（必回且必须 `qq_reply` 引用）；**普通消息**以 120 分钟为界，超时默认不回、`qq_mark_read` 收尾。此前把两者混成一档，导致 4 小时前的 @ 被判成「太旧不回」。

**4. 「主动回复黑名单」恢复**
上游删掉了 `socialV2.proactive.disabledKeys` 的消费逻辑，配置项变成死键。本改版补回：命中黑名单的会话不排期主动冒泡（回复、@、关键词唤醒完全不受影响），并在控制台「主动机会参数」组加了对应的多行输入框。

**5. 事件流启动竞态修复**
`dsh.baseUrl` 允许留空（靠三级发现），但 `pumpMux()` 曾在发现完成前就连接，抛出 `Invalid URL` 并在日志里留下一条假的「事件流中断」。现在先等端点解析再连。

**6. 图片链路改用上游实现**
不再自带 `src/image-downscale.js`、`src/image-animation.js`，统一用上游的 `src/media-normalize.js`（`sniffImage` / `planAnimation` / ffmpeg `tile=` 抽帧拼联系表）；`socialV2.image{triggerBytes,targetEdge,qscale}` 三个键作废，改用 `socialV2.media{maxModelBytes,maxLongEdge,gifFrames,gifTile,normalizeTimeoutMs}`。

**7. 许可统一**
根 `package.json` 与 `plugins/qq-agent-presets`、`plugins/qq-mode-console` 三处 license 统一为 `PolyForm-Noncommercial-1.0.0`（跟随上游 `v0.2.2-rc1`）。

**8. 依赖**
`@modelcontextprotocol/sdk` `^1.32.2`、`zod` `^4.6.7`（`package-lock.json` 可能滞后于实际安装版本，本机没有 npm 时是用 pnpm 取包再拷进 `node_modules`）。

**9. 保留的本地定制（非上游内容）**
- 人格：`dsh/agent-presets/qq-chat-v2/agent.cordis.yml`（自用角色卡与节奏参数，含上游的两段安全文案）
- 工具限制：`plugins/qq-agent-presets/qq-tool-restrict.mjs`（bili 上下文压缩白名单：放行 `compress`/`acp_status`，隐藏回读类工具）

> 审计基线：`node scripts/test-audit.mjs` 在本改版上为 **52/58**——3 个失败来自沙箱 `spawn EPERM`（给权限单跑即过），3 个来自上表第 9 条的自定义内容（`test-qq-preset-contract`、`test-preset-local-tools`、`test-tool-restrict-guard` 断言的是上游文案/清单）。

**10. 归档的旧测试（`scripts/legacy/`）**
上游 rc1 重写了发送、补拉、未读分流与黑话接口，0.2.1-r1 时代的 11 个测试因此断言的是已不存在的 API/行为（报 `h.onebotSend is not a function`、`createSlangKeywordFilter` 未导出等）。它们已移入 `scripts/legacy/`，不参与 `test-audit`，保留仅作参考；与当前代码无关，请勿据此判断回归。

[English](README.en.md) · [安装指南](docs/guides/DSH_SETUP.md) · [问题反馈](https://github.com/Derpyu520/qq-bridge/issues)

qq-bridge 是一个本地消息桥接工具，在 SnowLuma 提供的 **OneBot v11 接口**与 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 之间转发消息事件和 AI 回复。

当前候选版本：`v0.2.2-rc1`（GitHub prerelease），适配目标为 DSH `0.2.2-rc.1`。

> [!IMPORTANT]
> **qq-bridge 是独立维护的第三方工具，不是 SnowLuma 的子项目，也不隶属于 SnowLuma、DeepSeek 或腾讯 / QQ。**
> 本项目通过 SnowLuma 提供的 **OneBot v11 接口**互通；桥接与 SnowLuma 后端分别部署、独立维护，无隶属、合作或背书关系。OneBot v11 是公开协议，并非 SnowLuma 专有协议。
>
> **术语与边界**：本项目不向 QQ 客户端或 SnowLuma 进程注入、挂钩，不修改 SnowLuma 本体或其原生组件；但会读取本机 OneBot 配置与接入令牌、连接 OneBot 接口，并在 `npm install` 时修补本机 `@snowluma/sdk` 的 ESM 导入。文档中的“人格注入”指提示词写入，“提示注入”指不可信内容攻击；上游 `[Hook]` 仅指 SnowLuma 的接入机制，不是本项目的行为。

```text
QQ ↔ SnowLuma ↔ qq-bridge ↔ DeepSeek Harness ↔ 模型服务
             OneBot v11
```

## 能做什么

| 场景 | 功能 |
| --- | --- |
| 消息桥接 | 按群聊 / 私聊维护独立会话，支持文本、图片、表情与引用回复 |
| 聊天与仿真 | 普通聊天（`chat`）、两代群友仿真（`reserved` / `reserved2`）、自定义角色 |
| 个人助手 | `closed-agent` 仅限管理员私聊，可使用完整 DSH 工具；请谨慎开启 |
| 本地管理 | 控制台切换模式、管理白名单与审批、查看日志和模型用量 |

## 快速开始

准备好 **Windows 10 / 11、Node.js ≥ 22.13**（与 DSH 0.2.2 同机部署需 ≥24.9），以及以下两个独立运行的服务：

- **DSH Web**：当前有 `0.2.2-rc.1` 的验证记录（上一版为 `0.2.1-rc.2`），其他版本见[兼容范围](docs/guides/DSH_SETUP.md#兼容范围)。
- **SnowLuma**：请自行按[上游文档](https://github.com/SnowLuma/SnowLuma)安装、启动并登录，开启 OneBot **WebSocket 服务端**和 **HTTP API**。

### 1. 获取项目

在 PowerShell 中运行：

```powershell
git clone https://github.com/Derpyu520/qq-bridge.git
cd qq-bridge
npm install
Copy-Item config.example.json config.json
```

默认分支 `main` 为正式发布线；`dev` 用于开发与测试。

### 2. 填写配置

编辑 `config.json`，至少核对这些字段：

| 字段 | 填写内容 |
| --- | --- |
| `dsh.baseUrl` | DSH Web 地址，默认 `http://127.0.0.1:3080`；模型选择需与 DSH 中可用的配置一致 |
| `dsh.provider` / `model` / `reasoningEffort` | 模型提供方、模型名与思考强度；强度可使用 DSH 模型目录公布的档位，设为 `none` 表示不下发该字段、跟随模型默认 |
| `snowluma.wsUrl` / `httpUrl` | OneBot WebSocket / HTTP 地址，示例分别为 `ws://127.0.0.1:3001` / `http://127.0.0.1:3000`，不要混用端口 |
| `snowluma.accessToken` / `homeDir` | 按实际配置填写令牌与 SnowLuma 安装目录；HTTP、WS 令牌不同时，需能从该目录发现各自令牌 |
| `ownerQQ` | 你的管理员 QQ 号 |
| `allow.private` / `allow.groups` | 允许接入的 QQ 号 / 群号；默认空白名单不响应任何会话 |

同机运行时，`dsh.authToken` 通常留空，由桥接使用本机 DSH 凭据完成鉴权。完整配置与连接排查见[安装指南](docs/guides/DSH_SETUP.md)。

### 3. 安装 DSH 插件

```powershell
node scripts/setup-dsh.mjs
```

这一步会把聊天预设和 MCP 工具接入 DSH，**首次安装也必须执行**。完成后重启 DSH；使用非 `web` profile 时见[安装指南](docs/guides/DSH_SETUP.md#安装步骤)。

### 4. 启动并测试

```powershell
npm start
```

打开 [本地控制台](http://127.0.0.1:3100) 并输入控制台令牌。自动生成的令牌保存在 `state/console-token`；如果已在 `config.json` 配置 `consoleToken`，则使用该值。启动日志不会打印令牌。新装默认使用二代仿真模式（`reserved2`），会选择性发言；测试收发时可先切到 `chat`，再从白名单会话发送消息。

Windows 也可双击 `start.bat` 以守护模式运行，关闭窗口即停止。

## 文档与开发

| 我想…… | 入口 |
| --- | --- |
| 安装、升级或排查连接 | [DSH 安装指南](docs/guides/DSH_SETUP.md) |
| 了解模式、权限与管理命令 | [使用规则](RULES.md) |
| 查看模型用量与费用口径 | [用量看板](docs/guides/TOKEN_USAGE_CONSOLE.md) |
| 参与开发 | [贡献指南](CONTRIBUTING.md) · [安全基线](docs/guides/SECURITY_BASELINE.md) |
| 报告安全漏洞 | [安全报告](SECURITY.md) |
| 查找其他说明 | [文档索引](docs/README.md) |

开发基于 `dev`，提交 PR 前运行离线回归：

```powershell
npm run test:audit
```

## 使用边界与许可

- 仅在知情并获准的会话中使用，遵守平台规则；使用非官方 QQ 后端可能导致账号受限。
- 聊天内容会经 DSH 发送给所配置的模型服务；黑话自动研究默认开启，可能将提取的关键词发送给搜索服务。数据流与关闭方式见 [NOTICE](NOTICE.md#四数据传输)。
- 保护 `config.json`、`state/` 与控制台令牌，保持服务仅在本机可访问。
- DSH 离线期间的消息队列仅保存在内存中，每个会话最多 50 条；桥接进程退出后队列丢失，不保证送达。
- 本工具不实现 QQ 登录或底层协议，不安装、打包或启停 SnowLuma 后端；当前客户端仍依赖 `@snowluma/sdk` 等包，第三方组件适用各自条款。

当前代码按 [PolyForm Noncommercial 1.0.0](LICENSE) 提供，限非商业用途；`v0.2.1-r1` 及更早已发布版本沿用其发布时的 MIT 许可。第三方组件、独立关系与使用风险见 [NOTICE](NOTICE.md)。
