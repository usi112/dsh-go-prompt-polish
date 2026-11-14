// 设置页：面板 polish-settings。
//
// 页面用视图 v2 的表单（textField / toggle / segmented / tabs），保存走
// `form.submit` → 插件 action，event.value 形状是 `{ values: { 'data.form.x': v } }`；
// 旧 App（caps.components 不含这些组件）退回 v1 摘要页 + 三个按钮，配置照样能改。
//
// 读写的唯一位置是 lib/config.js（默认 .config.json），页面本身不持有状态：
// 每次重绘都从文件读一遍，所以手改文件、别的设备写入都会在下一次打开时生效。

import {
  BUILTIN_IDS,
  BUILTIN_PRESETS,
  DEFAULT_PRESET_ID,
  EXTRA_MAX,
  INSTRUCTION_MAX,
  LENGTHS,
  MAX_PRESETS,
  NAME_MAX,
  activePreset,
  clip,
  loadConfig,
  newPreset,
  presetName,
  presetScene,
  presetsOf,
  resetConfig,
  saveConfig,
} from './config.js'
import { log } from './log.js'

export const SETTINGS_PANEL = 'polish-settings'

const V2_COMPONENTS = ['form', 'textField', 'toggle', 'segmented', 'tabs', 'list', 'confirm']

