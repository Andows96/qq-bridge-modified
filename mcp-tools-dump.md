# qq-bridge MCP 工具清单（35 个）

生成时间：2026-10-24T17:02:28.082Z
配置：preSleepWaitMs=300000，batchWindowMs=10000
描述总字符数：6166

## 1. `qq_status`

查询 QQ 机器人登录状态与账号信息（只读）。

（无参数）

## 2. `qq_get_group_members`

列出指定群的成员（只读）：QQ 号、昵称、群名片。等特定的人、要 @ 某个人、或需要确认谁在群里时用；QQ 号取返回里的 userId。只返回白名单群，且只读取桥接允许的会话。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 |
| `token` | string |  | 会话令牌（见唤醒提示中的【会话令牌】；closed-agent 模式不需要） |
| `limit` | number |  | 最多返回多少成员，默认 50，最大 100 |

## 3. `qq_send_group_message`

向指定 QQ 群发送一条纯文本消息；如需引用某条消息，可传 replyToMessageId（非零整数，可为负数），可先用 qq_get_recent_messages / qq_get_message_detail 查询。二代模式（reserved2）下这是可用的发送工具之一，但优先使用 qq_send_message；reserved2 下调用时必须携带会话令牌 token，否则会被拒绝。不要在发送后输出“已发送”类汇报。目标群必须命中系统白名单（config.json 的 allow.groups），否则拒绝。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `groupId` | number|string | ✅ | 群号（必须在白名单内） |
| `message` | string | ✅ | 消息文本，纯文本，不要用 Markdown 或 CQ 码 |
| `replyToMessageId` | number|string |  | 要引用/回复的消息 id（非零整数，可为负数，可选） |
| `token` | string |  | 二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要） |

## 4. `qq_reply`

在指定 QQ 群里引用/回复某条消息，并发送一条文本。适合群消息很多、需要明确“我回的是哪条”时使用；replyToMessageId 是被引用消息的 id（非零整数，QQ 消息 id 可能为负数），可先用 qq_get_recent_messages / qq_get_unread_messages / qq_get_message_detail 查到具体消息内容和 id。发送前桥接会校验该 id 存在且属于当前会话。二代模式下这是你正常可用的引用工具，但不要每条都引用。只有以下情况才需要引用：① 你这条消息指向的人或消息并非最新一条别人的消息（也就是你在回更早的某条）；② 你连续几句话里不同消息指代的是不同的消息或不同的人。其他情况（上下文唯一、刚在接同一条最新消息）不要引用，别让对方猜，也别为了用工具而用。reserved2 下调用时必须携带会话令牌 token。目标群必须命中系统白名单（config.json 的 allow.groups），否则拒绝。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `groupId` | number|string | ✅ | 群号（必须在白名单内） |
| `replyToMessageId` | number|string | ✅ | 被引用/回复的消息 id（非零整数，可为负数） |
| `message` | string | ✅ | 要发送的文本，纯文本，不要用 Markdown 或 CQ 码 |
| `token` | string |  | 二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要） |

## 5. `qq_send_private_message`

向指定 QQ 好友发送一条私聊消息。若提供 replyToMessageId，会以 QQ 引用/回复形式发出（引用条 + 文本）。replyToMessageId 必须是非零整数消息 id（QQ 消息 id 可能为负数），可先用 qq_get_message_detail 查询。二代模式（reserved2）下这是可用的发送工具之一，但优先使用 qq_send_message；调用时必须携带会话令牌 token，否则会被拒绝。不要在发送后输出“已发送”类汇报。目标 QQ 必须命中系统白名单（config.json 的 allow.private），否则拒绝。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `userId` | number|string | ✅ | 好友 QQ 号（必须在白名单内） |
| `message` | string | ✅ | 消息文本，纯文本，不要用 Markdown 或 CQ 码 |
| `replyToMessageId` | number|string |  | 要引用/回复的消息 id（非零整数，可为负数，可选） |
| `token` | string |  | 二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要） |

## 6. `qq_get_prompt`

查看当前二代仿真模式的提示词/角色/推荐值/可用工具/当前唤醒配置（只读）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |

## 7. `qq_get_unread_messages`

查看未读消息，不自动标记已读。大量积压或快照 partial=true 时，用 afterSeq=readThroughSeq 从水位后按时间顺序补读；从最早未读开始传 0。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `limit` | number |  | 最多返回条数，默认 30，最大 100 |
| `afterSeq` | integer |  | 读取本地 seq 大于此水位的最早一页；省略则沿用返回最新一页的旧行为 |

## 8. `qq_get_recent_messages`

