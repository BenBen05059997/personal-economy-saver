// codex-call.mjs — call a model through the Codex CLI and get schema-checked JSON back.
// No API key: the call runs on the ChatGPT login the Codex CLI already holds (`codex login`).
// Verified with codex-cli 0.166.0 on macOS, Node 22. No dependencies.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Features switched off so the model only answers: no shell, no browser, no plugins, no sub-agents.
// These names are from codex-cli 0.166.0. If another version rejects a name, remove that name.
const DISABLED = [
  'shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins', 'remote_plugin', 'browser_use',
  'browser_use_external', 'browser_use_full_cdp_access', 'in_app_browser', 'computer_use', 'multi_agent',
  'hooks', 'image_generation', 'skill_search', 'skill_mcp_dependency_install', 'shell_snapshot',
  'sleep_tool', 'tool_suggest', 'worktrees',
]

export function buildArgs({ model, tmp, schemaPath, webSearch = false, effort = 'low', images = [] }) {
  const args = [
    'exec',
    ...images.flatMap((file) => ['-i', file]), // attached images; -i is variadic, so a flag must follow
    '-m', model,
    '--ephemeral',              // nothing saved to the Codex session history
    '--skip-git-repo-check',    // the working folder is a temp folder, not a repo
    '-s', 'read-only',          // sandbox: the model cannot write files
    '--ignore-user-config',     // your personal ~/.codex/config.toml does not change the test
    '-C', tmp,                  // run inside an empty temp folder: the model sees none of your files
    '--json',                   // events on stdout, one JSON object per line
    '-o', join(tmp, 'last-message.txt'), // the final answer is written here
    '-c', `model_reasoning_effort="${effort}"`,
    '-c', `web_search="${webSearch ? 'live' : 'disabled'}"`,
  ]
  for (const feature of DISABLED) args.push('--disable', feature)
  if (!webSearch) args.push('--disable', 'code_mode_host')
  args.push('--output-schema', schemaPath)
  return args
}

// Returns { ok: true, text, json, usage, durationMs } or { ok: false, failure, detail, stderrTail, durationMs }.
export async function codexCall({ model, instructions, input, outputSchema, webSearch = false, effort = 'low', timeoutMs = 300000, images = [] }) {
  if (!model || !outputSchema) throw new Error('codexCall: model and outputSchema are required')
  const tmp = await mkdtemp(join(tmpdir(), 'codex-call-'))
  try {
    const schemaPath = join(tmp, 'schema.json')
    await writeFile(schemaPath, JSON.stringify(outputSchema))
    const args = buildArgs({ model, tmp, schemaPath, webSearch, effort, images })
    const started = Date.now()
    const run = await new Promise((resolve) => {
      const child = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('error', (error) => { clearTimeout(timer); resolve({ stdout, stderr: `${stderr}\nspawn error: ${error.message}`, exitCode: -1, timedOut }) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? -1, timedOut }) })
      child.stdin.on('error', () => {})
      child.stdin.end(`${instructions}\n\n${input}`) // the prompt goes in on stdin
    })
    const durationMs = Date.now() - started
    const events = run.stdout.split('\n').filter((line) => line.trim()).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
    const errors = events.flatMap((e) => (e?.type === 'turn.failed' && e.error?.message ? [e.error.message] : e?.type === 'error' && e.message ? [e.message] : []))
    const fail = (failure) => ({ ok: false, failure, detail: [...new Set(errors)].join(' | ') || null, stderrTail: run.stderr.slice(-2000), durationMs })
    if (run.timedOut) return fail('codex_timeout')
    if (run.exitCode !== 0) return fail(`codex_exit_${run.exitCode}`)
    let text
    try { text = await readFile(join(tmp, 'last-message.txt'), 'utf8') } catch { return fail('codex_no_last_message') }
    let json = null
    try { json = JSON.parse(text) } catch { /* text stays; json stays null */ }
    const usage = events.findLast((e) => e?.type === 'turn.completed')?.usage ?? null
    return { ok: true, text, json, usage, durationMs }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// Run this file directly for a smoke test:  node codex-call.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await codexCall({
    model: process.env.CODEX_MODEL ?? 'gpt-6-luna',
    instructions: 'Answer in the JSON shape given. Be brief.',
    input: 'What is 17 + 25? Also name the capital of Japan.',
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sum', 'capital'],
      properties: { sum: { type: 'integer' }, capital: { type: 'string' } },
    },
  })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