const T = {
  zh: {
    title: '提示词优化设置',
    tabPresets: '预设',
    tabLength: '长度',
    tabModel: '模型',
    tabOther: '其他',
    presetsHint: '点一行选中要改的预设。9 套内置预设可以改内容、可以设为默认，但不能改名或删除；改过的会标「已改」。',
    presetLabel: '正在编辑',
    presetName: '预设名称',
    presetInstruction: '预设指令（追加到系统提示）',
    presetInstructionPlaceholder: '例如：优先列验收标准，不要客套',
    makeDefault: '设为默认预设',
    savePreset: '保存预设',
    newPreset: '新建预设',
    deletePreset: '删除预设',
    restorePreset: '恢复此预设默认',
    builtinTag: '内置',
    customTag: '自定义',
    defaultTag: '默认',
    overriddenTag: '已改',
    noInstruction: '无附加指令',
    restoreHint: '「恢复此预设默认」只把当前预设的内容恢复成出厂文案；自定义预设会清空指令。',
    errBuiltinDelete: '内置预设不能删除，只能恢复默认内容。',
    restored: '已恢复默认内容',
    deleteHint: '删除只对自定义预设生效；如果删的是默认预设，会回到内置「默认」。',
    cancel: '取消',
    lengthHint: '三档只影响本轮改写用的提示词和长度上限；选「中等」等于旧版行为。',
    lengthLabel: '输出长度',
    lengthNames: { detailed: '详细', medium: '中等', simple: '简易' },
    tierDetailed: '详细',
    tierMedium: '中等（默认）',
    tierSimple: '简易',
    tierDetailedNote: '2–3 倍草稿、≤800 字；补背景、边界条件与验收标准',
    tierMediumNote: '≤3 倍草稿、≤600 字；只补必要信息，和 1.3.0 完全一致',
    tierSimpleNote: '≤ 草稿长度、≤200 字；只留最多 5 条骨架要点',
    modelHint: '默认跟随当前会话的模型；也可以在这里固定一个模型，只影响「优化提示词」这一次改写。',
    modelCurrent: '当前',
    followSession: '跟随当前会话的模型',
    saveModel: '保存模型',
    modelFollow: '改回跟随会话',
    modelProvider: '提供方（provider）',
    modelModel: '模型（model）',
    modelProviderPlaceholder: '例如 deepseek',
    modelModelPlaceholder: '例如 deepseek-chat',
    sessionOption: '会话默认模型',
    sessionOptionNote: '跟随当前会话，不固定',
    groupSession: '会话默认',
    groupOfficial: '官方模型',
    groupOther: '其他来源',
    groupEmpty: '这一组暂时没有模型',
    groupMore: '还有 {n} 个，可在下方手填 provider / model',
    groupPinned: '已固定（不在当前列表）',
    refreshModels: '重新读取模型',
    refreshed: '已重新读取模型',
    nochange: '内容没有变化，无需保存',
    tooLongPreset: '预设名称或指令超出长度上限，请缩短后再保存',
    modelManual: '手填的 provider / model 必须都存在；只填一个不保存。',
    modelHalfPair: '配置不完整，按跟随会话处理',
    errModelPair: 'provider 与 model 要一起填，或者都留空',
    modelPicked: '已固定这个模型',
    otherHint: '所有开关立刻写进配置文件；关掉的全部走默认值。',
    enabled: '启用「优化提示词」胶囊',
    keepTerms: '保留草稿里的专有名词',
    keepCode: '保留代码、路径与标识符',
    showNotes: '确认页显示改写说明',
    allowExtra: '允许使用附加指令',
    extra: '附加指令',
    extraPlaceholder: '会拼在系统提示末尾，最多 500 字',
    contextStrategy: '长会话怎么读上下文',
    contextStrategySmart: '智能：压缩摘要 + 最近消息',
    contextStrategyRecent: '只看最近消息（旧行为）',
    contextMessages: '读取最近几条消息做上下文',
    contextChars: '上下文总字数上限',
    contextHint: '默认 12 条 / 2000 字；条数 1–32，字数 200–8000。智能模式还会带上任务清单与命中片段。',
    errContext: '上下文条数 1–32、字数 200–8000',
    saveLength: '保存长度档',
    saveOther: '保存其他设置',
    resetLabel: '恢复默认设置',
    resetHint: '恢复默认会清空配置文件里的全部改动，自定义预设一起删掉。',
    cycleLength: '切换长度档',
    toggleEnabled: '开/关胶囊',
    fallbackHint: '这个 App 版本不支持设置页的表单控件，这里只能切换档位和总开关；升级 App 后可用完整设置。',
    on: '已启用',
    off: '已停用',
    summaryPrefix: '当前',
    saved: '已保存',
    saveFail: '写入配置失败，改动没有生效',
    errName: '预设名称不能为空',
    errLength: '档位取值无效',
    errLimit: `自定义预设最多 ${MAX_PRESETS} 个`,
    errGone: '这个预设已经不在了，请刷新',
    already: '这已经是默认预设，没有要改的',
    nochange: '内容没有变化，无需保存',
    notSavedYet: '还没有保存过，当前用的是默认值',
    overlength: `附加指令最多 ${EXTRA_MAX} 字`,
  },
  en: {
    title: 'Polish settings',
    tabPresets: 'Presets',
    tabLength: 'Length',
    tabModel: 'Model',
    tabOther: 'More',
    presetsHint: 'Tap a row to edit it. The nine built-in presets can be edited and made the default, but not renamed or removed; edited ones are tagged.',
    presetLabel: 'Editing',
    presetName: 'Preset name',
    presetInstruction: 'Preset instruction (appended to the system prompt)',
    presetInstructionPlaceholder: 'e.g. list acceptance criteria first, no pleasantries',
    makeDefault: 'Use as the default preset',
    savePreset: 'Save preset',
    newPreset: 'New preset',
    deletePreset: 'Delete preset',
    restorePreset: 'Restore preset',
    builtinTag: 'built-in',
    customTag: 'custom',
    defaultTag: 'default',
    overriddenTag: 'edited',
    noInstruction: 'no extra instruction',
    restoreHint: '"Restore preset" only resets the selected preset to its shipped text; a custom preset ends up with an empty instruction.',
    errBuiltinDelete: 'Built-in preset: restore, do not delete',
    restored: 'Default text restored',
    deleteHint: 'Only custom presets can be deleted; deleting the default falls back to the built-in Default.',
    cancel: 'Cancel',
    lengthHint: 'The tier only changes this round\u2019s instruction and length cap; Medium is the old behaviour.',
    lengthLabel: 'Output length',
    lengthNames: { detailed: 'Detailed', medium: 'Medium', simple: 'Short' },
    tierDetailed: 'Detailed',
    tierMedium: 'Medium (default)',
    tierSimple: 'Short',
    tierDetailedNote: '2-3x the draft, at most 800 words; adds context, edge cases and acceptance criteria',
    tierMediumNote: 'at most 3x the draft and 600 words; identical to 1.3.0',
    tierSimpleNote: 'no longer than the draft, at most 200 words; five bullets top',
    modelHint: 'By default the plugin follows the session model. You can pin one model here; it only affects this polish call.',
    modelCurrent: 'now',
    followSession: 'Follow the session model',
    saveModel: 'Save model',
    modelFollow: 'Follow session again',
    modelProvider: 'Provider',
    modelModel: 'Model',
    modelProviderPlaceholder: 'e.g. deepseek',
    modelModelPlaceholder: 'e.g. deepseek-chat',
    sessionOption: 'Session default model',
    sessionOptionNote: 'Follow the session, no pin',
    groupSession: 'Session default',
    groupOfficial: 'Official models',
    groupOther: 'Other sources',
    groupEmpty: 'No models in this group yet',
    groupMore: '{n} more — type the provider and model below',
    groupPinned: 'Pinned (not in the current list)',
    refreshModels: 'Reload models',
    refreshed: 'Models reloaded',
    nochange: 'Nothing changed',
    tooLongPreset: 'Name or instruction too long',
    modelManual: 'Both provider and model must exist; a half pair is not saved.',
    modelHalfPair: 'incomplete, following the session',
    errModelPair: 'Fill both provider and model',
    modelPicked: 'Model pinned',
    otherHint: 'Every switch is written to the config file at once; an unset switch uses its default.',
    enabled: 'Enable the Polish capsule',
    keepTerms: 'Keep proper nouns from the draft',
    keepCode: 'Keep code, paths and identifiers',
    showNotes: 'Show rewrite notes on the confirm page',
    allowExtra: 'Allow the extra instruction',
    extra: 'Extra instruction',
    extraPlaceholder: 'Appended to the system prompt, 500 characters max',
    contextStrategy: 'Context for long chats',
    contextStrategySmart: 'Smart: compacted summary + recent turns',
    contextStrategyRecent: 'Recent turns only (old behaviour)',
    contextMessages: 'Recent messages read as context',
    contextChars: 'Context characters',
    contextHint: 'Default 12 messages / 2000 chars; messages 1-32, chars 200-8000. Smart mode also adds the todo list and matching snippets.',
    errContext: 'Context: messages 1-32, chars 200-8000',
    saveLength: 'Save length',
    saveOther: 'Save settings',
    resetLabel: 'Restore defaults',
    resetHint: 'Restoring defaults clears every change in the config file, including custom presets.',
    cycleLength: 'Cycle length',
    toggleEnabled: 'Toggle capsule',
    fallbackHint: 'This app build cannot draw the settings form; only the tier and the master switch work here. Update the app for the full page.',
    on: 'enabled',
    off: 'disabled',
    summaryPrefix: 'Now',
    saved: 'Saved',
    saveFail: 'Config write failed; nothing changed',
    errName: 'A preset needs a name',
    errLength: 'Invalid length tier',
    errLimit: `At most ${MAX_PRESETS} custom presets`,
    errGone: 'That preset is gone; reopen the page',
    already: 'Already the default preset',
    nochange: 'Nothing changed',
    notSavedYet: 'Nothing saved yet — defaults are in use',
    overlength: `Extra instruction: ${EXTRA_MAX} characters max`,
  },
}

const dict = (zh) => (zh ? T.zh : T.en)

/**
 * 模型来源分组。判断只用宿主给的信息（provider id / provider 名称），不猜模型名：
 *   · 官方模型：provider id 或名称命中官方厂商关键字（deepseek、openai、anthropic…）；
 *   · 其他来源：provider id 带 custom- / relay- / proxy- / mirror- / modlens- 等前缀，
 *     或名称里写明「中转 / 自定义 / custom」；
 *   · 识别不出来的一律归「其他来源」，行内仍显示原始 `provider · model`，方便自己判断。
 * 组内顺序 = 宿主 listProviders() 的顺序 + listModels() 的顺序，不重排。
 */
