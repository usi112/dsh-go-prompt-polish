// 插件配置：一个 JSON 文件放在插件目录（和 .log.jsonl 同级），写入走「临时文件 + rename」。
//
// 设计约定（保证兼容已有用户）：
//   • 没有配置文件 = 全部默认值，行为和 1.3.0 完全一致（内置预设里只有「默认」会进提示词，
//     且它的指令为空；1.4.0 的字段一个都没变，只是多了可选字段）；
//   • 坏 JSON / 非法字段不抛错，只丢该字段，回落默认值；
//   • 缓存按「文件原文」比对而不是 mtime：这台机器的文件系统 mtime 只有约 4ms
//     粒度，连续两次同尺寸写入会拿到相同的 mtime，按时间戳缓存会读到旧配置。
//     文件不到 2 KiB，每次读一遍原文比猜时间戳可靠，手改文件也能立刻生效；
//   • 这个文件只放设置，不放任何密钥或凭据。
//
// 字段（全部可选）：
//   v            配置版本，当前 2（读到 1 也能用，缺的字段补默认值）
//   enabled      总开关，false 时胶囊只提示并打开设置页
//   length       输出长度档：detailed / medium / simple，默认 medium
//   presetId     默认预设 id，默认 'default'
//   presets      预设改动：[{ id, name, instruction }]
//                  · id 是内置预设（9 套之一）→ 只认 instruction，等于「改内置预设的内容」；
//                  · 其他 id → 自定义预设，需要 name。
//   keepTerms    保留草稿里的专有名词，默认 true
//   keepCode     保留草稿里的代码、路径与标识符，默认 true
//   showNotes    确认页显示「改写说明」，默认 false
//   allowExtra   允许使用附加指令，默认 true
//   extra        附加指令正文，默认空
//   contextStrategy 上下文策略：smart（默认，摘要/任务锚点 + BM25 片段 + 最近消息）/ recent（只看最近消息，=1.3.0）
//   contextPicker   是否让模型再筛一次相关片段（默认 false，多一次小调用）
//   contextMessages 读取多少条最近消息做上下文，默认 12，范围 1–32
//   contextChars    上下文总字数上限，默认 2000，范围 200–8000
//   modelProvider 固定使用的模型提供方 id，默认空 = 跟随当前会话的模型
//   modelModel    固定使用的模型 id，默认空（与 modelProvider 成对生效）

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.js'

export const CONFIG_VERSION = 2
export const LENGTHS = ['detailed', 'medium', 'simple']
export const DEFAULT_LENGTH = 'medium'
export const DEFAULT_PRESET_ID = 'default'
export const MAX_PRESETS = 12
export const DEFAULT_CONTEXT_MESSAGES = 12
export const DEFAULT_CONTEXT_CHARS = 2000
export const CONTEXT_MESSAGES_MIN = 1
export const CONTEXT_MESSAGES_MAX = 32
export const CONTEXT_CHARS_MIN = 200
export const CONTEXT_CHARS_MAX = 8000
export const CONTEXT_STRATEGIES = ['smart', 'recent']
export const DEFAULT_CONTEXT_STRATEGY = 'smart'
export const NAME_MAX = 24
export const INSTRUCTION_MAX = 500
export const EXTRA_MAX = 500

const PRESET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/

/**
 * 内置预设：9 套日常场景，id 固定、不能改名或删除，但**内容可以改**
 * （改后的指令存进 config.presets 里同 id 的条目，等于覆盖）。
 * 只有「默认」的指令为空——这是 1.3.0 的行为，也是「什么都不配」时的样子。
 */
