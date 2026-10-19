// Scripted Anthropic-Messages SSE server that makes the session run one PowerShell
// command, then reports what came back. Each tool result is logged to
// dev/.mock-log.jsonl, so a run can be checked without reading the chat.
//   node dev/mock-pwsh.mjs [port]      (default 8766)
// Standard preset: calls `pwsh` directly. PTC preset (only run_code): calls it
// through `tools.pwsh` inside a program.

import http from 'node:http'
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.argv[2] ?? 8766)
const logFile = join(dirname(fileURLToPath(import.meta.url)), '.mock-log.jsonl')
const COMMAND = 'Write-Output "pwsh-ok $($PSVersionTable.PSVersion)"; New-Item -ItemType File -Force sandbox-console-probe.txt | Out-Null; Remove-Item sandbox-console-probe.txt; Write-Output "write-ok"'

const sse = (res, payload) => res.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`)
const blocksOf = (m) => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content)

function lastToolResult(messages) {
  const last = messages.at(-1)
  if (!last || last.role !== 'user') return undefined
  const result = blocksOf(last).find((b) => b.type === 'tool_result')
  if (!result) return undefined
  return typeof result.content === 'string' ? result.content : (result.content ?? []).map((b) => b.text ?? '').join('')
}

function reply(request) {
  const tools = (request.tools ?? []).map((t) => t.name)
  const messages = request.messages ?? []
  if (tools.length === 0) return { text: '模拟会话' }
  const result = lastToolResult(messages)
  if (result !== undefined) return { text: `工具返回：\n${result}` }
  if (tools.includes('pwsh')) return { tool: 'pwsh', input: { command: COMMAND, description: 'Probe PowerShell under the sandbox' } }
  if (tools.includes('run_code')) {
    return { tool: 'run_code', input: { description: '在沙箱里跑 PowerShell', code: `const r = await tools.pwsh({ command: ${JSON.stringify(COMMAND)}, description: 'probe' });\nreturn r;` } }
  }
  return { text: `没有 pwsh 工具：${tools.join(', ')}` }
}

let counter = 0
function respond(res, response) {
  const id = `mock-${++counter}`
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
  sse(res, { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'mock-model', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  if (response.text) {
    sse(res, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: response.text } })
    sse(res, { type: 'content_block_stop', index: 0 })
  } else {
    sse(res, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name: response.tool, input: {} } })
    sse(res, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(response.input) } })
    sse(res, { type: 'content_block_stop', index: 0 })
  }
  sse(res, { type: 'message_delta', delta: { stop_reason: response.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
  sse(res, { type: 'message_stop' })
  res.end()
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.split('?')[0].endsWith('/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"message":"not found"}}')
    return
  }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let request
    try { request = JSON.parse(body) } catch { res.writeHead(400).end(); return }
    const response = reply(request)
    const result = lastToolResult(request.messages ?? [])
    appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), tools: (request.tools ?? []).length, toolResult: result?.slice(0, 400), reply: response.tool ?? 'text' }) + '\n')
    respond(res, response)
  })
}).listen(port, '127.0.0.1', () => console.log(`mock-pwsh listening on http://127.0.0.1:${port}`))
