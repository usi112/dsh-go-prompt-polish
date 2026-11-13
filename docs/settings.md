# 设置：字段、页面与生效链路

1.4.0 新增的「提示词优化设置」页（面板 `polish-settings`）只做一件事：把用户的选择写进插件目录下的 `.config.json`，胶囊每次点按再把它读出来。1.5.0 在这套机制上加了 **9 套内置预设**（可改、可恢复）与 **固定模型**（`modelProvider` / `modelModel`），没有新增配置文件，也没有新增存储位置。

- 没有配置文件 = 全部默认值 = **1.3.0 的行为**；
- 配置文件坏掉或字段非法 → 只丢那一个字段，回落默认值，不报错；
- 页面本身不缓存状态，每次画都重新读文件。

## 配置字段

文件位置：`lib/config.js → configFile()` = 插件根目录的 `.config.json`，可用环境变量 `PROMPT_POLISH_CONFIG` 指到别处（自测就是这么做的）。只接受**绝对路径且不含 `..`**；设了不可用的值会回到插件目录，并在 `.log.jsonl` 记一条 `config-env-ignored`（不会静默生效在别的目录）。日志位置同样可用 `PROMPT_POLISH_LOG` 覆盖，规则一致。

| 配置字段 | 类型 | 默认值 | 作用 | 读取/生效位置 |
|---|---|---|---|---|
| `v` | 整数 | `1`（`CONFIG_VERSION`） | 配置版本号，留给以后的迁移；当前不参与任何分支 | `lib/config.js → normalize()` |
| `enabled` | 布尔 | `true` | 总开关。`false` 时点胶囊只提示并打开设置页，不起改写任务 | `lib/index.js → ctx.dshGo.on('polish')` 第一行判断 |
| `length` | 枚举 `detailed` / `medium` / `simple` | `medium`（`DEFAULT_LENGTH`） | 输出长度档；非法值回落 `medium` | `polishOptions()` → `lib/polish.js → tierOf()`（`maxTokens` / `maxChars`）+ `systemPrompt()` 第 7 条 |
| `presetId` | 字符串 | `default`（`DEFAULT_PRESET_ID`） | 当前选中的预设；指向不存在的 id 时回落内置「默认」 | `polishOptions()` → `activePreset()` → `systemPrompt()` 第 8 条 |
| `presets[]` | 数组，元素 `{ id, instruction }`（内置）或 `{ id, name, instruction }`（自定义） | `[]` | 预设改动：**id 是 9 套内置之一 → 只认 instruction，等于改内置预设的内容**；其他 id → 自定义预设（最多 12 个，`name` ≤ 24 字且不能为空）。`instruction` ≤ 500 字；重复 id 只留第一条 | `presetsOf(config, zh)` → `polishOptions()` → `systemPrompt()` 第 8 条 |
| `modelProvider` | 字符串 | `''`（跟随会话模型） | 固定使用的 provider id，例如 `deepseek` | `polishOptions().model` → `requestPolish()` 优先用它，否则 `resolveRoute()` 走会话模型 |
| `modelModel` | 字符串 | `''` | 固定使用的 model id，例如 `deepseek-chat`；与 `modelProvider` 成对生效，只填一个按「跟随会话」处理 | 同上 |
| `keepTerms` | 布尔 | `true` | 保留草稿里的专有名词 | `polishOptions()` → `systemPrompt()` 第 4 条（`keepRule()`） |
| `keepCode` | 布尔 | `true` | 保留草稿里的代码、路径与标识符 | 同上 |
| `showNotes` | 布尔 | `false` | 确认页是否显示「改写说明」（来源 / 档位 / 预设 / 保留开关 / 字数变化） | `lib/index.js → panelView()` 决定是否渲染 notes 块；`snapshot()` 决定 `data.notes` 内容 |
| `allowExtra` | 布尔 | `true` | 是否允许使用「附加指令」；`false` 时 `extra` 即使有内容也不进提示词 | `polishOptions()`：`allowExtra === false` 时把 `extra` 置空 |
| `extra` | 字符串 | `''` | 附加指令正文，≤ 500 字（`EXTRA_MAX`）；页面提交超长时整单拒绝并提示，不静默截断（直接改文件时由 `normalize()` 截断兜底） | `polishOptions()` → `systemPrompt()` 第 9 条 |

