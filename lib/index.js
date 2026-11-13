// local-prompt-polish — 确认式提示词优化（1.4.0）。
//
// 1.4.0 在 1.3.0 的确认页之外加了设置页（lib/settings.js）和配置文件
// （.config.json，读写在 lib/config.js）。胶囊点按时先读配置：停用就只提示并
// 打开设置页；档位、预设、保留开关都只影响这次改写用到的提示词与截断长度，
// 什么都不配时行为和 1.3.0 完全一致。
//
// 胶囊点按只做两件事：起一个优化任务、打开确认页。确认页完整展示优化稿，
// 三个按钮：
//   • 复制优化稿   —— copy；输入框长按全选后粘贴 = 整体替换（不动原文，不会拼接）
//   • 追加到输入框 —— insert；App 的 insert 是「合并进草稿」，原文会留在前面
//   • 取消         —— 什么都不做
//
// 为什么默认不是「直接替换」：dsh-go 原生插件的 effect 只有 insert / copy /
// toast / command / open / link / refresh / patch，没有清空或替换草稿的能力；
// App 端把 insert 实现成 insertIntoComposer（合并），所以插件无法删掉用户已经
// 输入的文字。整体替换只能走「复制 + 全选粘贴」，这一步是用户的手势。
import { activePreset, loadConfig, polishOptions, presetName } from './config.js'
import { log } from './log.js'
import { buildLocalPrompt, isChinese, requestPolish, resolveRoute } from './polish.js'
import { SETTINGS_PANEL, applySettings } from './settings.js'

export const name = 'local-prompt-polish'

const ACTION = 'polish'
const PANEL = 'polish-panel'
const MIN_DRAFT = 4
const JOB_TIMEOUT_MS = 45_000

const T = {
  zh: {
    empty: '输入框里还没有内容',
    short: '先写几个字，我才好优化',
    loading: '正在优化…',
    modelReady: '模型改写完成 · App 只能追加：复制后全选粘贴才能整体替换',
    localReady: '模型没响应，这是本地整理稿 · 复制后全选粘贴可整体替换',
    timeout: '模型超时，这是本地整理稿 · 复制后全选粘贴可整体替换',
    noJob: '先在输入框写好草稿，再点上方的「优化提示词」',
    copied: '已复制优化稿 · 长按输入框 → 全选 → 粘贴',
    appended: '已追加到输入框末尾，原草稿仍在前面',
    nothing: '还没有可用的优化稿',
    cancelled: '已取消，输入框没动',
    original: '原文',
    optimized: '优化稿',
    copy: '复制优化稿',
    append: '追加到输入框',
    cancel: '取消',
    retry: '再来一版',
    retrying: '正在重新优化…',
    retryEmpty: '还没有可重做的草稿',
    disabled: '「优化提示词」已在设置里停用 · 打开设置可重新启用',
    notesLabel: '改写说明',
    notesLoading: '正在改写，完成后显示来源、档位、预设与字数变化',
    sourceModel: '模型改写',
    sourceLocal: '本地整理',
    keepOn: '保留',
    keepOff: '可改写',
    lengthNames: { detailed: '详细', medium: '中等', simple: '简易' },
    hintSource: '来源',
    hintLength: '档位',
    hintPreset: '预设',
    hintTerms: '专有名词',
    hintCode: '代码与路径',
    hintChars: '字数',
  },
  en: {
    empty: 'The input box is empty',
    short: 'Write a bit more first',
    loading: 'Polishing…',
    modelReady: 'Model rewrite ready · this app only appends: copy, select all, paste to replace',
    localReady: 'Model unavailable — local tightening · copy, select all, paste to replace',
    timeout: 'Model timed out — local tightening · copy, select all, paste to replace',
    noJob: 'Write a draft first, then tap Polish above the input box',
    copied: 'Copied — select all, then paste',
    appended: 'Appended; the old draft stays in front',
    nothing: 'No polished prompt yet',
    cancelled: 'Cancelled — the input box is untouched',
    original: 'Draft',
    optimized: 'Polished',
    copy: 'Copy polished',
    append: 'Append to input box',
    cancel: 'Cancel',
    retry: 'Re-run',
    retrying: 'Re-running…',
    retryEmpty: 'Nothing to re-run yet',
    disabled: 'Polishing is off — opening settings',
    notesLabel: 'Rewrite notes',
    notesLoading: 'Rewriting — source, tier, preset and size appear when done',
    sourceModel: 'model rewrite',
    sourceLocal: 'local tidy-up',
    keepOn: 'keep',
    keepOff: 'may rewrite',
    lengthNames: { detailed: 'detailed', medium: 'medium', simple: 'short' },
    hintSource: 'source',
    hintLength: 'length',
    hintPreset: 'preset',
    hintTerms: 'proper nouns',
    hintCode: 'code and paths',
    hintChars: 'chars',
  },
}

