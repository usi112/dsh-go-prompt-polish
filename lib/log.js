// 诊断日志：插件目录下 .log.jsonl，追加写，超过 64 KiB 先清空。
// 只记状态和长度，不记草稿、优化稿、预设名或附加指令正文。
// 路径可用 PROMPT_POLISH_LOG 覆盖（绝对路径、不含 `..`），自测因此不会写进真实插件目录。
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const LOG_LIMIT = 64 * 1024
const DEFAULT_FILE = fileURLToPath(new URL('../.log.jsonl', import.meta.url))

function logFile() {
  const override = process.env.PROMPT_POLISH_LOG
  if (typeof override === 'string' && override.startsWith('/') && !override.split('/').includes('..')) return override
  return DEFAULT_FILE
}

export function log(entry) {
  const file = logFile()
  try {
    try {
      if (statSync(file).size > LOG_LIMIT) writeFileSync(file, '')
    } catch {
      /* first write */
    }
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch {
    /* diagnostics must never break a tap */
  }
}