`presets[]` 里只会出现**改动**：9 套内置预设本身由 `BUILTIN_PRESETS` 提供，永远排在列表前面；没改过就不出现在文件里。内置预设不能被改名或删除，但**内容可以改**——改完写成一条 `{ id, instruction }` 覆盖条目；「恢复此预设默认」会删掉这条覆盖。

字段级校验小结（全部在 `normalize()` 里，永不抛错）：

| 情况 | 处理 |
|---|---|
| 根不是对象（`null` / 数组 / 标量） | 整份回落默认，`problems` 记 `config-root` |
| 文件不存在 | 直接用 `defaults()`，不建文件 |
| 文件不是合法 JSON | 直接用 `defaults()`（读到什么坏内容都不写回） |
| `length` 不在三档里 | 回落 `medium`，`problems` 记 `config-length` |
| `presetId` 指向不存在的预设 | 回落 `default`，`problems` 记 `config-presetId` |
| 预设 `name` 为空 / `id` 非法或重复 / 元素不是对象 | 丢掉这一条预设，其余保留 |
| 字符串字段超长 | `clip()` 截到上限并以 `…` 收尾 |

`problems` 只用于诊断，不参与控制流，也不写进日志。

## 内置预设（9 套）

来源：`lib/config.js → BUILTIN_PRESETS`。每套只有一句「附加要求」，拼成系统提示的第 8 条；`length` 管的第 7 条篇幅要求与它互不影响，任意组合都成立。

| id | 名称（zh / en） | 适用场景 | 指令要点（差异） |
|---|---|---|---|
| `default` | 默认 / Default | 通用改写 | 无附加要求，等于 1.3.0 的行为 |
| `coding` | 写代码 / Coding | 新功能、改实现、重构 | 语言与版本、运行环境、输入输出、边界与错误处理、验收（测试）；保留函数名/接口/路径 |
| `review` | 代码审查 / Code review | PR、补丁、片段审查 | 按严重度列问题（正确性→安全→性能→可维护性），带定位与最小修复；不重写整段 |
| `bug` | 排障 / Debugging | 报错、行为异常、线上问题 | 症状/复现/期望与实际/环境/日志；先给 2–3 个假设与验证法，再谈修复 |
| `docs` | 写文档 / Docs | README、使用说明、上手教程 | 读者与任务、可复制步骤、常见坑；「是什么→怎么装→怎么用→出问题怎么办」 |
| `writing` | 写作润色 / Writing | 邮件、文案、文章、汇报 | 读者/目的/场合/语气/篇幅；保留术语与事实，删空话；直接给成稿 |
| `data` | 数据与 SQL / Data & SQL | 查询、指标口径、报表 | 表与字段、统计口径、时间范围与时区；可执行 SQL + 索引/全表扫描提示 + 结果自检 |
| `product` | 需求与产品 / Product | 需求稿、用户故事、验收标准 | 用户故事、可测验收、边界、非目标与优先级；不替用户做业务取舍 |
| `learn` | 学习讲解 / Learning | 概念、原理、技术入门 | 先心智模型再细节、一个最小例子、一个常见误解、2–3 个自测问题 |

**编辑与持久化**：在设置页「预设」里点一行 → 改「预设指令」→ 保存。内置预设的改动写进 `.config.json` 的 `presets[]`（`{ id, instruction }`，名字与 id 不变），自定义预设写 `{ id, name, instruction }`；两者都在插件目录、原子写、`gitignore`，重启引擎或重装插件都还在。**恢复默认**有两个层级：单个预设用「恢复此预设默认」（内置=删掉覆盖条目，自定义=清空指令），全局用「其他 → 恢复默认设置」（`resetConfig()`，自定义预设一起清掉）。

