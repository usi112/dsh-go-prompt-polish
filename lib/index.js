// local-prompt-polish — 确认式提示词优化（1.3.0）。
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
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { buildLocalPrompt, isChinese, requestPolish, resolveRoute } from './polish.js'

export const name = 'local-prompt-polish'

const ACTION = 'polish'
const PANEL = 'polish-panel'
const MIN_DRAFT = 4
const JOB_TIMEOUT_MS = 45_000
const LOG_LIMIT = 64 * 1024
const LOG_FILE = new URL('../.log.jsonl', import.meta.url)

const T = {
  zh: {
    empty: '输入框里还没有内容',
    short: '先写几个字，我才好优化',
    loading: '正在优化…',
    modelReady: '模型改写完成 · App 只能追加：复制后全选粘贴才能整体替换',
    localReady: '模型没响应，这是本地整理稿 · 复制后全选粘贴可整体替换',
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
  },
  en: {
    empty: 'The input box is empty',
    short: 'Write a bit more first',
    loading: 'Polishing…',
    modelReady: 'Model rewrite ready · this app only appends: copy, select all, paste to replace',
    localReady: 'Model unavailable — local tightening · copy, select all, paste to replace',
    noJob: 'Write a draft first, then tap Polish above the input box',
    copied: 'Copied — long-press the input box, select all, then paste',
    appended: 'Appended to the end; the old draft is still in front',
    nothing: 'No polished prompt yet',
    cancelled: 'Cancelled — the input box is untouched',
    original: 'Draft',
    optimized: 'Polished',
    copy: 'Copy polished',
    append: 'Append to input box',
    cancel: 'Cancel',
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

function log(entry) {
  try {
    try {
      if (statSync(LOG_FILE).size > LOG_LIMIT) writeFileSync(LOG_FILE, '')
    } catch {
      /* first write */
    }
    appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch {
    /* diagnostics must never break a tap */
  }
}

function snapshot(key, zh) {
  const t = dict(zh)
  const base = { originalLabel: t.original, optimizedLabel: t.optimized }
  const job = jobs.get(key)
  if (!job) return { ...base, hint: t.noJob, original: '—', optimized: '—' }
  if (job.state === 'loading') return { ...base, hint: t.loading, original: job.original, optimized: '…' }
  const hint = job.state === 'copied'
    ? t.copied
    : job.state === 'appended'
      ? t.appended
      : job.source === 'model' ? t.modelReady : t.localReady
  return { ...base, hint, original: job.original, optimized: job.optimized }
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
  jobs.set(key, { id, state: 'loading', original: text, optimized: '', source: 'local', zh })
  notify(key)
  void (async () => {
    let output = buildLocalPrompt(text)
    let source = 'local'
    try {
      if (canUseModel(ctx, sessionId)) {
        const improved = await requestPolish(ctx, { text, sessionId, signal: AbortSignal.timeout(JOB_TIMEOUT_MS), zh })
        if (typeof improved === 'string' && improved.trim() !== '') {
          output = improved
          source = 'model'
        }
      }
    } catch {
      /* keep the local tightening */
    }
    const current = jobs.get(key)
    if (current === undefined || current.id !== id) return
    jobs.set(key, { ...current, state: 'ready', optimized: output, source })
    notify(key)
    log({ event: 'ready', source, draftLen: text.length, outLen: output.length })
  })()
}

function panelView(scope, caps) {
  const t = dict(!String(caps?.locale ?? '').startsWith('en'))
  return {
    type: 'stack',
    title: t.optimized,
    children: [
      { type: 'text', text: { $: 'data.hint' }, tone: 'muted' },
      { type: 'text', text: { $: 'data.originalLabel' }, tone: 'muted' },
      { type: 'text', text: { $: 'data.original' } },
      { type: 'text', text: { $: 'data.optimizedLabel' }, tone: 'muted' },
      { type: 'text', text: { $: 'data.optimized' } },
      {
        type: 'actions',
        items: [
          { label: t.copy, action: 'copy', style: 'primary' },
          { label: t.append, action: 'append' },
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
        cancel: (_scope, event) => {
          const t = dict(isZh(event?.locale))
          log({ event: 'cancel' })
          return { toast: t.cancelled }
        },
      },
    })
  })
}