const OFFICIAL_HINT = /(deepseek|openai|anthropic|claude|gemini|google|xai|grok|mistral|moonshot|kimi|qwen|tongyi|zhipu|glm|minimax|doubao|bytedance|baichuan|stepfun)/i
// 聚合/中转平台：名字里带官方模型名也不算「官方」，一律归其他来源。
const AGGREGATOR_HINT = /(openrouter|siliconflow|together|fireworks|groq|deepinfra|poe|one-?api|llm-?gateway)/i
const RELAY_HINT = /(^|[-_])(custom|relay|proxy|mirror|thirdparty|third-party|cnkey|api2d|oneapi|newapi|modlens)([-_]|$)/i
const RELAY_NAME_HINT = /(中转|自定义|第三方|代理|custom|relay|proxy|mirror)/i

/** 'official' | 'other' */
function sourceGroup(model) {
  const id = typeof model?.provider === 'string' ? model.provider : ''
  const name = typeof model?.providerName === 'string' ? model.providerName : ''
  if (AGGREGATOR_HINT.test(id) || AGGREGATOR_HINT.test(name)) return 'other'
  if (RELAY_HINT.test(id) || RELAY_NAME_HINT.test(name)) return 'other'
  if (OFFICIAL_HINT.test(id) || OFFICIAL_HINT.test(name)) return 'official'
  return 'other'
}

/**
 * 宿主注册的 provider → model 列表，供「模型」页选择。
 * 缓存带 TTL：拿到空结果或读取失败时不会「一次即终身」——
 * 60 秒后或重新打开面板都会再试一次，另有「重新读取模型」按钮强制刷新。
 */
const MODEL_TTL_MS = 60_000
let modelCache = []
let modelAt = 0
let modelLoading = false
let modelSeq = 0

function needModelRefresh() {
  if (modelLoading) return false
  return modelCache.length === 0 || Date.now() - modelAt > MODEL_TTL_MS
}

/** 后台重新枚举；迟到结果（seq 不一致）直接丢弃。 */
function refreshModels(ctx) {
  if (ctx === undefined || modelLoading) return false
  modelLoading = true
  const seq = ++modelSeq
  void loadModels(ctx).then((models) => {
    if (seq !== modelSeq) return
    modelCache = models
    modelAt = Date.now()
    modelLoading = false
    publish({ zh: buildData(true), en: buildData(false) })
  }, () => {
    if (seq === modelSeq) modelLoading = false
  })
  return true
}

async function loadModels(ctx) {
  try {
    const llm = ctx?.get?.('llm')
    if (llm === undefined || typeof llm.listProviders !== 'function') return []
    const out = []
    // listProviders 可能给数组，也可能是 Map/Set 之类的可迭代对象。
    const providers = Array.from(llm.listProviders() ?? [])
    for (const provider of providers) {
      const id = typeof provider?.id === 'string' ? provider.id.trim() : ''
      const providerName = typeof provider?.name === 'string' ? provider.name.trim() : ''
      if (id === '') continue
      let models = []
      try {
        models = await llm.listModels(id)
      } catch {
        models = []
      }
      for (const model of Array.from(models ?? [])) {
        if (typeof model?.id !== 'string' || model.id.trim() === '') continue
        const name = typeof model?.name === 'string' && model.name.trim() !== '' ? model.name.trim() : model.id.trim()
        const entry = { provider: id, providerName, id: model.id.trim(), name }
        entry.group = sourceGroup(entry)
        out.push(entry)
      }
    }
    return out.slice(0, 40)
  } catch {
    return []
  }
}

/** 测试用：直接注入可选模型，不依赖宿主。 */
export function __setModelsForTest(models) {
  modelSeq += 1
  modelLoading = false
  modelCache = Array.isArray(models) ? models.slice(0, 40) : []
  modelAt = Date.now()
}

/**
 * 每个会话一份「正在编辑的预设」与「上次保存结果」。
 * 之前是模块级单例：两个设置页同时开着时，A 面板的保存会写进 B 面板选中的预设。
 * 现在按 scope 分开；表单提交再带上 presetId（`data.form.presetId`），双保险。
 */
const editingByKey = new Map()
const statusByKey = new Map()
/** 打开着的设置页：{ push, zh, key }。 */
const subs = new Set()

const keyOf = (scope) => (typeof scope?.sessionId === 'string' ? scope.sessionId : '')
const editingOf = (key) => editingByKey.get(key) ?? DEFAULT_PRESET_ID
const setEditing = (key, id) => { editingByKey.set(key, id) }

function mark(key, kind) {
  statusByKey.set(key, { kind, at: Date.now() })
}