查看指定会话的最近消息（只读），支持 offset 扩大范围。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `limit` | number |  | 最多返回条数，默认 20，最大 100 |
| `offset` | number |  | 跳过最近 N 条，用于向前翻看更早消息，默认 0 |

## 9. `qq_social_state`

查看指定会话的二代仿真状态：WakeConfig、未读数、上次唤醒原因、上次发言时间等（只读）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |

## 10. `qq_mark_read`

将指定会话已查看的未读消息标记为已读。throughSeq 使用最近读取结果的 readThroughSeq，避免清除读取后才到达的新消息；省略 throughSeq 会按旧行为清空当前全部未读，因此推荐始终带上水位。注意：每次设置潜水/下一次唤醒前，桥接要求先用 qq_wait_for_messages(timeoutMs=300000) 完成一次沉睡前观察：5 分钟内没人说话可 mark_read 收尾沉睡；期间有人发新消息则先查看 newMessages，判断不需要你参与也可直接 mark_read 收尾；若你参与了回复，则下次想睡需重新等待观察窗口。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `throughSeq` | integer |  | 本次确认已读的消息水位，使用已查看结果中的 readThroughSeq；不会清除更晚到达的消息 |

## 11. `qq_set_wake_config`

设置指定会话的二代唤醒配置：mode/无限期或有限时间/提前唤醒条件（@、名字、关键词、提问、拍一拍、概率、anyMessage、指定成员）。triggers.speakerIds 是可选的“指定群友发言唤醒”：填一个或多个群友 QQ 号后，只要其中任意一位在群里发言就会唤醒你；不设置则不启用。适合在等某个人回复、或某人反应慢怕错过时使用。triggers.poke 开启后，群里有人拍一拍（包括拍你或拍别人）会唤醒你。注意：每次设置潜水/下一次唤醒前，桥接要求先用 qq_wait_for_messages(timeoutMs=300000) 完成一次沉睡前观察：5 分钟内没人说话可设置并沉睡；期间有人发新消息则先查看 newMessages，判断不需要你参与可直接设置并沉睡；若你参与了回复，则下次想睡需重新等待观察窗口。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `throughSeq` | integer |  | 可同时确认已读：使用已查看结果中的 readThroughSeq，省去额外 qq_mark_read；不传则只设置唤醒配置。若 markRead 工具被关闭，该水位会被忽略，本工具只设置唤醒配置 |
| `config` | object | ✅ | 要设置的唤醒配置，缺省字段保留原值 |

## 12. `qq_send_burst`

在指定 QQ 群分多条发送消息（二代仿真模式专用），桥接会按真人化随机间隔发送。暂不支持引用，需要引用请用 qq_reply。注意：数组里的每个字符串就是一条 QQ 消息，字符串内部不要用空格分隔中文短句，需要多条请用数组元素；每条消息要读起来完整，不要把同一句话拆到两条里。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `groupId` | number|string | ✅ | 群号（必须在白名单内） |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `messages` |  | ✅ | 要发送的消息数组，每条为纯文本；也兼容传入 JSON 数组字符串 |

## 13. `qq_send_message`

统一发送工具：可发一条或多条，可引用某条消息，可自定义/按字数计算条间时间差。二代仿真模式专用。注意：字符串=一条消息，数组=多条消息；每个字符串内部不要用空格分隔中文短句，需要多条请用数组元素；每条消息要读起来完整，不要把同一句话拆到两条里。只有以下情况才需要传 replyToMessageId 引用：① 你这条消息指向的人或消息并非最新一条别人的消息（也就是你在回更早的某条）；② 你连续几句话里不同消息指代的是不同的消息或不同的人。其他情况（上下文唯一、刚在接同一条最新消息）不要引用，别让对方猜，也别为了用工具而用。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `messages` |  | ✅ | 要发送的内容：字符串=一条；数组=分多条 |
| `replyToMessageId` | number|string |  | 要引用/回复的消息 id（非零整数，可为负数，可选） |
| `atUserId` | number|string |  | 要 @ 的群成员 QQ 号（群聊中用于点名某个人；与引用二选一即可，不要滥用） |
| `gapMode` | string |  | auto=桥接随机；fixed=固定间隔；byLength=按字数计算 |
| `gapMs` | number |  | fixed 模式下的统一间隔（毫秒） |
| `gaps` | array |  | fixed 模式下逐条间隔（长度=条数-1） |

## 14. `qq_send_poke`

