// codex-bridge.mjs: a local OpenAI-compatible server (POST /v1/chat/completions) that answers by running `codex exec`.
// Dev and test only. The app never imports this file. Prompts go to OpenAI through the owner's ChatGPT login (the Codex CLI
// login, no API key), so use fictional data only. Reads images, not PDFs. Codex adds its own system prompt, so this is a
// rehearsal: do the final check on a real API.
// Settings: CODEX_BRIDGE_PORT (3130), CODEX_EFFORT (low), CODEX_TIMEOUT_MS (60000). Binds to 127.0.0.1 only.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexCall } from './codex-call.mjs'

const MAX_BODY = 25 * 1024 * 1024
const MAX_PARALLEL = 2

// Queue: at most MAX_PARALLEL Codex calls at once.
let running = 0
const waiting = []
async function slot(fn) {
  if (running >= MAX_PARALLEL) await new Promise((resolve) => waiting.push(resolve))
  running++
  try { return await fn() } finally { running--; waiting.shift()?.() }
}

class BadRequest extends Error {}

const text = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((p) => (p?.type === 'text' ? p.text : '')).join('') : v == null ? '' : JSON.stringify(v))

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

// Turns the conversation into { instructions, input, imageFiles }. Images are decoded into `dir`.
async function render(body, dir) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const tools = Array.isArray(body.tools) ? body.tools.map((t) => t.function ?? t).filter((f) => f?.name) : []
  const system = messages.filter((m) => m.role === 'system' || m.role === 'developer').map((m) => text(m.content)).join('\n\n')
  const images = []
  const lines = []
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') continue
    if (m.role === 'tool') { lines.push(`[tool result for call ${m.tool_call_id}]\n${text(m.content)}`); continue }
    let out = ''
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part?.type === 'text') out += part.text
        else if (part?.type === 'image_url') {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url
          const match = /^data:([^;,]+);base64,(.*)$/s.exec(url ?? '')
          if (!match) throw new BadRequest('The Codex bridge reads images sent as data URLs only.')
          const file = join(dir, `image-${images.length + 1}.${EXT[match[1]] ?? 'png'}`)
          await writeFile(file, Buffer.from(match[2], 'base64'))
          images.push(file)
          out += `[image ${images.length} attached]`
        } else if (part?.type === 'file') throw new BadRequest('The Codex bridge reads images only, not PDFs.')
      }
    } else out = text(m.content)
    if (m.role === 'assistant') {
      for (const c of m.tool_calls ?? []) out += `\n[assistant called tool ${c.function?.name} (call ${c.id}) with arguments ${c.function?.arguments}]`
      lines.push(`ASSISTANT: ${out.trim()}`)
    } else lines.push(`USER: ${out.trim()}`)
  }

  const forced = body.tool_choice?.function?.name
  const parts = [system]
  if (tools.length) {
    parts.push([
      'You can call tools. Available tools (name, description, JSON schema of the arguments):',
      ...tools.map((t) => `- ${t.name}: ${t.description ?? ''}\n  parameters: ${JSON.stringify(t.parameters ?? {})}`),
      'Answer with a JSON object { reply, tool_calls }. Either answer in "reply" and leave "tool_calls" empty, or call tools by listing them in "tool_calls" and leave "reply" an empty string.',
      'Each tool call is { name, arguments_json }: name is one of the tools above and arguments_json is a JSON string that matches that tool\'s parameters schema.',
      forced ? `You must call exactly one tool: ${forced}. Do not answer in "reply".` : body.tool_choice === 'required' ? 'You must call at least one tool.' : '',
    ].filter(Boolean).join('\n'))
  } else parts.push('Answer with a JSON object { reply } holding your answer.')
  parts.push('The conversation so far follows. Write the next assistant turn.')
  return { instructions: parts.filter(Boolean).join('\n\n'), input: lines.join('\n\n'), images, tools, forced }
}

