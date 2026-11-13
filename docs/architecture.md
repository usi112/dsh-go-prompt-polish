# 原理与边界

## 数据流

```
App（原生界面）
  │ 点胶囊 → POST /dsh-go/v1/invoke  { surface: composer.actions, id: polish, context: { draft } }
  ▼
bridge（dsh-go-bridge）
  │ 校验 effect、scope、限额；3 秒处理窗口
  ▼
插件 local-prompt-polish
  ├─ loadConfig()（.config.json，按文件原文比对缓存）
  │    └─ enabled=false → { open: panel:polish-settings, toast }，不起任务
  ├─ 读 draft；< 4 字 → toast 返回
  ├─ polishOptions(config) → { length, keepTerms, keepCode, preset?, extra? }
  ├─ 起优化任务（内存 job，key = sessionId）
  │    ├─ resolveRoute: 会话模型 → request/header → 部署默认
  │    ├─ collectContext: 最近 8 条消息，每条 320 字，总 ≤1600 字
  │    ├─ requestPolish: prepareCall(关思考, 档位 maxTokens, 25s) → 流式取文本
  │    │     ├─ systemPrompt(zh, strict, options)：4 条保留 + 7 条篇幅 + 预设(8) + 附加(9)
  │    │     └─ stripEcho: 切掉开头复述；纯复述 → 严格重试一次
  │    └─ 失败/无路由 → buildLocalPrompt（本地收紧，同一档位的字数上限）
  └─ 返回 { open: panel:polish-panel }
        │
        ▼
确认页（panels 数据流）
  data(scope, emit) 先推 loading，任务完成后再推 ready
  showNotes=true 时多渲染一块「改写说明」（notesFor 拼来源/档位/预设/开关/字数）
  按钮：copy / append / cancel → 各自返回 effect
```

## 为什么是“面板 + 复制”，不是“直接替换”

effect 白名单没有 replace/clear；`insert` 在 App 侧是合并。因此：

- **copy**：只写剪贴板，零副作用；用户全选粘贴后输入框里只剩优化稿；
- **insert**：语义诚实，但会把原文留在前面，所以做成显式按钮而不是默认；
- **cancel**：只 toast。

上游已收到 `replace` effect 建议（dsh-Go#1148）。一旦落地，改动点是：`resolveRoute` 旁边加能力探测（`caps.features` 含 `draft.replace`），`deliver()` 从 copy 切到 replace。

## 设置与配置

设置页不是第二套状态：页面上的一切都从 `.config.json` 现读，保存就直接写回去。两个文件分工：

| 文件 | 职责 | 不做什么 |
|---|---|---|
| `lib/config.js` | 唯一读写 `.config.json` 的地方：`defaults()`、`normalize()`（逐字段回落 + 截断）、`loadConfig()`（读原文与上次比对，相同才复用解析结果）、`saveConfig()` / `resetConfig()`（tmp + rename 原子写）、预设增删改查、`polishOptions()` | 不画界面、不碰 effect |
| `lib/settings.js` | 只画面板 `polish-settings`：`settingsView()` / `createData()` / `createActions()`（13 个 action）、v2 表单与 v1 摘要页 | 不持有配置状态，不缓存用户输入 |

### 表单 submit 的形状

视图 v2 的 `form` 提交时，插件 action 收到：

```
action = 'presetSave' | 'saveLength' | 'saveOther'
event  = { locale: 'zh-CN', value: { values: { 'data.form.length': 'simple', 'data.form.keepCode': true, … } } }
```

- 键名就是视图里的 `bind`，值是该控件的当前值（布尔 / 字符串）。
- `valuesOf(event)` 只接受 `event.value.values` 是普通对象，否则当空对象；缺键用磁盘上的当前值兜底（`pickBool` / `pickText` 的第三个参数），所以只提交半张表单也不会把别的字段清空。
- `confirm` 组件走另一套：`event.value.confirmed === true` 才执行，否则只重推一次页面数据。
- 列表行的点击走 `action: { id: 'presetEdit', args: { id } }`，对应 `event.value.id`。