发送 QQ 拍一拍（群聊/私聊）。适合用“戳一下”代替一句废话、提醒对方、自然回应别人的拍一拍，或偶尔主动戳一下正在聊的人/熟人——这样更拟真；但别频繁，真人不会一直戳人。群聊必须传 targetUserId（要拍的群友 QQ 号，可从 qq_get_active_members / qq_get_message_detail 的 userId 获取）；私聊可不传 targetUserId（默认拍当前私聊对象）。reserved2 下必须携带会话令牌 token，发送会受桥接白名单与发送频率限制。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `targetUserId` | number|string |  | 要拍的群友 QQ 号（群聊必填；私聊可选） |

## 15. `qq_wait_for_messages`

等待分两种用途。首答前已读消息、只想确认有没有补充：用 purpose="reply"，按最后来信时间补足 quietMs 静默，已安静足够就立即返回；读取/思考时新到的消息也会返回，新消息重算静默。timeoutMs 是最长预算，不要求等满；预算到但 quiet=false 不代表对方已说完。此用途绝不代替沉睡前观察。等对方继续说、等回复或睡前观察：用默认 purpose="messages"；先等新消息，收到后才按 quietMs 等静默，没有新消息会等到 timeoutMs，单传 quietMs 不会缩短总等待。静默下限由后台配置，默认 10000ms。**返回里的 canSleepNow / countsAsObservation / hint 直接告诉你现在能不能收尾、该用多大的 timeoutMs——照它做，不要反复试**：canSleepNow=true 就可以直接 mark_read / set_wake_config；false 时按 hint 给的 timeoutMs 一次等满（更短的等待不算沉睡前观察，满足不了闸门）。直接看 newMessages、unreadCount 和 readThroughSeq，返回消息无需重复查询；仍有未展示未读才补读。决定潜水/收尾时才用默认用途加 timeoutMs=300000 完成沉睡前观察，不能把 5 分钟观察放在首答之前；短等待不能代替。全程无人说话返回 preSleepWaitSatisfied=true；观察期间来了新消息返回 preSleepWaitObserved=true，读后不需参与可收尾，参与回复则下次收尾重新观察。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `purpose` | string |  | 默认 messages：等新消息/回复/睡前观察；reply：回复前短静默，计入最后来信后已过去的时间，绝不授予睡前观察资格 |
| `timeoutMs` | number |  | 等待预算毫秒数，默认 30000、最大 600000；reply 达到静默即返回，不必等满；沉睡前观察用 messages 并传 300000 |
| `minNewMessages` | number |  | 仅 messages 用途：至少等到多少条新消息才进入静默窗口，默认 1；reply 用途会忽略它 |
| `quietMs` | number |  | 静默窗口毫秒数，建议 10000~12000；reply 从最后来信开始计时，messages 只在等到新消息后计时；后台默认至少 10000 |

## 16. `qq_report_feedback`

向控制台/管理端反馈 AI 遇到的问题、困惑或需要管理员介入的情况。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `level` | string |  | 反馈级别，默认 info |
| `message` | string | ✅ | 反馈内容 |

## 17. `qq_get_my_recent_messages`

查看自己最近发过的消息（只读），避免重复/保持人设。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `limit` | number |  | 最多返回条数，默认 10，最大 50 |

## 18. `qq_get_message_detail`

按 message_id / 本地 seq 查看单条消息的发送者、引用信息与正文（只读）。注意：正文最多返回 200 字符，textTruncated=true 表示被截断，这里不是读取长消息全文的入口。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `messageId` | number|string | ✅ | 要查看的消息 id（QQ 消息 id 可能为负数） |

## 19. `qq_get_active_members`

查看最近活跃成员列表（只读），帮助判断话题参与者。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `limit` | number |  | 最多返回人数，默认 10，最大 20 |

## 20. `qq_memory_append`

记录一条轻量记忆：activeTopic=进行中的话题；pendingThought=你想说但还没说的话；memberImpression=对某位群友的印象。记忆会持久化，并在后续唤醒/qq_get_prompt 中自动出现。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `category` | string | ✅ | 记忆类别 |
| `content` | string | ✅ | 记忆内容，例如话题、想说的话、对某人的印象标签 |
| `extra` | object |  | 附加信息 |

## 21. `qq_memory_query`

查看当前会话的轻量记忆：进行中的话题、你想说但还没说的话、对群友的印象（只读）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `category` | string |  | 可选：只看某一类记忆 |

## 22. `qq_memory_remove`

删除一条轻量记忆：activeTopic/pendingThought 用 content 匹配原文删除；memberImpression 用 target 参数指定群友名字删除。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `category` | string | ✅ | 记忆类别 |
| `content` | string |  | 要删除的话题/想法原文（memberImpression 不需要） |
| `target` | string |  | memberImpression 时要删除的群友名字 |

