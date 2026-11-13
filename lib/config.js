// 插件配置：一个 JSON 文件放在插件目录（和 .log.jsonl 同级），写入走「临时文件 + rename」。
//
// 设计约定（保证兼容已有用户）：
//   • 没有配置文件 = 全部默认值，行为和 1.3.0 完全一致；
//   • 坏 JSON / 非法字段不抛错，只丢该字段，回落默认值；
//   • 缓存按「文件原文」比对而不是 mtime：这台机器的文件系统 mtime 只有约 4ms
//     粒度，连续两次同尺寸写入会拿到相同的 mtime，按时间戳缓存会读到旧配置。
//     文件不到 2 KiB，每次读一遍原文比猜时间戳可靠，手改文件也能立刻生效。
//
// 字段（全部可选）：
//   v          配置版本，当前 1
//   enabled    总开关，false 时胶囊只提示并打开设置页
//   length     输出长度档：detailed / medium / simple，默认 medium
//   presetId   默认预设 id，默认 'default'
//   presets    自定义预设 [{ id, name, instruction }]，内置「默认」不写进文件
//   keepTerms  保留草稿里的专有名词，默认 true
//   keepCode   保留草稿里的代码、路径与标识符，默认 true
//   showNotes  确认页显示「改写说明」，默认 false
//   allowExtra 允许使用附加指令，默认 true
//   extra      附加指令正文，默认空

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.js'

export const CONFIG_VERSION = 1
export const LENGTHS = ['detailed', 'medium', 'simple']
export const DEFAULT_LENGTH = 'medium'
export const DEFAULT_PRESET_ID = 'default'
export const MAX_PRESETS = 12
export const NAME_MAX = 24
export const INSTRUCTION_MAX = 500
export const EXTRA_MAX = 500

const PRESET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/

/** 内置预设：永远存在，不能改名、不能删除；指令为空，等于「不加任何附加要求」。 */
export const BUILTIN_PRESETS = Object.freeze([
  Object.freeze({ id: DEFAULT_PRESET_ID, name: Object.freeze({ zh: '默认', en: 'Default' }), instruction: '', builtin: true }),
])

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
  }
}

const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const asText = (value, max) => (typeof value === 'string' ? clip(value.trim(), max) : '')

function normalizePresets(raw) {
  const out = []
  const seen = new Set([DEFAULT_PRESET_ID])
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_PRESETS) break
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const id = typeof item.id === 'string' && PRESET_ID.test(item.id) ? item.id : ''
    if (id === '' || seen.has(id)) continue
    const name = asText(item.name, NAME_MAX)
    if (name === '') continue
    seen.add(id)
    out.push({ id, name, instruction: asText(item.instruction, INSTRUCTION_MAX) })
  }
  return out
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
    v: Number.isInteger(raw.v) && raw.v > 0 ? raw.v : CONFIG_VERSION,
    enabled: asBool(raw.enabled, base.enabled),
    length: LENGTHS.includes(raw.length) ? raw.length : base.length,
    presets: normalizePresets(raw.presets),
    keepTerms: asBool(raw.keepTerms, base.keepTerms),
    keepCode: asBool(raw.keepCode, base.keepCode),
    showNotes: asBool(raw.showNotes, base.showNotes),
    allowExtra: asBool(raw.allowExtra, base.allowExtra),
    extra: asText(raw.extra, EXTRA_MAX),
  }
  const ids = new Set(config.presets.map((preset) => preset.id))
  const wanted = typeof raw.presetId === 'string' ? raw.presetId : ''
  config.presetId = wanted === DEFAULT_PRESET_ID || ids.has(wanted) ? wanted : DEFAULT_PRESET_ID
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
  const raw = `${JSON.stringify(config, null, 2)}\n`
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

/** 恢复默认：等同于删掉配置。 */
export function resetConfig() {
  return write(defaults())
}

/** 内置 + 自定义，顺序固定：默认永远第一。 */
export function presetsOf(config) {
  const list = BUILTIN_PRESETS.map((preset) => ({ ...preset }))
  for (const preset of config?.presets ?? []) list.push({ ...preset, builtin: false })
  return list
}

export function presetName(preset, zh) {
  if (preset === undefined || preset === null) return zh ? '默认' : 'Default'
  if (typeof preset.name === 'string') return preset.name
  const map = preset.name ?? {}
  return (zh ? map.zh : map.en) ?? map.zh ?? map.en ?? ''
}

export function activePreset(config, zh) {
  const list = presetsOf(config)
  return list.find((preset) => preset.id === config?.presetId) ?? list[0]
}

/** 新预设：id 递增、名字带序号，指令留空。 */
export function newPreset(config, zh) {
  const used = new Set(presetsOf(config).map((preset) => preset.id))
  let index = 1
  let id = ''
  do {
    id = `p${index}`
    index += 1
  } while (used.has(id) && index <= MAX_PRESETS + 1)
  const n = (config?.presets?.length ?? 0) + 1
  return { id, name: zh ? `预设 ${n}` : `Preset ${n}`, instruction: '' }
}

/**
 * 交给改写核心的选项：档位、保留开关、命中预设的指令、附加指令。
 * 什么都没配时返回的对象让 polish.js 走原路径（提示词逐字不变）。
 */
export function polishOptions(config, zh) {
  const preset = activePreset(config, zh)
  const instruction = typeof preset?.instruction === 'string' ? preset.instruction.trim() : ''
  const extra = config?.allowExtra === false ? '' : String(config?.extra ?? '').trim()
  return {
    length: LENGTHS.includes(config?.length) ? config.length : DEFAULT_LENGTH,
    keepTerms: config?.keepTerms !== false,
    keepCode: config?.keepCode !== false,
    preset: instruction === '' ? undefined : { name: presetName(preset, zh), instruction },
    extra: extra === '' ? undefined : extra,
  }
}