## 长度三档

`LENGTH_TIERS` 定义在 `lib/polish.js`，一档同时决定三件事：系统提示第 7 条的措辞、模型的 `maxTokens`、插件自己的截断上限。

| 档 | 提示词第 7 条要求 | `maxTokens` | 输出上限 | 与旧版关系 |
|---|---|---|---|---|
| `detailed` 详细 | 一般 2–3 倍于草稿，不超过 800 字；优先补背景、边界条件与验收标准，不复述原文 | 1400 | 1900 字（`MAX_INSERT`，协议上限 2000） | 1.4.0 新增 |
| `medium` 中等 | 一般不超过草稿的 3 倍，绝不超过 600 字 | 900 | 1900 字（`MAX_INSERT`） | **与 1.3.0 逐字一致**（提示词、`maxTokens`、截断上限三项都对得上） |
| `simple` 简易 | 不超过草稿的 1 倍、最多 200 字；只留最少必要的骨架要点（不超过 5 条），不补背景、不举例、不加客套 | 400 | 500 字 | 1.4.0 新增 |

补充：

- 本地兜底 `buildLocalPrompt()` 也用同一个上限：`simple` 档最多 5 条、最多 500 字；`detailed` / `medium` 做同样的收紧（本地不能凭空扩写）。
- 截断写死在 `Math.min(MAX_INSERT, tierOf(options).maxChars)`，任何档都不会超过 1900 字。
- 提示词里的「≤200 字 / ≤800 字」是给模型的**软要求**；硬截断分别是 500 / 1900 字。两者不一致是有意的：模型守规矩时就是 200/800，模型超了也不会把句子拦腰截断。
- `maxChars` 只影响插件自己的截断，不改协议本身的 2000 字上限。

## 页面结构

面板 id `polish-settings`，标题「提示词优化设置」（`en`：Polish settings），清单里挂在 `session.tab` 与 `features` 两个位置；同一个面板还有输入框上方 **+** 菜单里的入口 `composer.tools → open-settings`（「优化设置」）。

```
polish-settings（stack，标题「提示词优化设置」）
├─ text      data.summary            ← 页头一行摘要「当前：已启用 · 中等 · 严谨」
├─ callout   data.status.text / .tone ← 保存结果显示在这里（见下）
└─ tabs
   ├─ tab 预设
   │  ├─ text        presetsHint（「默认」内置，不能改名或删除）
   │  ├─ list        data.presets → 点一行 = action presetEdit { id }
   │  ├─ form        submit: presetSave，按钮「保存预设」
   │  │  ├─ text       data.form.presetLabel（正在编辑：<名字>）
   │  │  ├─ textField  预设名称       bind data.form.presetName        maxLength 24，required，内置预设 readOnly
   │  │  ├─ textField  预设指令       bind data.form.presetInstruction  multiline，maxLines 6，maxLength 500，内置预设 readOnly
   │  │  └─ toggle     设为默认预设   bind data.form.makeDefault
   │  ├─ actions     「新建预设」 → action presetNew
   │  ├─ text        restoreHint（恢复默认只影响当前预设）
   │  ├─ confirm     id presetRestore，确认按钮「恢复此预设默认」
   │  ├─ text        deleteHint
   │  └─ confirm     id presetDelete，确认按钮「删除预设」，取消「取消」
   ├─ tab 长度
   │  ├─ text        lengthHint（选「中等」等于旧版行为）
   │  ├─ form        submit: saveLength，按钮「保存长度档」
   │  │  └─ segmented  输出长度 bind data.form.length（详细 / 中等 / 简易）
   │  └─ list        data.tiers → 三档说明，当前档打 ✓
   ├─ tab 模型
   │  ├─ text        modelHint（默认跟随会话模型）
   │  ├─ text        data.modelStatus →「当前：跟随当前会话的模型 / provider · model」
   │  │             半对配置时追加「（配置不完整，按跟随会话处理）」
   │  ├─ text · list 组「会话默认」→ data.model.session（1 行 action modelFollow；固定模型不在宿主列表时追加 1 行说明）
   │  ├─ text · list 组「官方模型」→ data.model.official（action modelPick）
   │  ├─ text · list 组「其他来源」→ data.model.others（action modelPick）
   │  │             每组最多 12 行；超出显示「还有 N 个，可在下方手填」；空组显示「这一组暂时没有模型」
   │  ├─ form        submit: saveModel，按钮「保存模型」
   │  │  ├─ textField  provider bind data.form.modelProvider
   │  │  └─ textField  model    bind data.form.modelModel
   │  ├─ text        modelManual（provider / model 要成对填）
   │  └─ actions     「改回跟随会话」→ modelFollow；「重新读取模型」→ modelRefresh
   └─ tab 其他
      ├─ text        otherHint
      ├─ form        submit: saveOther，按钮「保存其他设置」
      │  ├─ toggle     启用「优化提示词」胶囊   bind data.form.enabled
      │  ├─ toggle     保留草稿里的专有名词     bind data.form.keepTerms
      │  ├─ toggle     保留代码、路径与标识符   bind data.form.keepCode
      │  ├─ toggle     确认页显示改写说明       bind data.form.showNotes
      │  ├─ toggle     允许使用附加指令         bind data.form.allowExtra
      │  └─ textField  附加指令 bind data.form.extra，multiline，maxLines 4，maxLength 500
      ├─ divider
      ├─ text        resetHint（恢复默认会清空自定义预设）
      └─ confirm     id resetAll，确认按钮「恢复默认设置」，取消「取消」
```