function clock(at) {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function statusOf(zh, key) {
  const t = dict(zh)
  const status = statusByKey.get(key) ?? { kind: 'idle', at: 0 }
  switch (status.kind) {
    case 'saved':
      return { text: `${t.saved} · ${clock(status.at)}`, tone: 'good' }
    case 'failed':
      return { text: t.saveFail, tone: 'bad' }
    case 'name':
      return { text: t.errName, tone: 'bad' }
    case 'length':
      return { text: t.errLength, tone: 'bad' }
    case 'limit':
      return { text: t.errLimit, tone: 'warn' }
    case 'gone':
      return { text: t.errGone, tone: 'warn' }
    case 'model':
      return { text: t.errModelPair, tone: 'warn' }
    case 'builtinDelete':
      return { text: t.errBuiltinDelete, tone: 'warn' }
    case 'restored':
      return { text: t.restored, tone: 'good' }
    case 'already':
      return { text: t.already, tone: 'info' }
    case 'overlength':
      return { text: t.overlength, tone: 'warn' }
    case 'nochange':
      return { text: t.nochange, tone: 'info' }
    case 'tooLongPreset':
      return { text: t.tooLongPreset, tone: 'warn' }
    case 'context':
      return { text: t.errContext, tone: 'warn' }
    default:
      return { text: t.notSavedYet, tone: 'info' }
  }
}

function summaryOf(config, zh) {
  const t = dict(zh)
  const preset = presetName(activePreset(config, zh), zh)
  return `${t.summaryPrefix}${zh ? '：' : ': '}${config.enabled ? t.on : t.off} · ${t.lengthNames[config.length]} · ${preset}`
}

/** 预设列表：一行一个，点行切换正在编辑的预设。 */
function presetRows(config, zh, key = '') {
  const t = dict(zh)
  const editingId = editingOf(key)
  const rows = presetsOf(config, zh).map((preset) => {
    const isDefault = preset.id === config.presetId
    const tags = [preset.builtin ? t.builtinTag : t.customTag, isDefault ? t.defaultTag : '', preset.overridden ? t.overriddenTag : '']
      .filter((tag) => tag !== '')
    const scene = presetScene(preset, zh)
    const detail = scene === '' ? (preset.instruction === '' ? t.noInstruction : clip(preset.instruction, 48)) : scene
    return {
      title: presetName(preset, zh),
      subtitle: detail,
      trailing: tags.join(' · '),
      icon: isDefault ? 'check' : preset.builtin ? 'sparkle' : 'document',
      tone: preset.id === editingId ? 'info' : 'muted',
      action: { id: 'presetEdit', args: { id: preset.id } },
    }
  })
  return rows.slice(0, 24)
}

const ROW_LIMIT = 12
const NAME_CLIP = 60
const PAIR_CLIP = 120

/** 一行模型；`group` 两端一致（会话默认 / 官方 / 其他）。 */
function modelRow(model, config, zh) {
  const t = dict(zh)
  const active = `${config.modelProvider} · ${config.modelModel}`
  const follow = config.modelProvider === '' || config.modelModel === ''
  const pair = `${model.provider} · ${model.id}`
  const selected = !follow && pair === active
  return {
    title: clip(model.name, NAME_CLIP),
    subtitle: clip(pair, PAIR_CLIP),
    trailing: selected ? t.modelCurrent : '',
    icon: 'model',
    tone: selected ? 'info' : 'muted',
    action: { id: 'modelPick', args: { provider: model.provider, model: model.id } },
  }
}

function emptyGroupRow(zh) {
  const t = dict(zh)
  return { title: t.groupEmpty, icon: 'info', tone: 'muted' }
}

/**
 * 「模型」页的数据，按来源分三组，组内保持宿主顺序：
 *   session  —— 永远是「会话默认模型」一行（不固定，跟随会话）；
 *   official —— provider 命中官方关键字；
 *   others   —— 中转 / 自定义 / 无法识别。
 * 三个数组都保证非空（空组给一行不可点说明），所以列表永远不会画成「暂无数据」。
 */
function modelGroups(config, zh) {
  const t = dict(zh)
  const follow = config.modelProvider === '' || config.modelModel === ''
  const official = []
  const others = []
  for (const model of modelCache) {
    const group = model.group ?? sourceGroup(model)
    if (group === 'official') official.push(modelRow(model, config, zh))
    else others.push(modelRow(model, config, zh))
  }
  const pinned = follow ? undefined : { provider: config.modelProvider, model: config.modelModel }
  const pinnedListed = pinned === undefined || modelCache.some((m) => m.provider === pinned.provider && m.id === pinned.model)
  const clipped = (rows, total) => {
    if (rows.length === 0) return [emptyGroupRow(zh)]
    if (rows.length <= ROW_LIMIT) return rows
    return [...rows.slice(0, ROW_LIMIT), { title: t.groupMore.replace('{n}', String(total - ROW_LIMIT)), icon: 'more', tone: 'muted' }]
  }
  const session = [{
    title: t.sessionOption,
    subtitle: t.sessionOptionNote,
    trailing: follow ? t.modelCurrent : '',
    icon: 'refresh',
    tone: follow ? 'info' : 'muted',
    action: 'modelFollow',
  }]
  // 固定的模型没出现在宿主列表里时，补一行说明。**并进 session 数组**，
  // 不单独发一个可能为空的 list——空数组会被 App 画成「暂无数据」。
  if (pinned !== undefined && !pinnedListed) {
    session.push({ title: t.groupPinned, subtitle: clip(`${pinned.provider} · ${pinned.model}`, PAIR_CLIP), icon: 'pin', tone: 'info' })
  }
  return {
    session,
    official: clipped(official, official.length),
    others: clipped(others, others.length),
    officialCount: official.length,
    otherCount: others.length,
  }
}

/** 长度三档说明（列表展示，值来自当前配置）。 */
function tierRows(config, zh) {
  const t = dict(zh)
  return [
    { title: t.tierDetailed, subtitle: t.tierDetailedNote, trailing: config.length === 'detailed' ? '✓' : '', icon: 'document', tone: config.length === 'detailed' ? 'info' : 'muted' },
    { title: t.tierMedium, subtitle: t.tierMediumNote, trailing: config.length === 'medium' ? '✓' : '', icon: 'document', tone: config.length === 'medium' ? 'info' : 'muted' },
    { title: t.tierSimple, subtitle: t.tierSimpleNote, trailing: config.length === 'simple' ? '✓' : '', icon: 'document', tone: config.length === 'simple' ? 'info' : 'muted' },
  ]
}

/** 摘要行：v1 降级页与模型页共用的一份「当前设置」文案。 */
function overviewRows(config, zh) {
  const t = dict(zh)
  return [
    [t.enabled, config.enabled ? t.on : t.off],
    [t.lengthLabel, t.lengthNames[config.length]],
    [t.presetLabel, presetName(activePreset(config, zh), zh)],
    [t.keepTerms, config.keepTerms ? '✓' : '—'],
    [t.keepCode, config.keepCode ? '✓' : '—'],
    [t.showNotes, config.showNotes ? '✓' : '—'],
    [t.allowExtra, config.allowExtra ? '✓' : '—'],
    [t.tabModel, config.modelProvider !== '' && config.modelModel !== ''
      ? `${config.modelProvider} · ${config.modelModel}`
      : t.followSession],
  ]
}

/** 面板数据：视图里所有 $ 绑定都从这里取。 */
export function buildData(zh = true, key = '') {
  const t = dict(zh)
  const config = loadConfig()
  const list = presetsOf(config, zh)
  let editingId = editingOf(key)
  if (!list.some((preset) => preset.id === editingId)) {
    editingId = config.presetId
    setEditing(key, editingId)
  }
  const editing = list.find((preset) => preset.id === editingId) ?? list[0]
  return {
    summary: summaryOf(config, zh),
    status: statusOf(zh, key),
    presets: presetRows(config, zh, key),
    tiers: tierRows(config, zh),
    overview: [
      [t.enabled, config.enabled ? t.on : t.off],
      [t.lengthLabel, t.lengthNames[config.length]],
      [t.presetLabel, presetName(activePreset(config, zh), zh)],
      [t.keepTerms, config.keepTerms ? '✓' : '—'],
      [t.keepCode, config.keepCode ? '✓' : '—'],
      [t.showNotes, config.showNotes ? '✓' : '—'],
      [t.allowExtra, config.allowExtra ? '✓' : '—'],
      [t.tabModel, config.modelProvider !== '' && config.modelModel !== ''
        ? `${config.modelProvider} · ${config.modelModel}`
        : t.followSession],
    ],
    form: {
      presetId: editing.id,
      presetLabel: `${t.presetLabel}：${presetName(editing, zh)}${editing.overridden ? `（${t.overriddenTag}）` : ''}`,
      nameLocked: editing.builtin === true,
      presetName: presetName(editing, zh),
      presetInstruction: editing.instruction ?? '',
      makeDefault: editing.id === config.presetId,
      length: config.length,
      enabled: config.enabled,
      keepTerms: config.keepTerms,
      keepCode: config.keepCode,
      showNotes: config.showNotes,
      allowExtra: config.allowExtra,
      extra: config.extra,
      contextStrategy: config.contextStrategy,
      contextMessages: config.contextMessages,
      contextChars: config.contextChars,
      modelProvider: config.modelProvider,
      modelModel: config.modelModel,
    },
    // 文本形式的状态行：不再用 keyValue + 绑定数组（那条路径在 App 上会渲染成「暂无数据」）。
    modelStatus: `${t.modelCurrent}${zh ? '：' : ': '}${config.modelProvider !== '' && config.modelModel !== ''
      ? `${config.modelProvider} · ${config.modelModel}`
      : t.followSession}${config.modelProvider !== config.modelModel && (config.modelProvider === '' || config.modelModel === '')
        ? `（${t.modelHalfPair}）`
        : ''}`,
    // v1 摘要页用多行文本，不再依赖 keyValue 绑定数组。
    overviewText: overviewRows(config, zh).map(([label, value]) => `${label}：${value}`).join('\n'),
    model: {
      status: config.modelProvider !== '' && config.modelModel !== ''
        ? `${config.modelProvider} · ${config.modelModel}`
        : t.followSession,
      follow: config.modelProvider === '' || config.modelModel === '',
      empty: modelCache.length === 0,
      // 按来源分组；三组都非空（空组给说明行），列表不会再出现「暂无数据」。
      ...modelGroups(config, zh),
    },
  }
}

/** 给所有打开着的设置页推同一份数据（由调用方构建，避免一次提交重复 buildData）。 */
function publish(both) {
  for (const sub of [...subs]) {
    try {
      sub.push(sub.zh ? both.zh : both.en)
    } catch {
      subs.delete(sub)
    }
  }
}

/** 重推一次页面数据：中英各构建一份，返回**当前语言**的那份给 action 当 patch。 */
function refresh(zh, key = '') {
  const both = { zh: buildData(true, key), en: buildData(false, key) }
  publish(both)
  return { patch: zh ? both.zh : both.en }
}

/** 视图/数据/动作三处都按 `locale` 选中文，缺省中文。 */
const zhOf = (value) => !String(value?.locale ?? '').startsWith('en')

function supportsV2(caps) {
  const list = Array.isArray(caps?.components) ? caps.components : []
  return V2_COMPONENTS.every((name) => list.includes(name))
}

function viewV2(zh) {
  const t = dict(zh)
  return {
    v: 2,
    type: 'stack',
    title: t.title,
    children: [
      { type: 'text', text: { $: 'data.summary' }, tone: 'muted' },
      { type: 'callout', text: { $: 'data.status.text' }, tone: { $: 'data.status.tone' } },
      {
        type: 'tabs',
        items: [
          {
            label: t.tabPresets,
            children: [
              { type: 'text', text: t.presetsHint, tone: 'muted' },
              { type: 'list', items: { $: 'data.presets' } },
              {
                type: 'form',
                submit: 'presetSave',
                submitLabel: t.savePreset,
                children: [
                  { type: 'text', text: { $: 'data.form.presetLabel' }, tone: 'muted' },
                  {
                    type: 'textField',
                    label: t.presetName,
                    bind: 'data.form.presetName',
                    maxLength: NAME_MAX,
                    required: true,
                    readOnly: { $: 'data.form.nameLocked' },
                  },
                  {
                    type: 'textField',
                    label: t.presetInstruction,
                    bind: 'data.form.presetInstruction',
                    multiline: true,
                    maxLines: 6,
                    maxLength: INSTRUCTION_MAX,
                    placeholder: t.presetInstructionPlaceholder,
                  },
                  { type: 'toggle', label: t.makeDefault, bind: 'data.form.makeDefault' },
                ],
              },
              { type: 'actions', items: [{ label: t.newPreset, action: 'presetNew', icon: 'add' }] },
              { type: 'text', text: t.restoreHint, tone: 'muted' },
              { type: 'confirm', id: 'presetRestore', confirmLabel: t.restorePreset, cancelLabel: t.cancel },
              { type: 'confirm', id: 'presetDelete', confirmLabel: t.deletePreset, cancelLabel: t.cancel },
            ],
          },
          {
            label: t.tabLength,
            children: [
              { type: 'text', text: t.lengthHint, tone: 'muted' },
              {
                type: 'form',
                submit: 'saveLength',
                submitLabel: t.saveLength,
                children: [
                  {
                    type: 'segmented',
                    label: t.lengthLabel,
                    bind: 'data.form.length',
                    options: LENGTHS.map((id) => ({ label: t.lengthNames[id], value: id })),
                  },
                ],
              },
              { type: 'list', items: { $: 'data.tiers' } },
            ],
          },
          {
            label: t.tabModel,
            children: [
              { type: 'text', text: t.modelHint, tone: 'muted' },
              { type: 'text', text: { $: 'data.modelStatus' } },
              { type: 'text', text: t.groupSession, tone: 'muted' },
              { type: 'list', items: { $: 'data.model.session' } },
              { type: 'text', text: t.groupOfficial, tone: 'muted' },
              { type: 'list', items: { $: 'data.model.official' } },
              { type: 'text', text: t.groupOther, tone: 'muted' },
              { type: 'list', items: { $: 'data.model.others' } },
              {
                type: 'form',
                submit: 'saveModel',
                submitLabel: t.saveModel,
                children: [
                  {
                    type: 'textField',
                    label: t.modelProvider,
                    bind: 'data.form.modelProvider',
                    maxLength: 80,
                    placeholder: t.modelProviderPlaceholder,
                  },
                  {
                    type: 'textField',
                    label: t.modelModel,
                    bind: 'data.form.modelModel',
                    maxLength: 120,
                    placeholder: t.modelModelPlaceholder,
                  },
                ],
              },
              { type: 'text', text: t.modelManual, tone: 'muted' },
              { type: 'actions', items: [{ label: t.modelFollow, action: 'modelFollow', icon: 'refresh' }] },
              { type: 'actions', items: [{ label: t.refreshModels, action: 'modelRefresh', icon: 'refresh' }] },
            ],
          },
          {
            label: t.tabOther,
            children: [
              { type: 'text', text: t.otherHint, tone: 'muted' },
              {
                type: 'form',
                submit: 'saveOther',
                submitLabel: t.saveOther,
                children: [
                  { type: 'toggle', label: t.enabled, bind: 'data.form.enabled' },
                  { type: 'toggle', label: t.keepTerms, bind: 'data.form.keepTerms' },
                  { type: 'toggle', label: t.keepCode, bind: 'data.form.keepCode' },
                  { type: 'toggle', label: t.showNotes, bind: 'data.form.showNotes' },
                  { type: 'toggle', label: t.allowExtra, bind: 'data.form.allowExtra' },
                  {
                    type: 'segmented',
                    label: t.contextStrategy,
                    bind: 'data.form.contextStrategy',
                    options: [
                      { label: t.contextStrategySmart, value: 'smart' },
                      { label: t.contextStrategyRecent, value: 'recent' },
                    ],
                  },
                  { type: 'text', text: t.contextHint, tone: 'muted' },
                  {
                    type: 'number',
                    label: t.contextMessages,
                    bind: 'data.form.contextMessages',
                    min: 1,
                    max: 32,
                  },
                  {
                    type: 'number',
                    label: t.contextChars,
                    bind: 'data.form.contextChars',
                    min: 200,
                    max: 8000,
                    step: 100,
                  },
                  {
                    type: 'textField',
                    label: t.extra,
                    bind: 'data.form.extra',
                    multiline: true,
                    maxLines: 4,
                    maxLength: EXTRA_MAX,
                    placeholder: t.extraPlaceholder,
                  },
                ],
              },
              { type: 'divider' },
              { type: 'text', text: t.resetHint, tone: 'muted' },
              { type: 'confirm', id: 'resetAll', confirmLabel: t.resetLabel, cancelLabel: t.cancel },
            ],
          },
        ],
      },
    ],
  }
}

function viewV1(zh) {
  const t = dict(zh)
  return {
    type: 'stack',
    title: t.title,
    children: [
      { type: 'text', text: { $: 'data.summary' } },
      { type: 'text', text: { $: 'data.status.text' }, tone: 'muted' },
      { type: 'text', text: t.fallbackHint, tone: 'muted' },
      { type: 'text', text: { $: 'data.overviewText' }, tone: 'muted' },
      {
        type: 'actions',
        items: [
          { label: t.cycleLength, action: 'lengthCycle', icon: 'refresh' },
          { label: t.toggleEnabled, action: 'toggleEnabled', icon: 'power' },
        ],
      },
    ],
  }
}

export function settingsView(_scope, caps) {
  const zh = zhOf(caps)
  return supportsV2(caps) ? viewV2(zh) : viewV1(zh)
}

export function createData(ctx) {
  return (_scope, emit, caps) => {
    const zh = zhOf(caps)
    const sub = { push: emit, zh }
    subs.add(sub)
    try {
      emit(buildData(zh))
    } catch {
      subs.delete(sub)
    }
    if (needModelRefresh()) refreshModels(ctx)
    return () => {
      subs.delete(sub)
    }
  }
}

const valuesOf = (event) => {
  const value = event?.value
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const values = value.values
  return values !== null && typeof values === 'object' && !Array.isArray(values) ? values : {}
}

const pickBool = (values, key, fallback) => (typeof values[`data.form.${key}`] === 'boolean' ? values[`data.form.${key}`] : fallback)
const pickNum = (values, key, fallback) => {
  const raw = values[`data.form.${key}`]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

const pickText = (values, key, fallback) => (typeof values[`data.form.${key}`] === 'string' ? values[`data.form.${key}`] : fallback)

function finish(zh, key, kind, toast) {
  mark(key, kind)
  const out = refresh(zh, key)
  return toast === undefined ? out : { ...out, toast }
}

/**
 * 保存预设内容。内置预设：把指令写成「覆盖条目」（id + instruction），名字与 id 不动；
 * 自定义预设：名称与指令都写回去。两种都支持「设为默认」。
 */
function savePreset(zh, key, event) {
  const t = dict(zh)
  const config = loadConfig()
  const values = valuesOf(event)
  // 表单提交携带目标预设 id；缺失时才回落到本会话的编辑状态。
  const target = pickText(values, 'presetId', editingOf(key))
  const preset = presetsOf(config, zh).find((item) => item.id === target)
  if (preset === undefined) return finish(zh, key, 'gone', t.errGone)
  const makeDefault = pickBool(values, 'makeDefault', preset.id === config.presetId)
  const rawInstruction = pickText(values, 'presetInstruction', preset.instruction)
  const rawName = pickText(values, 'presetName', preset.name ?? '')
  if (rawInstruction.length > INSTRUCTION_MAX || rawName.length > NAME_MAX) {
    return finish(zh, key, 'tooLongPreset', t.tooLongPreset)
  }
  const instruction = clip(rawInstruction.trim(), INSTRUCTION_MAX)
  if (preset.builtin === true) {
    const shipped = BUILTIN_PRESETS.find((item) => item.id === preset.id)
    const factory = shipped === undefined ? '' : (zh ? shipped.instruction.zh : shipped.instruction.en)
    const hasOverride = config.presets.some((item) => item.id === preset.id)
    const wantsDefault = makeDefault && config.presetId !== preset.id
    // 内容与出厂一致、又没有覆盖条目、也没改默认 → 什么都不用写。
    if (instruction === factory && !hasOverride && !wantsDefault) {
      const kind = preset.id === config.presetId ? 'already' : 'nochange'
      return finish(zh, key, kind, kind === 'already' ? t.already : t.nochange)
    }
    const rest = config.presets.filter((item) => item.id !== preset.id)
    const entry = { id: preset.id, instruction }
    const presets = [...rest, entry]
    const result = saveConfig({ presets, ...(makeDefault ? { presetId: preset.id } : {}) })
    log({ event: 'settings-preset-save', id: preset.id, builtin: true, instructionLen: instruction.length, makeDefault })
    return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? t.saved : t.saveFail)
  }
  const name = clip(pickText(values, 'presetName', preset.name).trim(), NAME_MAX)
  if (name === '') return finish(zh, key, 'name', t.errName)
  const presets = config.presets.map((item) => (item.id === preset.id ? { id: item.id, name, instruction } : item))
  const result = saveConfig({ presets, ...(makeDefault ? { presetId: preset.id } : {}) })
  log({ event: 'settings-preset-save', id: preset.id, instructionLen: instruction.length, makeDefault })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? t.saved : t.saveFail)
}

