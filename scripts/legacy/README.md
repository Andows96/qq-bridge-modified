# scripts/legacy — 归档的旧测试

这些测试来自 **v0.2.1-r1** 时代的本地改版，合并上游 **v0.2.2-rc1** 后已不适用：

上游重写了发送链路（`rememberSendChain` / `runWithDeliveryLock`，没有 `onebotSend` 降级重发）、
补拉与未读分流（`pendingDeliveryReplays` / `replayDeferredDeliveries`）、以及黑话接口
（`createSlangKeywordFilter` 已不存在），所以这些文件引用的 harness 方法与导出名都已消失。

| 文件 | 失效原因 |
| --- | --- |
| `test-quote-fallback.mjs` | 「引用失败去掉引用重发」这一行为已按设计移除，`h.onebotSend` 不存在 |
| `test-stream-recovery.mjs` | `refollowKnownSessions` 等旧 harness API 不存在 |
| `test-unread-demote.mjs` | 旧未读沉底规则，与 rc1 的交付游标模型不同 |
| `test-slang-exclude.mjs` | `createSlangKeywordFilter` 未导出 |
| `test-pending-replies.mjs` | `clearPendingReplyV2` 不存在 |
| `test-backfill-routing.mjs` | 旧补拉分流断言 |
| `test-backfill-retry.mjs` | `h.backfillOffline*` 不存在 |
| `test-missed-at.mjs` | `h.getLogs` 不存在 |
| `test-peer-typing.mjs` | 旧 harness API 签名不符 |
| `test-quote-ledger.mjs` | `h.resolveReplyTargetV2` 不存在 |
| `test-gif-handling.mjs` | 图片链路已改为 `src/media-normalize.js`，旧的 gif 处理路径不存在 |

## 使用原则

- **不参与** `node scripts/test-audit.mjs`，也不会被 `package.json` 的脚本调用。
- 不要据此判断当前版本是否回归；如需复测某项行为，请针对 `src/` 里的现行实现重写。
- 如果某个能力被重新引入（例如再次提供引用降级），把对应测试改写成新接口后移回 `scripts/`。
