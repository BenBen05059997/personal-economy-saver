// Real calls through the Codex bridge, shaped as src/lib/ai/openai.ts sends them. Dev only; needs `codex login`.
// Run: node scripts/codex-bridge-check.mjs   (model: CODEX_MODEL, default gpt-6-luna)
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startBridge } from './codex-bridge.mjs'

const MODEL = process.env.CODEX_MODEL || 'gpt-6-luna'
const server = await startBridge({ port: 0 })
const base = `http://127.0.0.1:${server.address().port}/v1`

const tools = [
  { type: 'function', function: { name: 'get_balance', description: 'Returns the current cash balance of the household in minor units.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'add_bill', description: 'Drafts a new monthly bill.', parameters: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'integer', description: 'yen' } }, required: ['name', 'amount'] } } },
]

async function chat(body) {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer codex-local' },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, ...body }),
  })
  return { status: response.status, json: await response.json() }
}
const sys = { role: 'system', content: 'You are a careful assistant for a household money app. Be brief.' }
const msg = (r) => r.json.choices?.[0]?.message
const results = []

async function run(name, fn) {
  const started = Date.now()
  let ok = false, note = ''
  try { note = (await fn()) ?? ''; ok = true } catch (e) { note = e.message }
  const ms = Date.now() - started
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (${ms} ms) ${note}`)
}
const need = (cond, message) => { if (!cond) throw new Error(message) }

await run('a plain question', async () => {
  const r = await chat({ messages: [sys, { role: 'user', content: 'What is the capital of Japan? One word.' }] })
  need(r.status === 200, `status ${r.status} ${JSON.stringify(r.json)}`)
  need(/tokyo/i.test(msg(r).content ?? ''), `content: ${msg(r).content}`)
  need(r.json.choices[0].finish_reason === 'stop', 'finish_reason')
  return msg(r).content
})

let firstCalls
await run('a question that needs a tool', async () => {
  const r = await chat({ tools, messages: [sys, { role: 'user', content: 'What is my cash balance right now?' }] })
  need(r.status === 200, `status ${r.status} ${JSON.stringify(r.json)}`)
  const calls = msg(r).tool_calls
  need(calls?.length >= 1, `no tool call: ${JSON.stringify(msg(r))}`)
  need(calls[0].function.name === 'get_balance', `called ${calls[0].function.name}`)
  JSON.parse(calls[0].function.arguments)
  need(r.json.choices[0].finish_reason === 'tool_calls', 'finish_reason')
  firstCalls = calls
  return `${calls[0].function.name} ${calls[0].function.arguments}`
})

await run('a forced tool_choice', async () => {
  const r = await chat({ tools, tool_choice: { type: 'function', function: { name: 'add_bill' } }, messages: [sys, { role: 'user', content: 'I pay 4,200 yen a month for a gym called Fit Plus.' }] })
  need(r.status === 200, `status ${r.status} ${JSON.stringify(r.json)}`)
  const call = msg(r).tool_calls?.[0]
  need(call?.function.name === 'add_bill', `got ${JSON.stringify(msg(r))}`)
  const args = JSON.parse(call.function.arguments)
  need(typeof args.name === 'string' && Number.isInteger(args.amount), `args ${call.function.arguments}`)
  return call.function.arguments
})

await run('a tool result round trip', async () => {
  const call = firstCalls?.[0] ?? { id: 'call_x', type: 'function', function: { name: 'get_balance', arguments: '{}' } }
  const r = await chat({ tools, messages: [sys, { role: 'user', content: 'What is my cash balance right now?' },
    { role: 'assistant', content: null, tool_calls: [call] },
    { role: 'tool', tool_call_id: call.id, content: '{"balance":123456,"currency":"JPY"}' }] })
  need(r.status === 200, `status ${r.status} ${JSON.stringify(r.json)}`)
  need(/123,?456/.test(msg(r).content ?? ''), `content: ${msg(r).content}`)
  return msg(r).content
})

await run('an image', async () => {
  const png = await readFile(fileURLToPath(new URL('../../design/a.png', import.meta.url)))
  const r = await chat({ messages: [sys, { role: 'user', content: [
    { type: 'text', text: 'Describe this image in one short sentence.' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] }] })
  need(r.status === 200, `status ${r.status} ${JSON.stringify(r.json)}`)
  need((msg(r).content ?? '').length > 10, 'empty answer')
  return msg(r).content.slice(0, 100)
})

await run('a PDF is refused', async () => {
  const r = await chat({ messages: [sys, { role: 'user', content: [
    { type: 'text', text: 'Read this.' },
    { type: 'file', file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } }] }] })
  need(r.status === 400, `status ${r.status}`)
  need(/images only, not PDFs/.test(r.json.error?.message ?? ''), JSON.stringify(r.json))
})

server.close()
console.log(results.every(Boolean) ? 'All cases passed.' : 'Some cases failed.')
process.exit(results.every(Boolean) ? 0 : 1)