/** 恢复当前预设的出厂内容：内置移除覆盖条目，自定义清空指令。 */
function restorePreset(zh, key, event) {
  const t = dict(zh)
  if (event?.value?.confirmed !== true) return refresh(zh, key)
  const config = loadConfig()
  const preset = presetsOf(config, zh).find((item) => item.id === editingOf(key))
  if (preset === undefined) return finish(zh, key, 'gone', t.errGone)
  const presets = preset.builtin === true
    ? config.presets.filter((item) => item.id !== preset.id)
    : config.presets.map((item) => (item.id === preset.id ? { ...item, instruction: '' } : item))
  const result = saveConfig({ presets })
  log({ event: 'settings-preset-restore', id: preset.id, builtin: preset.builtin === true })
  return finish(zh, key, result.ok ? 'restored' : 'failed', result.ok ? t.restored : t.saveFail)
}

function saveLength(zh, key, event) {
  const t = dict(zh)
  const values = valuesOf(event)
  const length = pickText(values, 'length', loadConfig().length)
  if (!LENGTHS.includes(length)) return finish(zh, key, 'length', t.errLength)
  const result = saveConfig({ length })
  log({ event: 'settings-length', length })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? `${t.saved} · ${t.lengthNames[length]}` : t.saveFail)
}

function saveOther(zh, key, event) {
  const t = dict(zh)
  const config = loadConfig()
  const values = valuesOf(event)
  const rawExtra = pickText(values, 'extra', config.extra)
  if (rawExtra.length > EXTRA_MAX) return finish(zh, key, 'overlength', t.overlength)
  const extra = clip(rawExtra.trim(), EXTRA_MAX)
  const messages = Math.round(pickNum(values, 'contextMessages', config.contextMessages))
  const chars = Math.round(pickNum(values, 'contextChars', config.contextChars))
  if (messages < 1 || messages > 32 || chars < 200 || chars > 8000) return finish(zh, key, 'context', t.errContext)
  const strategy = pickText(values, 'contextStrategy', config.contextStrategy)
  const patch = {
    contextStrategy: strategy === 'recent' ? 'recent' : 'smart',
    contextMessages: messages,
    contextChars: chars,
    enabled: pickBool(values, 'enabled', config.enabled),
    keepTerms: pickBool(values, 'keepTerms', config.keepTerms),
    keepCode: pickBool(values, 'keepCode', config.keepCode),
    showNotes: pickBool(values, 'showNotes', config.showNotes),
    allowExtra: pickBool(values, 'allowExtra', config.allowExtra),
    extra,
  }
  const result = saveConfig(patch)
  log({ event: 'settings-other', keys: Object.keys(patch).filter((key) => key !== 'extra'), extraLen: extra.length })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? t.saved : t.saveFail)
}