function schemaFor(hasTools) {
  const reply = { type: 'string' }
  if (!hasTools) return { type: 'object', additionalProperties: false, required: ['reply'], properties: { reply } }
  return {
    type: 'object', additionalProperties: false, required: ['reply', 'tool_calls'],
    properties: {
      reply,
      tool_calls: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['name', 'arguments_json'], properties: { name: { type: 'string' }, arguments_json: { type: 'string' } } },
      },
    },
  }
}

function send(res, status, body) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json' })
  res.end(data)
}
const fail = (res, status, message, type = 'invalid_request_error') => send(res, status, { error: { message, type } })

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new BadRequest('The request is too large for the Codex bridge.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function handleChat(req, res) {
  const started = Date.now()
  const time = new Date().toISOString().slice(11, 19)
  let model = '?', toolCount = 0, imageCount = 0, result = 'error'
  const dir = await mkdtemp(join(tmpdir(), 'codex-bridge-'))
  try {
    let body
    try { body = JSON.parse(await readBody(req)) } catch (e) {
      if (e instanceof BadRequest) throw e
      throw new BadRequest('The request body is not valid JSON.')
    }
    model = String(body.model ?? '')
    if (!model) throw new BadRequest('"model" is required.')
    const { instructions, input, images, tools, forced } = await render(body, dir)
    toolCount = tools.length
    imageCount = images.length
    if (forced && !tools.some((t) => t.name === forced)) throw new BadRequest(`tool_choice names an unknown tool: ${forced}.`)

    const r = await slot(() => codexCall({
      model, instructions, input, images, outputSchema: schemaFor(tools.length > 0),
      effort: process.env.CODEX_EFFORT || 'low', timeoutMs: Number(process.env.CODEX_TIMEOUT_MS) || 60000,
    }))
    if (!r.ok) {
      result = `error ${r.failure}`
      return fail(res, 502, `Codex failed: ${r.failure}${r.detail ? ` (${r.detail})` : ''}`, 'codex_error')
    }
    if (!r.json || typeof r.json.reply !== 'string') {
      result = 'error unreadable'
      return fail(res, 502, 'Codex failed: codex_unreadable_answer', 'codex_error')
    }
    const names = new Set(tools.map((t) => t.name))
    const calls = (Array.isArray(r.json.tool_calls) ? r.json.tool_calls : []).flatMap((c) => {
      if (!names.has(c?.name) || typeof c.arguments_json !== 'string') return []
      try { JSON.parse(c.arguments_json) } catch { return [] }
      return [{ id: `call_${randomUUID()}`, type: 'function', function: { name: c.name, arguments: c.arguments_json } }]
    })
    result = calls.length ? `${calls.length} tool calls` : 'answer'
    const message = { role: 'assistant', content: r.json.reply || null }
    if (calls.length) message.tool_calls = calls
    return send(res, 200, {
      id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: r.usage?.input_tokens ?? 0, completion_tokens: r.usage?.output_tokens ?? 0, total_tokens: (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0) },
    })
  } catch (e) {
    if (e instanceof BadRequest) { result = `error 400`; return fail(res, 400, e.message) }
    result = 'error internal'
    return fail(res, 500, 'The Codex bridge failed.', 'server_error')
  } finally {
    await rm(dir, { recursive: true, force: true })
    console.log(`${time} model=${model} tools=${toolCount} images=${imageCount} ${result} ${Date.now() - started}ms`)
  }
}

export function startBridge({ port = Number(process.env.CODEX_BRIDGE_PORT) || 3130 } = {}) {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/') return send(res, 200, `Codex bridge running on port ${server.address().port}`)
    if (req.method === 'POST' && path === '/v1/chat/completions') return void handleChat(req, res)
    return fail(res, 404, 'Not found.')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startBridge()
  console.log(`Codex bridge listening on http://127.0.0.1:${server.address().port}/v1 (dev and test only)`)
}