/** sessionId -> the running/finished optimization for that composer. */
const jobs = new Map()
/** sessionId -> live confirm-page emitters. */
const subs = new Map()
let jobSeq = 0

const dict = (zh) => (zh ? T.zh : T.en)
const sessionKey = (scope) => (typeof scope?.sessionId === 'string' ? scope.sessionId : '')
const isZh = (locale) => !String(locale ?? '').startsWith('en')

/**
 * 改写说明（设置里 showNotes 打开时才显示）：来源、档位、预设、保留开关、
 * 字数变化。全部来自内存里的 job 和配置文件，不额外调模型。
 */
function notesFor(job, zh) {
  const t = dict(zh)
  const options = job.options
  const tier = t.lengthNames[options?.length] ?? t.lengthNames.medium
  const keep = (value) => (value ? t.keepOn : t.keepOff)
  const sourceLabel = job.source === 'model' ? t.sourceModel : t.sourceLocal
  const parts = [
    `${t.hintSource}：${sourceLabel}`,
    `${t.hintLength}：${tier}`,
    `${t.hintPreset}：${job.presetLabel}`,
    `${t.hintTerms}：${keep(options?.keepTerms !== false)}`,
    `${t.hintCode}：${keep(options?.keepCode !== false)}`,
    `${t.hintChars}：${job.original.length} → ${job.optimized.length}`,
  ]
  return parts.join(' · ')
}

function snapshot(key, zh) {
  const t = dict(zh)
  const config = loadConfig()
  const base = { originalLabel: t.original, optimizedLabel: t.optimized }
  const job = jobs.get(key)
  const notes = (value) => (config.showNotes ? notesFor(value, zh) : '')
  if (!job) return { ...base, hint: t.noJob, original: '—', optimized: '—', notes: '' }
  if (job.state === 'loading') {
    return { ...base, hint: t.loading, original: job.original, optimized: '…', notes: config.showNotes ? t.notesLoading : '' }
  }
  const hint = job.state === 'copied'
    ? t.copied
    : job.state === 'appended'
      ? t.appended
      : job.timedOut ? t.timeout
        : job.source === 'model' ? t.modelReady : t.localReady
  return { ...base, hint, original: job.original, optimized: job.optimized, notes: notes(job) }
}

function notify(key) {
  const set = subs.get(key)
  if (set === undefined) return
  for (const push of [...set]) {
    try {
      push(snapshot(key, jobs.get(key)?.zh ?? true))
    } catch {
      set.delete(push)
    }
  }
}

function canUseModel(ctx, sessionId) {
  try {
    return resolveRoute(ctx, sessionId) !== undefined && ctx.get('llm') !== undefined
  } catch {
    return false
  }
}

function startJob(ctx, key, text, sessionId) {
  const id = ++jobSeq
  const zh = isChinese(text)
  const config = loadConfig()
  const options = polishOptions(config, zh)
  const presetLabel = presetName(activePreset(config, zh), zh)
  jobs.set(key, { id, state: 'loading', original: text, optimized: '', source: 'local', timedOut: false, zh, options, presetLabel })
  notify(key)
  void (async () => {
    let output = buildLocalPrompt(text, options)
    let source = 'local'
    let timedOut = false
    const controller = new AbortController()
    try {
      if (options.model !== undefined || canUseModel(ctx, sessionId)) {
        // 有的适配器不理会 AbortSignal，光靠 signal 会一直挂在「正在优化…」；
        // 这里再和一根硬计时器赛跑，超时就用本地整理稿。
        let timer
        const hardStop = new Promise((resolve) => {
          timer = setTimeout(() => {
            timedOut = true
            try {
              controller.abort()
            } catch {
              /* ignore */
            }
            resolve(undefined)
          }, JOB_TIMEOUT_MS)
          timer.unref?.()
        })
        try {
          const improved = await Promise.race([
            requestPolish(ctx, { text, sessionId, signal: controller.signal, zh, options }),
            hardStop,
          ])
          if (typeof improved === 'string' && improved.trim() !== '') {
            output = improved
            source = 'model'
          }
        } finally {
          clearTimeout(timer)
        }
      }
    } catch {
      /* keep the local tightening */
    }
    const current = jobs.get(key)
    if (current === undefined || current.id !== id) return
    jobs.set(key, { ...current, state: 'ready', optimized: output, source, timedOut })
    notify(key)
    log({ event: 'ready', source, length: options.length, preset: options.preset === undefined ? '' : 'set', extra: options.extra !== undefined, model: options.model === undefined ? '' : 'fixed', draftLen: text.length, outLen: output.length })
  })()
}