function editPreset(zh, key, event) {
  const t = dict(zh)
  const id = typeof event?.value?.id === 'string' ? event.value.id : ''
  const config = loadConfig()
  if (!presetsOf(config, zh).some((preset) => preset.id === id)) return finish(zh, key, 'gone', t.errGone)
  setEditing(key, id)
  return refresh(zh, key)
}

function addPreset(zh, key) {
  const t = dict(zh)
  const config = loadConfig()
  const custom = config.presets.filter((item) => !BUILTIN_IDS.includes(item.id))
  if (custom.length >= MAX_PRESETS) return finish(zh, key, 'limit', t.errLimit)
  const preset = newPreset(config, zh)
  const result = saveConfig({ presets: [...config.presets, preset] })
  if (!result.ok) return finish(zh, key, 'failed', t.saveFail)
  setEditing(key, preset.id)
  log({ event: 'settings-preset-new', id: preset.id })
  return finish(zh, key, 'saved', t.saved)
}

function deletePreset(zh, key, event) {
  const t = dict(zh)
  if (event?.value?.confirmed !== true) return refresh(zh, key)
  const config = loadConfig()
  const preset = presetsOf(config, zh).find((item) => item.id === editingOf(key))
  if (preset === undefined) return finish(zh, key, 'gone', t.errGone)
  if (preset.builtin === true) return finish(zh, key, 'builtinDelete', t.errBuiltinDelete)
  const presets = config.presets.filter((item) => item.id !== preset.id)
  const presetId = config.presetId === preset.id ? DEFAULT_PRESET_ID : config.presetId
  const result = saveConfig({ presets, presetId })
  if (!result.ok) return finish(zh, key, 'failed', t.saveFail)
  setEditing(key, presetId)
  log({ event: 'settings-preset-delete', id: preset.id })
  return finish(zh, key, 'saved', t.saved)
}