export const BUILTIN_PRESETS = Object.freeze([
  Object.freeze({
    id: DEFAULT_PRESET_ID,
    name: Object.freeze({ zh: '默认', en: 'Default' }),
    scene: Object.freeze({ zh: '通用改写，不加额外要求', en: 'General rewrite, no extra requirements' }),
    instruction: Object.freeze({ zh: '', en: '' }),
  }),
  Object.freeze({
    id: 'coding',
    name: Object.freeze({ zh: '写代码', en: 'Coding' }),
    scene: Object.freeze({ zh: '新功能、改实现、重构', en: 'New features, implementation changes' }),
    instruction: Object.freeze({
      zh: '围绕「写/改代码」改写：明确语言与版本、运行环境、输入与输出、边界与错误处理、性能或兼容性要求；给出可验证的验收标准（测试用例或手动步骤）；保留草稿里的函数名、接口名、路径与依赖名。',
      en: 'Rewrite for writing or changing code: state the language and version, runtime, inputs and outputs, edge cases and error handling, performance or compatibility constraints; include verifiable acceptance criteria (tests or manual steps); keep every function, endpoint, path and dependency name from the draft.',
    }),
  }),
  Object.freeze({
    id: 'review',
    name: Object.freeze({ zh: '代码审查', en: 'Code review' }),
    scene: Object.freeze({ zh: 'PR、补丁、代码片段审查', en: 'PRs, patches, snippets' }),
    instruction: Object.freeze({
      zh: '围绕「代码审查」改写：要求按严重度从高到低列问题（正确性 → 安全 → 性能 → 可维护性），每条带定位（文件或符号）、最小修复建议与验证方式；明确不要重写整段代码、不要纠缠无关风格。',
      en: 'Rewrite for a code review: ask for issues ordered by severity (correctness, security, performance, maintainability), each with a location, the smallest fix and how to verify it; state that rewriting whole blocks and unrelated style churn are out of scope.',
    }),
  }),
  Object.freeze({
    id: 'bug',
    name: Object.freeze({ zh: '排障', en: 'Debugging' }),
    scene: Object.freeze({ zh: '报错、行为异常、线上问题', en: 'Errors, wrong behaviour, incidents' }),
    instruction: Object.freeze({
      zh: '围绕「排障」改写：写清症状、复现步骤、期望与实际、环境与版本、相关日志或报错原文；要求先给 2–3 个可能原因及各自的验证方法，再给最小复现与修复方案；不要一上来就改代码。',
      en: 'Rewrite for debugging: symptoms, reproduction steps, expected versus actual, environment and version, relevant logs or the exact error text; ask for two or three hypotheses with ways to test each before any fix, plus a minimal reproduction.',
    }),
  }),
  Object.freeze({
    id: 'docs',
    name: Object.freeze({ zh: '写文档', en: 'Docs' }),
    scene: Object.freeze({ zh: 'README、使用说明、上手教程', en: 'READMEs, guides, onboarding' }),
    instruction: Object.freeze({
      zh: '围绕「写文档」改写：说明读者是谁、要完成什么任务；给出可直接复制运行的步骤、示例与常见坑；结构按「是什么 → 怎么装 → 怎么用 → 出问题怎么办」；不要营销腔，不要编造没验证过的行为。',
      en: 'Rewrite for documentation: name the reader and the task they must complete; require copy-pasteable steps, examples and common pitfalls; structure as what it is, install, usage, troubleshooting; no marketing tone, no invented behaviour.',
    }),
  }),
  Object.freeze({
    id: 'writing',
    name: Object.freeze({ zh: '写作润色', en: 'Writing' }),
    scene: Object.freeze({ zh: '邮件、文案、文章、汇报', en: 'Mail, copy, articles, updates' }),
    instruction: Object.freeze({
      zh: '围绕「写作润色」改写：明确读者、目的与场合、期望语气（正式/轻松/克制）、篇幅上限；保留术语与事实，删掉空话和重复；交付可以直接用的成稿，不要解释改写过程。',
      en: 'Rewrite for writing and editing: state the reader, purpose and setting, the tone wanted and the length limit; keep terminology and facts, cut filler and repetition; deliver the finished text, not commentary about it.',
    }),
  }),
  Object.freeze({
    id: 'data',
    name: Object.freeze({ zh: '数据与 SQL', en: 'Data & SQL' }),
    scene: Object.freeze({ zh: '查询、指标口径、报表', en: 'Queries, metric definitions, reports' }),
    instruction: Object.freeze({
      zh: '围绕「数据与 SQL」改写：写清表名与关键字段、统计口径、时间范围与时区；要求输出可执行 SQL 并提示索引或全表扫描风险；不确定的字段先写成假设并标注；同时给出结果的自检方法。',
      en: 'Rewrite for data and SQL: name the tables and key columns, the metric definition, the time range and timezone; ask for runnable SQL with notes on indexes or full scans; mark assumptions about unknown columns; include a way to sanity-check the result.',
    }),
  }),
  Object.freeze({
    id: 'product',
    name: Object.freeze({ zh: '需求与产品', en: 'Product' }),
    scene: Object.freeze({ zh: '需求稿、用户故事、验收标准', en: 'Specs, user stories, acceptance criteria' }),
    instruction: Object.freeze({
      zh: '围绕「需求与产品」改写：写成用户故事（谁、在什么场景、要完成什么、为什么），给出可测的验收标准与边界条件，明确非目标与优先级；不替用户做业务取舍，信息不够就列成待确认的问题。',
      en: 'Rewrite for product requirements: a user story (who, in what situation, wants what, and why), testable acceptance criteria and edge cases, explicit non-goals and priority; never decide business trade-offs for the user — list open questions instead.',
    }),
  }),
  Object.freeze({
    id: 'learn',
    name: Object.freeze({ zh: '学习讲解', en: 'Learning' }),
    scene: Object.freeze({ zh: '概念、原理、技术入门', en: 'Concepts, principles, getting started' }),
    instruction: Object.freeze({
      zh: '围绕「学习讲解」改写：说明当前已掌握的程度与想达到的目标；要求由浅入深，先给心智模型再补细节，配一个最小例子和一个常见误解；结尾给 2–3 个能自测理解的问题；不堆术语。',
      en: 'Rewrite for learning: state the current level and the goal; go from a mental model to details, add one minimal example and one common misconception; end with two or three self-check questions; avoid jargon stacking.',
    }),
  }),
])