## 23. `qq_memory_clear`

清空轻量记忆：不传 category 清空全部；传 activeTopic/pendingThought/memberImpression 只清空对应类别。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `category` | string |  | 要清空的类别，缺省清空全部 |

## 24. `qq_slang_query`

查看当前已确认的群聊黑话/梗/网络表达（只读）。返回已确认词条列表和格式化黑话表；遇到不熟悉的词可先查这里，再决定是否搜索/使用。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `q` | string |  | 可选搜索词，按词条/含义/用法/示例过滤 |

## 25. `qq_slang_submit`

把你在群里经常看到但不确定含义/用法的陌生词、黑话、梗或网络表达提交给管理员筛选。提交后进入候选库，管理员确认后会被写入黑话提示词，成为你后续可查询和使用的记忆。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `content` | string | ✅ | 要提交的陌生词/黑话/梗（最多 50 字） |
| `context` | string |  | 可选：你是在什么语境/哪条消息里看到的，帮助管理员判断 |

## 26. `qq_get_message_images`

获取指定 QQ 消息中的图片/表情，并直接以图像内容返回给模型（视觉模型可“看懂”）。当消息文本里出现 [图片]、[表情] 或 hasMedia=true 时调用。支持一条消息里的多张图片/表情；二代模式下必须携带会话令牌。**动图（GIF/动态表情）会被桥接抽帧拼成多格图再给你**：说明里会写「动图 N 帧/…s，已抽 X 帧拼成 A×B 网格，行优先 左上→右下」——按格子顺序理解动作即可，不要把它当成一张九宫格照片；没有这类说明就是静态图。体积过大的图会被自动缩放/重编码，说明里会给出原始尺寸与体积；如果真的压不到可用体积，返回里会直接写明原因（例如「超过上限」），此时如实告诉对方你看不到，不要编造画面。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `messageId` | number|string | ✅ | 要查看的消息 id（QQ 消息 id 可为负数；二代也可用本地 seq） |
| `token` | string |  | 二代会话令牌（reserved2 下必填，见唤醒提示中的【会话令牌】） |

## 27. `qq_list_memes`

列出/搜索**本地表情图库**（DSH 里 dsh-meme 管理的图包，例如鲸鱼娘「大肥鱼」、女仆表情包）里的表情。每条返回：图库 id（pack）、图库内相对路径（path）、情绪分桶（tag）、中文画面描述（caption）、搜索关键词（keywords）。挑好后用 qq_send_meme 把 pack + path 原样发出去。注意：① 这和图库 qq_list_stickers（QQ 账号收藏表情）是两套不同的库，不要混用；② path 只能原样使用，不能改写成绝对路径，也不能编造；③ 表情发送建议先用 query/tag 缩小范围，图库大时别一次列全。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `tag` | string |  | 情绪分桶过滤，如 angry/happy/sad/shy/confused/daily/work/sleep/baka 等（看图库实际有哪些） |
| `query` | string |  | 中文关键词搜索，空格分隔多个词（全部命中才返回），例如「生气 叉腰」 |
| `limit` | number |  | 最多返回条数，默认 40（图库大时建议配合 tag/query 精确筛，别一次列上百条） |

## 28. `qq_send_meme`

把**本地表情图库**里的一张表情发到当前会话（图库由 qq_list_memes 列出）。参数 pack + path 必须原样抄 qq_list_memes 返回的值（也可只传 path，若只有一个图库可直接省略 pack）。注意：① 一条表情消息只能是一张图，**不能附带文字**；想说话请先用 qq_send_message / qq_reply 单独发一条；② 发送前有 0.8~2 秒真人停顿，别连发；③ 有每分钟/每小时上限，超了会返回 429；④ 动图会被拒（QQ 图片消息只吃静态帧）；⑤ 这与 qq_send_sticker（QQ 收藏表情）是两套库，别混用 id。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `pack` | string |  | 图库 id（qq_list_memes 返回的 pack 字段），如 dafeiyu-001 / maid-emoji；只有一个图库时可省略 |
| `path` | string | ✅ | 图库内相对路径（qq_list_memes 返回的 path 字段，原样抄，如 memes/happy/kaixin.png） |
| `replyToMessageId` | number|string |  | 要引用/回复的消息 id（可选，非零整数，可为负数） |
| `atUserId` | number|string |  | 要 @ 的群成员 QQ 号（可选，仅群聊） |

## 29. `qq_list_stickers`