function resetAll(zh, key, event) {
  const t = dict(zh)
  if (event?.value?.confirmed !== true) return refresh(zh, key)
  const result = resetConfig()
  setEditing(key, DEFAULT_PRESET_ID)
  log({ event: 'settings-reset' })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? t.resetLabel : t.saveFail)
}

/** 固定模型（从列表点选）。 */
function pickModel(zh, key, event) {
  const t = dict(zh)
  const provider = typeof event?.value?.provider === 'string' ? event.value.provider.trim() : ''
  const model = typeof event?.value?.model === 'string' ? event.value.model.trim() : ''
  if (provider === '' || model === '') return finish(zh, key, 'model', t.errModelPair)
  const result = saveConfig({ modelProvider: provider, modelModel: model })
  log({ event: 'settings-model', pinned: true })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? t.modelPicked : t.saveFail)
}

/** 手填 provider / model：成对填或都留空（留空 = 跟随会话）。 */
function saveModel(zh, key, event) {
  const t = dict(zh)
  const config = loadConfig()
  const values = valuesOf(event)
  const provider = clip(pickText(values, 'modelProvider', config.modelProvider).trim(), 80)
  const model = clip(pickText(values, 'modelModel', config.modelModel).trim(), 120)
  if ((provider === '') !== (model === '')) return finish(zh, key, 'model', t.errModelPair)
  const result = saveConfig({ modelProvider: provider, modelModel: model })
  log({ event: 'settings-model', pinned: provider !== '' })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? t.saved : t.saveFail)
}