action 一览（`lib/settings.js → SETTINGS_ACTIONS`）：

| action | 触发位置 | 写入什么 |
|---|---|---|
| `presetEdit` | 预设 tab 的预设行 | 不写文件，只切换「正在编辑」 |
| `presetNew` | 预设 tab 的「新建预设」 | 追加一条空预设并选中它；已满 12 条则提示 |
| `presetSave` | 预设 tab 的表单提交 | 自定义：名称 / 指令 / 是否设为默认；内置：只写 `{ id, instruction }` 覆盖条目（改名无效），内容与出厂一致且无覆盖时不落盘 |
| `presetRestore` | 预设 tab 的 confirm | 恢复当前预设的出厂内容：内置=删掉覆盖条目，自定义=清空指令 |
| `presetDelete` | 预设 tab 的 confirm | 删掉当前自定义预设（内置拒绝并提示）；删的是默认预设则回落内置「默认」 |
| `modelPick` | 模型 tab 的模型行 | `modelProvider` + `modelModel` |
| `saveModel` | 模型 tab 的表单提交 | `modelProvider` + `modelModel`；只填一个 → 提示「要一起填」，不写文件 |
| `modelFollow` | 模型 tab 的「改回跟随会话」 | 清空 `modelProvider` / `modelModel` |
| `saveLength` | 长度 tab 的表单提交 | `length` |
| `saveOther` | 其他 tab 的表单提交 | 5 个开关 + `extra` |
| `resetAll` | 其他 tab 的 confirm | 整份覆盖为默认值（等同删掉配置） |
| `lengthCycle` | v1 降级页「切换长度档」 | `length` 循环切到下一档 |
| `toggleEnabled` | v1 降级页「开/关胶囊」 | `enabled` 取反 |

**保存结果在页头 callout 里**：成功是绿色「已保存 · HH:MM」（带本地时间），写盘失败是「写入配置失败，改动没有生效」，其余是同一位置的警告文案（`预设名称不能为空` / `档位取值无效` / `内置预设不能删除，只能恢复默认内容` / `这已经是默认预设，没有要改的` / `自定义预设最多 12 个` / `这个预设已经不在了，请刷新` / `附加指令最多 500 字` / `provider 与 model 要一起填，或者都留空` / `内容没有变化，无需保存` / `预设名称或指令超出长度上限，请缩短后再保存` / `已重新读取模型`）；一次都没保存过时显示 `还没有保存过，当前用的是默认值`。每次保存后页面数据整体重推一遍（`publish()`），所以开关、档位、列表立刻跟着变，不用退出重进。v1 摘要页没有 callout 组件，同样的状态文案以一行普通文本显示在摘要下面。

