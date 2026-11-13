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
  ├─ 读 draft；< 4 字 → toast 返回
  ├─ 起优化任务（内存 job，key = sessionId）
  │    ├─ resolveRoute: 会话模型 → request/header → 部署默认
  │    ├─ collectContext: 最近 8 条消息，每条 320 字，总 ≤1600 字
  │    ├─ requestPolish: prepareCall(关思考, ≤900 token, 25s) → 流式取文本
  │    │     └─ stripEcho: 切掉开头复述；纯复述 → 严格重试一次
  │    └─ 失败/无路由 → buildLocalPrompt（本地收紧）
  └─ 返回 { open: panel:polish-panel }
        │
        ▼
确认页（panels 数据流）
  data(scope, emit) 先推 loading，任务完成后再推 ready
  按钮：copy / append / cancel → 各自返回 effect
```

## 为什么是“面板 + 复制”，不是“直接替换”

effect 白名单没有 replace/clear；`insert` 在 App 侧是合并。因此：

- **copy**：只写剪贴板，零副作用；用户全选粘贴后输入框里只剩优化稿；
- **insert**：语义诚实，但会把原文留在前面，所以做成显式按钮而不是默认；
- **cancel**：只 toast。

上游已收到 `replace` effect 建议（dsh-Go#1148）。一旦落地，改动点是：`resolveRoute` 旁边加能力探测（`caps.features` 含 `draft.replace`），`deliver()` 从 copy 切到 replace。

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
