# local-prompt-polish

dsh-go 手机 App 输入框上方的「✦ 优化提示词」胶囊：点一下，用**当前会话自己的模型**把草稿改写成一条更清晰的提示词，先在确认页里给你看，再由你决定怎么落到输入框。

不发送消息、不改对话内容、不额外联网（只走你已经配置的模型）。

## 交互

```
点胶囊 → 起优化任务（3 秒内返回）→ 打开确认页
   · 正在优化…
   · 就绪：原文 + 优化稿全文 + 三个按钮
        [复制优化稿]（主）  [追加到输入框]  [取消]
```

| 按钮 | 效果 | 输入框 |
|---|---|---|
| **复制优化稿** | 只写剪贴板 | 不动；长按输入框 → 全选 → 粘贴 = 整体替换 |
| 追加到输入框 | `insert` | App 的语义是合并，优化稿接在原文后面 |
| 取消 | 仅提示 | 一个字都不动 |

## 为什么没有「一键替换」

dsh-go 原生插件的 effect 白名单只有 `insert` / `copy` / `toast` / `command` / `open` / `link` / `refresh` / `patch`，**没有清空或替换草稿的能力**；App 端把 `insert` 实现成合并进草稿（`insertIntoComposer`）。所以插件写进输入框只能是追加，删不掉用户已经输入的文字。

整体替换目前只能靠「复制 + 全选粘贴」这一步用户手势。若要一键，需要 App 端新增一个 `replace` effect —— 已作为建议提交给 dsh-Go（见 issue 链接）。

## 改写质量：不是续写

草稿被定义为「被改写的对象」：不执行、不回答、不续写；不许以草稿原句开头、不许「原文/改写后」标签；优化方向只限“目标 / 背景 / 要求与约束 / 交付形式 / 去歧义”；≤ 草稿 3 倍且 ≤ 600 字。

输出后处理会切掉开头复述草稿的整段（按标点切句、去标点做前缀比对，命中 ≥8 字才算复述）；整段复述 → 判失败，用更严格提示重试一次；仍失败 → 本地整理兜底（去“帮我/麻烦/能不能/please”这类填充、合并重复标点、三句以上分条）。

## 上下文与路由

- 上下文：同会话最近 8 条 user/assistant 文本，每条截 320 字，总量 ≤ 1600 字。
- 路由：当前会话模型 → 会话日志最后一次 `request/header` → 部署默认模型。

## 安装

```sh
tar xzf local-prompt-polish-1.3.0.tgz -C "$DSH_HOME/dsh-go/plugins/"
dsh plugin --profile web add "$DSH_HOME/dsh-go/plugins/local-prompt-polish"
```

`lib/` 改动需在 App「设置 → 引擎 → 重启引擎」后生效；清单改动自动重读。
卸载：`dsh plugin --profile web remove local-prompt-polish`。

## 自测

```sh
node "$DSH_HOME/skills/dsh-go-plugin/kit/bin/check.mjs" . --load   # 胶囊 1 · 面板 1，四个视图都能画
node test/selftest.mjs                                             # 47 assertions passed
```

## 限制

- 面板不能编辑文本；
- 优化稿上限 1900 字（协议上限 2000）；
- 无模型时只做“收紧”，不做“扩写”；
- 诊断文件 `.log.jsonl` 只记长度与状态，不含文本。

完整说明见 [总结.md](总结.md)。

## License

MIT