## 配置如何生效

```
点胶囊
  ▼
lib/index.js → loadConfig()            ← 读文件原文；和上次读到的原文相同就复用解析结果
  ├─ enabled === false
  │    → log({event:'disabled'})
  │    → { open: 'panel:polish-settings', toast: '「优化提示词」已在设置里停用 · 打开设置可重新启用' }
  └─ enabled === true
       → 草稿 < 4 字 / 空 → toast，不动输入框
       → startJob()
            ▼
         polishOptions(loadConfig(), zh)      ← 档位、保留开关、命中预设的指令、附加指令、固定模型
            ├─ 固定模型（modelProvider + modelModel）优先；没配就照旧用会话模型
            ├─ 有可用模型 → requestPolish({…, options})
            │     · tierOf(options) → prepareCall(maxTokens) + 截断上限
            │     · systemPrompt(zh, strict, options) → 4 条保留规则 / 7 条篇幅规则 /
            │       第 8 条预设 / 第 9 条附加指令
            └─ 无模型或失败 → buildLocalPrompt(text, options)
       → { open: 'panel:polish-panel' }
            ▼
         确认页 panelView() / snapshot()
            · showNotes === false → 不渲染 notes 块，data.notes 为空
            · showNotes === true  → 多一块「改写说明」：来源 · 档位 · 预设 · 专有名词 · 代码与路径 · 字数
```

要点：

- `loadConfig()` 按**文件原文**做缓存（不是 mtime）：每次读一遍文件，和上一次的原文比对，相同才复用解析结果。手改 `.config.json`、别的进程写入、设置页保存，都会让下一次读重新解析，**不需要重启引擎**。之所以不看 mtime：这台机器的文件系统 mtime 只有约 4ms 粒度，连续两次同尺寸写入会拿到同一个 mtime，按时间戳缓存会读回旧配置；文件不到 2 KiB，每次读全文的代价可以忽略；
- 设置页保存走 `saveConfig()` → 写临时文件再 `rename` → 顺手刷新缓存 → `publish()` 给所有开着的设置页推新数据；
- 档位和预设只影响**这一次改写用到的提示词与截断长度**，不改变确认页的三个按钮；
- `showNotes` 是唯一影响确认页结构的开关（多一块文本）；其余开关只进提示词。

## 兼容与降级

| 情况 | 结果 |
|---|---|
| 没有 `.config.json` | 全部默认值，行为和 1.3.0 完全一致（`medium` + 保留全开 + 无预设 + 无附加指令） |
| 字段非法 / 文件坏 | 只丢该字段（或整份回落默认），不抛错、不写回坏内容 |
| 旧 App（`caps.components` 不同时含 `form`/`textField`/`toggle`/`segmented`/`tabs`/`list`/`confirm`） | 走 v1 摘要页：`keyValue` 显示 7 项当前值 + 两个按钮「切换长度档」「开/关胶囊」，配置照样能改；页面顶部提示「升级 App 后可用完整设置」 |
| 写入失败（目录不可写等） | `saveConfig()` 返回 `{ ok: false, error }`，页面 callout 显示「写入配置失败，改动没有生效」，内存里的配置仍是磁盘上的旧值 |
| 并发写 | 每次写都先写 `<file>.<pid>.tmp` 再 `renameSync`，读到的永远是完整文件，不会读到半截 JSON |

`.config.json` 和 `.log.jsonl` 一样落在插件目录（`$DSH_HOME/dsh-go/plugins/local-prompt-polish/`）。备份就是拷这个文件，恢复默认就是在页面里点「恢复默认设置」（等价于把文件写回默认值）。

## 相关文件

