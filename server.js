const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = __dirname
const SEARCH_SCRIPT = path.join(ROOT, 'scripts', 'search_douyin_video_tab.js')
const FILTER_SCRIPT = path.join(ROOT, 'scripts', 'filter_douyin_comment_leads.py')
const UI_DIR = path.join(ROOT, 'ui')
const DATA_DIR = path.join(ROOT, 'data')
const OUTPUT_DIR = path.join(ROOT, 'output')
const PYTHON = process.env.PYTHON_BIN || 'python3'

for (const dir of [DATA_DIR, OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const state = { running: false, log: [], lastResult: null }

function pushLog(line) {
  const entry = `${new Date().toISOString()} ${line}`
  state.log.push(entry)
  if (state.log.length > 500) state.log.shift()
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 2_000_000) {
        reject(new Error('Payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
}

function runCommand(command, args, env, label) {
  return new Promise((resolve, reject) => {
    pushLog(`START ${label}`)
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => pushLog(`${label} ${chunk.toString().trim()}`))
    child.stderr.on('data', (chunk) => pushLog(`${label} ${chunk.toString().trim()}`))
    child.on('error', reject)
    child.on('close', (code) => {
      pushLog(`END ${label} code=${code}`)
      if (code === 0) resolve()
      else reject(new Error(`${label} failed with code ${code}`))
    })
  })
}

async function runPipeline(config) {
  if (state.running) throw new Error('A task is already running')
  const cookie = (config.cookie || '').trim() || process.env.DOUYIN_COOKIE || ''
  if (!cookie) throw new Error('Missing Douyin cookie. Paste one in the UI or set DOUYIN_COOKIE.')

  state.running = true
  state.lastResult = null
  state.log = []
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const searchPath = path.join(DATA_DIR, `search-${stamp}.json`)
    const outputPath = path.join(OUTPUT_DIR, `leads-${stamp}.csv`)
    const now = new Date().toISOString()

    await runCommand(
      'node',
      [SEARCH_SCRIPT],
      {
        DOUYIN_COOKIE: cookie,
        SEARCH_KEYWORDS: config.keywords.join(','),
        SEARCH_OUTPUT: searchPath,
        SEARCH_SCROLL_LOOPS: String(config.scrollLoops || 28),
      },
      'search'
    )

    await runCommand(
      PYTHON,
      [
        FILTER_SCRIPT,
        '--input', searchPath,
        '--output', outputPath,
        '--days', String(config.days),
        '--target', String(config.target),
        '--pages', String(config.pages),
        '--count', String(config.count),
        '--cookie', cookie,
        '--now', now,
        '--extra-name-excludes', (config.extraNameExcludes || []).join(','),
        '--extra-comment-excludes', (config.extraCommentExcludes || []).join(','),
      ],
      {},
      'filter'
    )

    state.lastResult = { searchPath, outputPath, finishedAt: new Date().toISOString() }
    pushLog(`RESULT ${outputPath}`)
  } finally {
    state.running = false
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  if (req.method === 'GET' && url.pathname === '/') return serveFile(res, path.join(UI_DIR, 'index.html'), 'text/html; charset=utf-8')
  if (req.method === 'GET' && url.pathname === '/app.js') return serveFile(res, path.join(UI_DIR, 'app.js'), 'application/javascript; charset=utf-8')
  if (req.method === 'GET' && url.pathname === '/styles.css') return serveFile(res, path.join(UI_DIR, 'styles.css'), 'text/css; charset=utf-8')
  if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, state)

  if (req.method === 'POST' && url.pathname === '/api/run') {
    try {
      const raw = await readBody(req)
      const body = JSON.parse(raw || '{}')
      const keywords = Array.isArray(body.keywords) ? body.keywords.map((s) => String(s).trim()).filter(Boolean) : []
      if (!keywords.length) return sendJson(res, 400, { error: 'keywords required' })
      runPipeline({
        cookie: String(body.cookie || ''),
        keywords,
        days: Number(body.days || 1),
        target: Number(body.target || 100),
        pages: Number(body.pages || 2),
        count: Number(body.count || 50),
        scrollLoops: Number(body.scrollLoops || 28),
        extraNameExcludes: Array.isArray(body.extraNameExcludes) ? body.extraNameExcludes : [],
        extraCommentExcludes: Array.isArray(body.extraCommentExcludes) ? body.extraCommentExcludes : [],
      }).catch((error) => pushLog(`PIPELINE ERROR ${error.message}`))
      return sendJson(res, 202, { ok: true })
    } catch (error) {
      return sendJson(res, 500, { error: error.message })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/result') {
    if (!state.lastResult?.outputPath) return sendJson(res, 404, { error: 'no result yet' })
    try {
      const csv = fs.readFileSync(state.lastResult.outputPath, 'utf8')
      return sendJson(res, 200, { ...state.lastResult, csv })
    } catch (error) {
      return sendJson(res, 500, { error: error.message })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/download') {
    if (!state.lastResult?.outputPath) return sendJson(res, 404, { error: 'no result yet' })
    try {
      const file = fs.readFileSync(state.lastResult.outputPath)
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${path.basename(state.lastResult.outputPath)}"`,
      })
      return res.end(file)
    } catch (error) {
      return sendJson(res, 500, { error: error.message })
    }
  }

  res.writeHead(404)
  res.end('Not found')
})

const port = Number(process.env.PORT || 4318)
server.listen(port, () => {
  console.log(`xiansuodouyin running at http://127.0.0.1:${port}`)
})
