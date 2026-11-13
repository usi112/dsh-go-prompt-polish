// Self-test: the confirm-page flow (capsule → panel → replace/cancel), echo
// stripping, route resolution, local fallback and bridge effect shapes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply } from '../lib/index.js'
import { buildLocalPrompt, collectContext, resolveRoute, stripEcho } from '../lib/polish.js'

let checks = 0
const ok = (value, message) => { assert.ok(value, message); checks += 1 }
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1 }

const DRAFT = '帮我写个周报，要包括这周做的事和下周三件事。语气正式一点！'
const REWRITE = '请写一份正式周报：先列本周完成的三到五件事，再列下周计划的三到五件事；用简洁的书面中文，分小节呈现。'

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

function fakeCtx({ route = { provider: 'p', model: 'm' }, text = REWRITE, log = [] } = {}) {
  const services = {
    agents: { get: () => ({ model: { current: () => route } }) },
    sessions: { get: () => ({ log }) },
    agentDefaultModel: { currentSelection: () => route },
    llm: {
      prepareCall: async (config) => ({
        config: { ...config, reasoningEffort: 'off' },
        stream: async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          for (const chunk of text.match(/[\s\S]{1,9}/g) ?? []) yield { type: 'text-delta', index: 0, text: chunk }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }),
    },
  }
  return { get: (name) => services[name] }
}

/** Boot the plugin and capture the capsule handler plus the panel definition. */
function boot(ctx) {
  const reg = {}
  apply({
    get: ctx.get,
    inject: (_deps, run) => run({
      get: ctx.get,
      dshGo: {
        on: (_id, fn) => { reg.handler = fn },
        panel: (id, def) => { reg.panelId = id; reg.panel = def },
      },
    }),
  })
  return reg
}

/** Subscribe to the confirm page and collect what it pushes. */
function subscribe(reg, sessionId = 's1') {
  const seen = []
  const dispose = reg.panel.data({ sessionId }, (value) => seen.push(value), { locale: 'zh-CN' })
  return { seen, last: () => seen[seen.length - 1], dispose }
}

// ── local fallback / echo handling (unchanged core) ────────────────────────
eq(buildLocalPrompt('   '), '')
ok(buildLocalPrompt(DRAFT).startsWith('写个周报'), 'filler opener is stripped')
eq(buildLocalPrompt('- 第一项\n- 第二项'), '- 第一项\n- 第二项', 'structured drafts stay untouched')
eq(stripEcho(DRAFT, DRAFT), '', 'a pure echo is rejected so the caller retries')
ok(stripEcho(DRAFT, `${DRAFT}\n\n${REWRITE}`).startsWith('请写一份正式周报'), 'a restated draft is cut from the head')
eq(stripEcho(DRAFT, REWRITE), REWRITE, 'a clean rewrite is left alone')

// ── route / context ────────────────────────────────────────────────────────
eq(resolveRoute(fakeCtx(), 's1'), { provider: 'p', model: 'm' })
eq(resolveRoute({ get: () => undefined }, 's1'), undefined, 'no services means no route')
const log = [
  { type: 'user/message', data: { content: [{ type: 'text', text: '上一轮的问题' }] } },
  { type: 'request/header', data: { header: { config: { provider: 'x', model: 'y' } } } },
]
eq(
  resolveRoute({ get: (name) => (name === 'sessions' ? { get: () => ({ log }) } : undefined) }, 's1'),
  { provider: 'x', model: 'y' },
  'logged request header is the second route source',
)
ok(/用户：上一轮的问题/.test(collectContext(fakeCtx({ log }), 's1')), 'context keeps the user turn')

// ── capsule: guard rails, then open the confirm page ───────────────────────
const offline = boot({ get: () => undefined })
eq(offline.handler({ draft: '  ' }, { locale: 'zh-CN' }), { toast: '输入框里还没有内容' })
eq(offline.handler({ draft: '嗯' }, { locale: 'zh-CN' }), { toast: '先写几个字，我才好优化' })

const open = offline.handler({ draft: DRAFT, sessionId: 's1' }, { locale: 'zh-CN' })
eq(open, { open: 'panel:polish-panel' }, 'the capsule only opens the confirm page')
eq(offline.panelId, 'polish-panel')