function followModel(zh, key) {
  const t = dict(zh)
  const result = saveConfig({ modelProvider: '', modelModel: '' })
  log({ event: 'settings-model', pinned: false })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? t.followSession : t.saveFail)
}

function cycleLength(zh) {
  const t = dict(zh)
  const config = loadConfig()
  const next = LENGTHS[(LENGTHS.indexOf(config.length) + 1) % LENGTHS.length]
  const result = saveConfig({ length: next })
  log({ event: 'settings-length', length: next, cycle: true })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? `${t.saved} · ${t.lengthNames[next]}` : t.saveFail)
}

function toggleEnabled(zh) {
  const t = dict(zh)
  const config = loadConfig()
  const enabled = !config.enabled
  const result = saveConfig({ enabled })
  log({ event: 'settings-enabled', enabled })
  return finish(zh, key, result.ok ? 'saved' : 'failed', result.ok ? `${t.saved} · ${enabled ? t.on : t.off}` : t.saveFail)
}

export const SETTINGS_ACTIONS = {
  presetEdit: (scope, event) => editPreset(zhOf(event), keyOf(scope), event),
  presetNew: (scope, event) => addPreset(zhOf(event), keyOf(scope)),
  presetSave: (scope, event) => savePreset(zhOf(event), keyOf(scope), event),
  presetDelete: (scope, event) => deletePreset(zhOf(event), keyOf(scope), event),
  presetRestore: (scope, event) => restorePreset(zhOf(event), keyOf(scope), event),
  modelPick: (_scope, event) => pickModel(zhOf(event), '', event),
  saveModel: (_scope, event) => saveModel(zhOf(event), '', event),
  modelFollow: (_scope, event) => followModel(zhOf(event), ''),
  saveLength: (_scope, event) => saveLength(zhOf(event), '', event),
  saveOther: (_scope, event) => saveOther(zhOf(event), '', event),
  resetAll: (scope, event) => resetAll(zhOf(event), keyOf(scope), event),
  lengthCycle: (_scope, event) => cycleLength(zhOf(event), ''),
  toggleEnabled: (_scope, event) => toggleEnabled(zhOf(event), ''),
}

/**
 * 带 ctx 的动作表：在通用动作基础上加「重新读取模型」——
 * 它需要宿主句柄，所以只能在注册时用闭包拿。
 */
export function createActions(ctx) {
  return {
    ...SETTINGS_ACTIONS,
    modelRefresh: (_scope, event) => {
      const zh = zhOf(event)
      const t = dict(zh)
      modelAt = 0
      const started = refreshModels(ctx)
      log({ event: 'settings-model-refresh', started })
      return {
        ...refresh(zh, ''),
        toast: started ? t.refreshed : t.saveFail,
      }
    },
  }
}

/** 注册设置页（在 ctx.inject(['dshGo'], …) 里调用）。 */
export function applySettings(ctx) {
  ctx.dshGo.panel(SETTINGS_PANEL, {
    view: settingsView,
    data: createData(ctx),
    actions: createActions(ctx),
  })
}