export const BUILTIN_IDS = Object.freeze(BUILTIN_PRESETS.map((preset) => preset.id))

/**
 * 配置文件路径。测试可用 PROMPT_POLISH_CONFIG 指到临时目录。
 * 只认绝对路径且不含 `..`：环境变量被乱设时宁可回到插件目录，也不要写到别处去。
 */
const DEFAULT_FILE = fileURLToPath(new URL('../.config.json', import.meta.url))
let warnEnv = ''

export function configFile() {
  const override = process.env.PROMPT_POLISH_CONFIG
  if (typeof override === 'string' && override !== '' && override.startsWith('/') && !override.split('/').includes('..')) return override
  // 设了但不可用（相对路径 / 带 ..）时回到插件目录，并只提醒一次，别让用户以为设置在生效。
  if (typeof override === 'string' && override !== '' && warnEnv !== override) {
    warnEnv = override
    log({ event: 'config-env-ignored' })
  }
  return DEFAULT_FILE
}

export function clip(value, max) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/** 全量默认值。每次返回新对象，调用方可以随便改。 */
export function defaults() {
  return {
    v: CONFIG_VERSION,
    enabled: true,
    length: DEFAULT_LENGTH,
    presetId: DEFAULT_PRESET_ID,
    presets: [],
    keepTerms: true,
    keepCode: true,
    showNotes: false,
    allowExtra: true,
    extra: '',
    contextStrategy: DEFAULT_CONTEXT_STRATEGY,
    contextPicker: false,
    contextMessages: DEFAULT_CONTEXT_MESSAGES,
    contextChars: DEFAULT_CONTEXT_CHARS,
    modelProvider: '',
    modelModel: '',
  }
}

const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

function clampInt(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
const asText = (value, max) => (typeof value === 'string' ? clip(value.trim(), max) : '')

/**
 * 预设改动条目：
 *   · 内置 id → `{ id, instruction }`（只存内容，名字永远用内置的）；
 *   · 其他 id → `{ id, name, instruction }`。
 * 内置 id 排前面，自定义最多 MAX_PRESETS 个；重复 id 只留第一条。
 */
function normalizePresets(raw) {
  const overrides = []
  const custom = []
  const seen = new Set()
  for (const item of Array.isArray(raw) ? raw : []) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const id = typeof item.id === 'string' && PRESET_ID.test(item.id) ? item.id : ''
    if (id === '' || seen.has(id)) continue
    if (BUILTIN_IDS.includes(id)) {
      seen.add(id)
      overrides.push({ id, instruction: asText(item.instruction, INSTRUCTION_MAX) })
      continue
    }
    if (custom.length >= MAX_PRESETS) continue
    const name = asText(item.name, NAME_MAX)
    if (name === '') continue
    seen.add(id)
    custom.push({ id, name, instruction: asText(item.instruction, INSTRUCTION_MAX) })
  }
  return [...overrides, ...custom]
}