| 文件 | 职责 |
|---|---|
| `lib/config.js` | 唯一读写配置的地方：默认值、`normalize()`、`loadConfig()`（读原文比对缓存）、`saveConfig()` / `resetConfig()`（原子写）、预设增删改查、`polishOptions()` |
| `lib/settings.js` | 只做界面：面板 `polish-settings` 的视图（v2 表单 / v1 降级）、数据、9 个 action；状态一律从 `config.js` 读 |
| `lib/polish.js` | `LENGTH_TIERS`、`systemPrompt(zh, strict, options)`、`requestPolish()`、`buildLocalPrompt()` |
| `lib/index.js` | 胶囊处理（先读配置、停用分支）、确认页视图与数据、`notesFor()` 改写说明 |

原理与 effect 边界见 [architecture.md](architecture.md)。

## 与需求的对应

| # | 需求 | 落地位置 | 是否满足 |
|---|---|---|---|
| 1 | 一个能改设置的面板，三块内容分开：预设 / 长度 / 其他；有 + 菜单入口，停用时点胶囊自动带过去 | `lib/settings.js`（面板 `polish-settings`、视图 v2 的 `tabs`）；`package.json` 的 `panels` + `composer.tools → open-settings`；`lib/index.js` 的停用分支返回 `open: panel:polish-settings` | 满足 |
| 2 | 设置要能存住、改完立刻生效，配置文件坏掉不能把插件弄崩 | `lib/config.js`：`.config.json`（`PROMPT_POLISH_CONFIG` 可覆盖）、临时文件 + `renameSync` 原子写、`loadConfig()` 按文件原文比对的缓存、`normalize()` 逐字段回落 | 满足 |
| 3 | 预设能新建 / 改名 / 写指令 / 设为默认 / 删除；9 套内置预设可改内容、不可改名或删除 | `lib/settings.js` 的 `presetNew` / `presetSave` / `presetEdit` / `presetDelete`；`lib/config.js` 的 `BUILTIN_PRESETS`、`normalizePresets()`、`newPreset()`、`MAX_PRESETS = 12` | 满足 |
| 4 | 长度三档，默认「中等」必须与 1.3.0 完全一致 | `lib/polish.js` 的 `LENGTH_TIERS`（1400/1900 · 900/1900 · 400/500）与 `systemPrompt()` 的第 7 条；`lib/config.js` 的 `DEFAULT_LENGTH = 'medium'` | 满足（`systemPrompt(true)` 与 1.3.0 原文逐字相等，已用脚本比对） |
| 5 | 其他开关（总开关、两个保留、改写说明、附加指令）落到提示词；旧 App 也改得动设置 | `lib/config.js → polishOptions()`；`lib/polish.js` 的 `keepRule()`（第 4 条）、第 8 条预设、第 9 条附加指令；`lib/index.js` 的 `notesFor()` 与 `panelView()`；`lib/settings.js` 的 `viewV1()` + `lengthCycle` / `toggleEnabled` | 满足（旧 App 只有摘要页，没有预设表单，见下） |

## 1.5.0 的三项对应

| 需求 | 落地 |
|---|---|
| 内置预设覆盖日常场景、可指定套数、与 `length` 兼容 | `BUILTIN_PRESETS` 9 套；预设=系统提示第 8 条，`length`=第 7 条，两两组合都成立 |
| 预设可修改、持久化、可恢复默认 | 改内置 → `presets[]` 覆盖条目；改自定义 → `{id,name,instruction}`；单套恢复 `presetRestore`，全局恢复 `resetAll` |
| 设置页可改 API / 模型 | 不做 API 地址与 Key；改为「固定本地模型」：`modelProvider` + `modelModel`，点选宿主模型或手填，空值跟随会话 |

## 模型来源分组（1.5.2）

分组只用宿主已经给的信息，不在插件里硬编码模型清单：