查看 QQ 账号上已收藏的表情包（自定义表情）列表：包含 emoji_id、备注 desc、本地笔记 localNote、标签 tags、使用次数等。可通过 query 按备注/笔记/标签搜索；无备注的表情可以先调用 qq_get_sticker_image 看图理解，再用 qq_sticker_note 记下含义。刚新增/删除表情后如需立即同步，请传 refresh=true。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `query` | string |  | 可选搜索词，按备注/本地笔记/标签/用法过滤 |
| `count` | number |  | 最多返回条数，默认 48，受 socialV2.sticker.maxListCount 配置上限约束（当前通常 100） |
| `refresh` | boolean |  | 是否强制从 QQ 重新同步收藏表情，默认 false（走缓存） |

## 30. `qq_get_sticker_image`

获取指定收藏表情的图片内容并直接以图像返回给模型（视觉模型可“看懂”）。当 qq_list_stickers 返回的表情 desc/localNote 为空、或你想确认表情实际长什么样时调用。stickerId 可用 qq_list_stickers 返回的 id / md5 / url。动图表情会被抽帧拼成多格图（行优先：左上→右下），说明里会写帧数与网格尺寸；体积过大时会自动缩放，说明里会给出原始尺寸。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `stickerId` | string | ✅ | 表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers） |

## 31. `qq_send_sticker`

在指定会话发送一个 QQ 收藏表情包（自定义表情）。stickerId 用 qq_list_stickers 返回的 id / md5 / url。注意：一条消息只能是一张表情，不能在同一气泡里附带文字；想说的话请先用 qq_send_message / qq_reply 作为单独气泡发送，再单独发这张表情。需要引用/点名时可用 replyToMessageId / atUserId（群聊）。真人偶尔用表情包很自然，但别刷屏。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `stickerId` | string | ✅ | 表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers） |
| `replyToMessageId` | number|string |  | 要引用/回复的消息 id（非零整数，可为负数，可选） |
| `atUserId` | number|string |  | 要 @ 的群成员 QQ 号（群聊中可选，私聊不可用） |

## 32. `qq_collect_sticker`

收藏当前会话里别人发的一张表情/图片到你的 QQ 收藏表情，并可写一句简短备注（如“好图偷了，兄弟”）。messageId 用 qq_get_unread_messages / qq_get_recent_messages 返回的 messageId 或 seq。注意：不要频繁收藏，只在真的觉得有意思/好用/戳中你时才偷图；收藏后你可以在 qq_list_stickers 里看到并继续使用。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `messageId` | string | ✅ | 要收藏的那条消息的 messageId 或 seq（来自 qq_get_unread_messages / qq_get_recent_messages） |
| `remark` | string |  | 简短备注，最多 20 字，例如“好图偷了，兄弟” |

## 33. `qq_get_self_image`

查看你自己的默认 Q 版形象图片（DeepSeek 小鲸鱼形象）。当你被问“你长什么样/发张自拍/你是什么形象”时，可以调用这个工具看自己的样子；返回的图片会直接进入你的视觉上下文。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |

## 34. `qq_sticker_note`

给一个收藏表情记录你自己的理解/备注/标签/用法，供以后选择表情时参考。这是本地记忆，不会修改 QQ 账号的官方备注；适合对没有备注的表情看图后记住含义。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `stickerId` | string | ✅ | 表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers） |
| `note` | string |  | 你理解的表情含义/适合场景，最多 200 字 |
| `tags` | array |  | 可选标签，如 ["嘲讽","笑哭","怼人"] |
| `usage` | string |  | 可选用法说明，最多 200 字 |

## 35. `qq_get_forward_msg`

查看当前会话中出现的合并转发消息/聊天记录内容（只读）。当消息文本里出现 `[转发消息 id=...]`，或 `qq_get_unread_messages` / `qq_get_recent_messages` / `qq_get_message_detail` 返回的某条消息带 `forwardIds` / `hasForward: true` 时调用。只能查看当前会话确实收到过的转发消息 id，不能任意读取。返回内容会包含每条消息的 text、media（图片/表情元数据）与 nestedForwardIds；如果合并转发里有图片，工具会直接把最多 5 张图片以图像内容返回给视觉模型；如果里面有嵌套合并转发，会附带嵌套转发 id 和前几条预览，必要时可继续用本工具查看嵌套 id。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 会话 key，格式 group:群号 或 private:QQ号 |
| `token` | string | ✅ | 会话令牌（见唤醒提示中的【会话令牌】） |
| `id` | string | ✅ | 合并转发消息 id（来自消息里的 [转发消息 id=...] 或 forwardIds 数组） |