/**
 * 把读到的任意对象洗成可用配置。永远返回 `{ config, problems }`，
 * problems 只用于诊断，不参与控制流。
 */
export function normalize(raw) {
  const base = defaults()
  const problems = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined) problems.push('config-root')
    return { config: base, problems }
  }
  const config = {
    v: CONFIG_VERSION,
    enabled: asBool(raw.enabled, base.enabled),
    length: LENGTHS.includes(raw.length) ? raw.length : base.length,
    presets: normalizePresets(raw.presets),
    keepTerms: asBool(raw.keepTerms, base.keepTerms),
    keepCode: asBool(raw.keepCode, base.keepCode),
    showNotes: asBool(raw.showNotes, base.showNotes),
    allowExtra: asBool(raw.allowExtra, base.allowExtra),
    extra: asText(raw.extra, EXTRA_MAX),
    contextStrategy: CONTEXT_STRATEGIES.includes(raw.contextStrategy) ? raw.contextStrategy : DEFAULT_CONTEXT_STRATEGY,
    contextPicker: asBool(raw.contextPicker, false),
    contextMessages: clampInt(raw.contextMessages, DEFAULT_CONTEXT_MESSAGES, CONTEXT_MESSAGES_MIN, CONTEXT_MESSAGES_MAX),
    contextChars: clampInt(raw.contextChars, DEFAULT_CONTEXT_CHARS, CONTEXT_CHARS_MIN, CONTEXT_CHARS_MAX),
    modelProvider: asText(raw.modelProvider, 80),
    modelModel: asText(raw.modelModel, 120),
  }
  const ids = new Set(config.presets.map((preset) => preset.id))
  const known = (id) => BUILTIN_IDS.includes(id) || ids.has(id)
  const wanted = typeof raw.presetId === 'string' ? raw.presetId : ''
  config.presetId = known(wanted) ? wanted : DEFAULT_PRESET_ID
  if (raw.length !== undefined && !LENGTHS.includes(raw.length)) problems.push('config-length')
  if (wanted !== '' && config.presetId !== wanted) problems.push('config-presetId')
  return { config, problems }
}

let cache = { raw: null, config: defaults() }

/** 当前配置。文件原文没变就复用缓存；读不到（或坏了）就是默认值。 */
export function loadConfig() {
  const file = configFile()
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    cache = { raw: null, config: defaults() }
    return cache.config
  }
  if (raw === cache.raw) return cache.config
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 坏文件：这一次用默认值，但保留原文当缓存键，避免每次点按都重读同一份坏文件。
    cache = { raw, config: defaults() }
    return cache.config
  }
  const { config, problems } = normalize(parsed)
  cache = { raw, config }
  if (problems.length > 0) log({ event: 'config-problems', problems })
  return config
}

function write(config) {
  const file = configFile()
  // 整份重写会把用户手写的未知字段抹掉；先读一份旧的，只保留我们没管的键。
  let unknown = {}
  try {
    const previous = JSON.parse(readFileSync(file, 'utf8'))
    if (previous !== null && typeof previous === 'object' && !Array.isArray(previous)) {
      const known = new Set(Object.keys(defaults()))
      for (const [k, v] of Object.entries(previous)) if (!known.has(k)) unknown[k] = v
    }
  } catch {
    unknown = {}
  }
  const payload = { ...unknown, ...config }
  const raw = `${JSON.stringify(payload, null, 2)}\n`
  const tmp = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, raw)
    renameSync(tmp, file)
    cache = { raw, config }
    return { ok: true, config }
  } catch (error) {
    // 半成品别留在插件目录里，下次失败还会再试同一个名字。
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* nothing to clean */
    }
    return { ok: false, config: loadConfig(), error: String(error?.message ?? error) }
  }
}

/** 合并写入：patch 里的字段覆盖当前值，其余保持。 */
export function saveConfig(patch) {
  const merged = { ...loadConfig(), ...(patch ?? {}) }
  return write(normalize(merged).config)
}