| 组 | 判定 | 例子 |
|---|---|---|
| 会话默认 | 永远一条 | 「会话默认模型 · 跟随当前会话，不固定」 |
| 官方模型 | provider id 或 provider 名称命中厂商关键字（deepseek / openai / anthropic / claude / gemini / google / xai / grok / mistral / moonshot / kimi / qwen / tongyi / zhipu / glm / minimax / doubao / bytedance / baichuan / stepfun） | `deepseek-account · deepseek-chat` |
| 其他来源 | provider id 含 `custom-` / `relay-` / `proxy-` / `mirror-` / `thirdparty` / `cnkey` / `api2d` / `oneapi` / `newapi` / `modlens-`，名称含「中转 / 自定义 / 第三方 / 代理」，或属于聚合平台（`openrouter` / `siliconflow` / `together` / `fireworks` / `groq` / `deepinfra` / `poe` / `one-api` / `llm-gateway`）；**以及所有识别不出来的 provider** | `custom-cnkey · glm-5.3-flash`、`modlens-deepseek-account · deepseek-v4-pro`、`openrouter · x` |

判断顺序：先判「其他来源」关键字（避免 `custom-deepseek` 被算成官方），再判官方关键字，剩下的一律「其他来源」。组内顺序 = `llm.listProviders()` 的顺序 + `llm.listModels()` 的顺序，不排序、不截断（每组最多 22 行）。

## 1.5.3 的稳定性改动

| 改动 | 说明 |
|---|---|
| 模型缓存带 TTL | 60 秒；空结果/读取失败不固化，面板重开会重试；模型页有「重新读取模型」 |
| 列表永不为空 | 1.5.3 起视图里每个 `list` 绑定都保证非空（空数组会被 App 画成「暂无数据」）；固定模型的说明行并进「会话默认」列表，回归测试覆盖空/非空/固定缺失三种状态 |
| 行数上限与裁剪 | 每组 12 行、组尾「还有 N 个」；模型名 60 字、`provider · model` 120 字；删除冗余 `data.model.options`，41 行场景的 patch 仍在 16 KiB 内 |
| 按会话隔离 | 编辑目标与保存状态按 `sessionId` 分开；表单提交带 `data.form.presetId` |
| 硬超时 | 适配器不理会 `AbortSignal` 时，45 秒后放弃并显示本地整理稿 + 「模型超时」提示 |
| 保存元数据 | `v` 永远写回当前版本；手写的未知字段在保存时保留 |
| 英文 toast | 全部 ≤ 40 字，避免被桥截断 |

## 已知限制

- 模型页的状态行与 v1 摘要页都用**纯文本**绑定：App 1.0.15 会把 `keyValue` 绑定「数组的数组」渲染成「暂无数据」，1.5.1 起不再使用这种写法。
- 宿主没有注册任何 provider 时，模型列表只有「会话默认模型」+ 一行手填说明；固定模型仍可通过手填 provider / model 保存。

1. **`lib/` 改动要重启引擎**：设置页本身、`.config.json`、`package.json` 的改动都即时生效（清单自动重读、配置按原文比对重读），但 `lib/*.js` 是引擎启动时加载的，改完要在 App「设置 → 引擎 → 重启引擎」。
2. **旧 App 只有 v1 摘要页**：`caps.components` 里缺 `form` / `textField` / `toggle` / `segmented` / `tabs` / `list` / `confirm` 任意一项，就只能看到当前值和「切换长度档」「开/关胶囊」两个按钮；预设管理、附加指令、改写说明都要新版 App。
3. **配置暂无版本迁移**：`v` 字段只记录版本号，当前代码不读它、不做升级转换。以后若改字段结构，只能删掉 `.config.json` 重新配（或手改），没有自动迁移。
4. **停用不会藏起胶囊**：`enabled: false` 时胶囊还在，点了只提示并打开设置页（`open: panel:polish-settings` + toast），不会静默什么都不做。
5. **设置只改提示词**：档位和预设影响系统提示与截断长度，不改 effect 白名单——「一键替换」仍然要靠复制 + 全选粘贴。
6. **确认页不热更新**：改写说明块和本轮用的档位在点胶囊那一刻定下；页面开着时再改设置，要下一次点胶囊才体现。