function panelView(scope, caps) {
  const zh = !String(caps?.locale ?? '').startsWith('en')
  const t = dict(zh)
  const { showNotes } = loadConfig()
  return {
    type: 'stack',
    title: t.optimized,
    children: [
      { type: 'text', text: { $: 'data.hint' }, tone: 'muted' },
      { type: 'text', text: { $: 'data.originalLabel' }, tone: 'muted' },
      { type: 'text', text: { $: 'data.original' } },
      { type: 'text', text: { $: 'data.optimizedLabel' }, tone: 'muted' },
      { type: 'text', text: { $: 'data.optimized' } },
      ...(showNotes
        ? [{ type: 'text', text: t.notesLabel, tone: 'muted' }, { type: 'text', text: { $: 'data.notes' } }]
        : []),
      {
        type: 'actions',
        items: [
          { label: t.copy, action: 'copy', style: 'primary' },
          { label: t.append, action: 'append' },
          { label: t.retry, action: 'retry', icon: 'refresh' },
          { label: t.cancel, action: 'cancel' },
        ],
      },
    ],
  }
}

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.on(ACTION, (scope, event) => {
      const zh = isZh(event?.locale)
      const t = dict(zh)
      const config = loadConfig()
      if (!config.enabled) {
        log({ event: 'disabled' })
        return { open: `panel:${SETTINGS_PANEL}`, toast: t.disabled }
      }
      const key = sessionKey(scope)
      const draft = typeof scope?.draft === 'string' ? scope.draft : ''
      const text = draft.replace(/\r\n/g, '\n').trim()

      if (text === '') {
        log({ event: 'empty-draft' })
        return { toast: t.empty }
      }
      if (text.length < MIN_DRAFT) {
        log({ event: 'short-draft', draftLen: text.length })
        return { toast: t.short }
      }

      startJob(ctx, key, text, scope?.sessionId)
      log({ event: 'open-confirm', draftLen: text.length })
      return { open: `panel:${PANEL}` }
    })

    applySettings(ctx)

    ctx.dshGo.panel(PANEL, {
      view: panelView,
      data: (scope, emit, caps) => {
        const key = sessionKey(scope)
        const zh = !String(caps?.locale ?? '').startsWith('en')
        const push = (value) => emit(value)
        push(snapshot(key, zh))
        let set = subs.get(key)
        if (set === undefined) {
          set = new Set()
          subs.set(key, set)
        }
        set.add(push)
        return () => {
          set.delete(push)
        }
      },
      actions: {
        copy: (scope, event) => {
          const t = dict(isZh(event?.locale))
          const key = sessionKey(scope)
          const job = jobs.get(key)
          if (job === undefined || job.state === 'loading' || job.optimized === '') {
            log({ event: 'copy-without-draft' })
            return { toast: t.nothing }
          }
          jobs.set(key, { ...job, state: 'copied' })
          notify(key)
          log({ event: 'copy', outLen: job.optimized.length })
          return { copy: job.optimized, toast: t.copied }
        },
        append: (scope, event) => {
          const t = dict(isZh(event?.locale))
          const key = sessionKey(scope)
          const job = jobs.get(key)
          if (job === undefined || job.state === 'loading' || job.optimized === '') {
            log({ event: 'append-without-draft' })
            return { toast: t.nothing }
          }
          jobs.set(key, { ...job, state: 'appended' })
          notify(key)
          log({ event: 'append', outLen: job.optimized.length })
          return { insert: job.optimized, toast: t.appended }
        },
        retry: (scope, event) => {
          const t = dict(isZh(event?.locale))
          const key = sessionKey(scope)
          const job = jobs.get(key)
          if (job === undefined || job.original === '') {
            log({ event: 'retry-without-draft' })
            return { toast: t.retryEmpty }
          }
          if (job.state === 'loading') return { toast: t.retrying }
          startJob(ctx, key, job.original, scope?.sessionId)
          log({ event: 'retry', draftLen: job.original.length })
          return { toast: t.retrying }
        },
        cancel: (_scope, event) => {
          const t = dict(isZh(event?.locale))
          log({ event: 'cancel' })
          return { toast: t.cancelled }
        },
      },
    })
  })
}