/** 恢复默认：等同于删掉配置（自定义预设与内置预设的改动一起清掉）。 */
export function resetConfig() {
  return write(defaults())
}

/**
 * 内置 + 自定义，顺序固定：9 套内置按 BUILTIN_PRESETS 的顺序在前，自定义在后。
 * 内置预设被改过时 `overridden` 为 true，`instruction` 返回改动后的内容。
 */
export function presetsOf(config, zh = true) {
  const stored = Array.isArray(config?.presets) ? config.presets : []
  const list = BUILTIN_PRESETS.map((preset) => {
    const override = stored.find((item) => item.id === preset.id)
    const fallback = zh ? preset.instruction.zh : preset.instruction.en
    return {
      id: preset.id,
      name: preset.name,
      scene: preset.scene,
      instruction: override === undefined ? fallback : override.instruction,
      builtin: true,
      overridden: override !== undefined && override.instruction !== fallback,
    }
  })
  for (const preset of stored) {
    if (BUILTIN_IDS.includes(preset.id)) continue
    list.push({ ...preset, builtin: false, overridden: false })
  }
  return list
}

export function presetName(preset, zh) {
  if (preset === undefined || preset === null) return zh ? '默认' : 'Default'
  if (typeof preset.name === 'string') return preset.name
  const map = preset.name ?? {}
  return (zh ? map.zh : map.en) ?? map.zh ?? map.en ?? ''
}

export function presetScene(preset, zh) {
  const scene = preset?.scene
  if (scene === undefined || scene === null) return ''
  if (typeof scene === 'string') return scene
  return (zh ? scene.zh : scene.en) ?? scene.zh ?? scene.en ?? ''
}

export function activePreset(config, zh) {
  const list = presetsOf(config, zh)
  return list.find((preset) => preset.id === config?.presetId) ?? list[0]
}

/** 新预设：id 递增、名字取第一个没被占用的「预设 N」，指令留空。 */
export function newPreset(config, zh) {
  const used = new Set(presetsOf(config, zh).map((preset) => preset.id))
  const names = new Set(presetsOf(config, zh).map((preset) => presetName(preset, zh)))
  let index = 1
  let id = ''
  do {
    id = `p${index}`
    index += 1
  } while (used.has(id) && index <= MAX_PRESETS + 1)
  let n = (config?.presets?.filter((item) => !BUILTIN_IDS.includes(item.id)).length ?? 0) + 1
  while (names.has(zh ? `预设 ${n}` : `Preset ${n}`)) n += 1
  return { id, name: zh ? `预设 ${n}` : `Preset ${n}`, instruction: '' }
}

/**
 * 交给改写核心的选项：档位、保留开关、命中预设的指令、附加指令、自定义接口。
 * 什么都没配时返回的对象让 polish.js 走原路径（提示词逐字不变）。
 */
export function polishOptions(config, zh) {
  const preset = activePreset(config, zh)
  const instruction = typeof preset?.instruction === 'string' ? preset.instruction.trim() : ''
  const extra = config?.allowExtra === false ? '' : String(config?.extra ?? '').trim()
  const context = {
    strategy: CONTEXT_STRATEGIES.includes(config?.contextStrategy) ? config.contextStrategy : DEFAULT_CONTEXT_STRATEGY,
    picker: config?.contextPicker === true,
    messages: clampInt(config?.contextMessages, DEFAULT_CONTEXT_MESSAGES, CONTEXT_MESSAGES_MIN, CONTEXT_MESSAGES_MAX),
    chars: clampInt(config?.contextChars, DEFAULT_CONTEXT_CHARS, CONTEXT_CHARS_MIN, CONTEXT_CHARS_MAX),
  }
  const provider = typeof config?.modelProvider === 'string' ? config.modelProvider.trim() : ''
  const model = typeof config?.modelModel === 'string' ? config.modelModel.trim() : ''
  return {
    length: LENGTHS.includes(config?.length) ? config.length : DEFAULT_LENGTH,
    keepTerms: config?.keepTerms !== false,
    keepCode: config?.keepCode !== false,
    preset: instruction === '' ? undefined : { name: presetName(preset, zh), instruction },
    extra: extra === '' ? undefined : extra,
    context,
    model: provider === '' || model === '' ? undefined : { provider, model },
  }
}