// ── confirm page: loading → ready → cancel leaves the composer alone ───────
const page = subscribe(offline)
ok(page.last().original === DRAFT, 'the page carries the original draft')
eq(page.last().hint, '模型没响应，这是本地整理稿 · 复制后全选粘贴可整体替换', 'without a model the local result is ready at once')
ok(page.last().optimized.startsWith('写个周报'), 'local tightening is previewed')
eq(page.seen.at(-1).optimizedLabel, '优化稿')

const cancelled = offline.panel.actions.cancel({ sessionId: 's1' }, { locale: 'zh-CN' })
eq(cancelled, { toast: '已取消，输入框没动' })
ok(cancelled.insert === undefined && cancelled.copy === undefined, 'cancel never touches the composer')

// ── confirm page: copy replaces via the clipboard, append is explicit ──────
const copied = offline.panel.actions.copy({ sessionId: 's1' }, { locale: 'zh-CN' })
eq(copied.copy, page.last().optimized)
ok(copied.insert === undefined, 'copy never writes into the draft')
eq(copied.toast, '已复制优化稿 · 长按输入框 → 全选 → 粘贴')
eq(page.last().hint, '已复制优化稿 · 长按输入框 → 全选 → 粘贴')

const appended = offline.panel.actions.append({ sessionId: 's1' }, { locale: 'zh-CN' })
ok(appended.insert.startsWith('写个周报'), 'append writes the polished prompt')
eq(appended.toast, '已追加到输入框末尾，原草稿仍在前面')
eq(offline.panel.actions.copy({ sessionId: 'nope' }, { locale: 'zh-CN' }), { toast: '还没有可用的优化稿' })

// ── model route: preview is the model rewrite ──────────────────────────────
const online = boot(fakeCtx())
online.handler({ draft: DRAFT, sessionId: 's2' }, { locale: 'zh-CN' })
const modelPage = subscribe(online, 's2')
eq(modelPage.last().hint, '正在优化…', 'the page opens in a loading state')
await settle()
eq(modelPage.last().optimized, REWRITE)
eq(modelPage.last().hint, '模型改写完成 · App 只能追加：复制后全选粘贴才能整体替换')
const modelCopy = online.panel.actions.copy({ sessionId: 's2' }, { locale: 'zh-CN' })
eq(modelCopy.copy, REWRITE)

// ── a failing model still fills the page with the local result ─────────────
const broken = boot({
  get: (name) => (name === 'llm'
    ? { prepareCall: async () => { throw new Error('boom') } }
    : name === 'agents'
      ? { get: () => ({ model: { current: () => ({ provider: 'p', model: 'm' }) } }) }
      : undefined),
})
broken.handler({ draft: DRAFT, sessionId: 's3' }, { locale: 'zh-CN' })
const brokenPage = subscribe(broken, 's3')
await settle()
ok(brokenPage.last().optimized.startsWith('写个周报'), 'model failure still previews a usable result')

// ── bridge effect validation ───────────────────────────────────────────────
const bridge = '/opt/dsh-go/dsh-go-bridge/lib/native/effects.js'
const { existsSync } = await import('node:fs')
if (existsSync(bridge)) {
  const { expand, validate } = await import(bridge)
  const check = (result) => (expand(result) ?? []).map((effect) => {
    const verdict = validate(effect, { panels: new Set(['polish-panel']) })
    ok(verdict.issue === undefined, `bridge accepts ${effect.type}: ${JSON.stringify(verdict.issue)}`)
    return verdict.effect.type
  })
  eq(check(open), ['open'])
  eq(check(copied), ['copy', 'toast'])
  eq(check(appended), ['insert', 'toast'])
  eq(check(cancelled), ['toast'])
}

// ── manifest limits ────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const action = pkg.dshGo.contributes['composer.actions'][0]
const panel = pkg.dshGo.contributes.panels[0]
eq(action.id, 'polish')
eq(panel.id, 'polish-panel')
ok(action.label.zh.length <= 10 && panel.title.zh.length <= 16, 'capsule and panel titles fit')
eq(pkg.dshGo.wants, ['draft'])
ok(!('message.actions' in pkg.dshGo.contributes), 'no leftover probe contributions')

console.log(`selftest: ${checks} assertions passed`)