### 一次保存的链路

```
用户点「保存 / 保存预设 / 恢复默认」
  ▼ form.submit（或 confirm）
settings action
  ├─ loadConfig()                    ← 以磁盘为准，不用内存里的旧值
  ├─ 校验：名称非空 / 档位合法 / 预设还在 / 内置预设只读 / 预设数上限
  ├─ saveConfig(patch)               ← lib/config.js
  │    ├─ 合并 patch → normalize()（非法字段回落、超长 clip）
  │    ├─ 写 <file>.<pid>.tmp → renameSync(tmp, file)
  │    └─ 刷新缓存，返回 { ok: true, config } 或 { ok: false, config, error }
  ├─ mark('saved' | 'failed' | 'name' | 'length' | 'limit' | 'gone' | 'already' | 'nochange' | 'tooLongPreset' | 'overlength' | 'context' | 'model' | 'builtinDelete' | 'restored')
  ├─ buildData() + publish()          ← 给所有开着的设置页推新数据
  └─ return { patch: data, toast }    ← patch 立即重画当前页
```

两个直接后果：

- **保存即生效**：下一次点胶囊时 `loadConfig()` 读到原文不同就会重新解析，不用重启引擎；
- **失败不改内存**：`saveConfig()` 失败时返回的是 `loadConfig()`（磁盘旧值），页面显示「写入配置失败，改动没有生效」，不会出现“看着存上了其实没写”。

### 分支点

| 分支点 | 位置 | 条件 |
|---|---|---|
| 停用 | `lib/index.js` 胶囊 handler 第一段 | `!config.enabled` → `open: panel:polish-settings` + toast，不起任务 |
| 改写说明块 | `lib/index.js → panelView()` | `config.showNotes` 为真才渲染 notes 文本块 |
| 改写说明内容 | `lib/index.js → snapshot()` → `notesFor()` | 同上；关闭时 `data.notes` 为空串 |
| 预设进提示词 | `lib/polish.js → systemPrompt()` | 预设指令 `trim()` 后非空才追加第 8 条 |
| 附加指令进提示词 | `lib/polish.js → systemPrompt()` | `polishOptions()` 已按 `allowExtra` 置空，这里二次判断 |
| 旧 App | `lib/settings.js → supportsV2()` | `caps.components` 不同时包含 7 个组件 → `viewV1()` |

### 为什么配置放插件目录，不放 profile

- 插件在 `$DSH_HOME/dsh-go/plugins/` 下是**普通目录**，profile 里只是引用；放在插件目录里的文件重装 DSH、换 profile 都还在。
- 和 `.log.jsonl` 同位置，符合“一个目录 = 代码 + 这台机器的状态”，备份和迁移就是拷目录。
- `lib/` 不 import 引擎包（只用 Node 内建），也就不需要借用 profile 的 `node_modules`；配置没有理由放进去。
- 想按设备分设置，各留各的；想换位置（测试、多环境）用 `PROMPT_POLISH_CONFIG` 覆盖路径（只收绝对路径且不含 `..`，被拒时记一条 `config-env-ignored`）。
- 配置是用户可手改的输入，`normalize()` 把它当不可信数据处理：不 eval、不展开、长度截断，坏文件只回落默认，且**不会把坏内容写回**。

## 限额（协议 v1）

| 项 | 值 |
|---|---|
| 胶囊文案 | ≤10 字 |
| 同步返回 | ≤3 秒（本插件的同步段只做本地判断） |
| 面板数据 | 32 KiB / 120 组件 |
| 写回文本 | ≤2000 字（自限 1900） |
| 延后结果 | ≤60 秒；本插件用面板数据流而非 deferred |

## 诊断

`.log.jsonl` 每次点按追加一行：`open-confirm / ready(source, draftLen, outLen) / copy / append / cancel`。只有长度和状态，没有文本。

## 失效与重装

插件装在 `$DSH_HOME/dsh-go/plugins/`（不在 `node_modules` 里），重装 DSH 插件不影响它；`lib/` 改动需重启引擎，`package.json` 改动自动重读。
