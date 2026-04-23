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
const LEGACY_COOKIE_JSON = path.join(process.env.HOME || '', '.openclaw', 'workspace', 'tools', 'TikTokDownloader', 'Volume', 'settings.json')

for (const dir of [DATA_DIR, OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const state = { running: false, log: [], lastResult: null, currentJobId: null }
const jobs = new Map()

process.on('uncaughtException', (error) => {
  const message = `UNCAUGHT ${error.stack || error.message}`
  pushLog(message)
  console.error(message)
})

process.on('unhandledRejection', (error) => {
  const message = `UNHANDLED ${error && error.stack ? error.stack : String(error)}`
  pushLog(message)
  console.error(message)
})

function createJob(config) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const job = {
    id: jobId,
    status: 'queued',
    config,
    log: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  }
  jobs.set(jobId, job)
  return job
}

function getJob(jobId) {
  return jobId ? jobs.get(jobId) : null
}

function serializeJob(job) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    log: job.log,
    result: job.result,
  }
}

function pushLog(line, job) {
  const entry = `${new Date().toISOString()} ${line}`
  state.log.push(entry)
  if (state.log.length > 500) state.log.shift()
  if (job) {
    job.log.push(entry)
    if (job.log.length > 500) job.log.shift()
  }
}

function readLegacyCookie() {
  try {
    if (!fs.existsSync(LEGACY_COOKIE_JSON)) return ''
    const raw = JSON.parse(fs.readFileSync(LEGACY_COOKIE_JSON, 'utf8'))
    const cookie = raw.cookie || {}
    if (typeof cookie === 'string') return cookie.trim()
    return Object.entries(cookie)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
      .trim()
  } catch {
    return ''
  }
}

function resolveCookie(config) {
  const directCookie = (config.cookie || '').trim()
  if (directCookie) return { value: directCookie, source: 'ui' }

  const envCookie = (process.env.DOUYIN_COOKIE || '').trim()
  if (envCookie) return { value: envCookie, source: 'env' }

  const legacyCookie = readLegacyCookie()
  if (legacyCookie) return { value: legacyCookie, source: 'legacy-settings' }

  return { value: '', source: 'missing' }
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

function runCommand(command, args, env, label, job, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    pushLog(`START ${label}`, job)
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      pushLog(`TIMEOUT ${label} after ${timeoutMs}ms`, job)
      child.kill('SIGTERM')
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => pushLog(`${label} ${chunk.toString().trim()}`, job))
    child.stderr.on('data', (chunk) => pushLog(`${label} ${chunk.toString().trim()}`, job))
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pushLog(`END ${label} code=${code}`, job)
      if (code === 0) resolve()
      else reject(new Error(`${label} failed with code ${code}`))
    })
  })
}

async function runPipeline(config, job) {
  if (state.running) throw new Error('A task is already running')
  const resolvedCookie = resolveCookie(config)
  const cookie = resolvedCookie.value
  if (!cookie) throw new Error('Missing Douyin cookie. Paste one in the UI, set DOUYIN_COOKIE, or prepare legacy settings.json.')

  state.running = true
  state.lastResult = null
  state.currentJobId = job ? job.id : null
  state.log = []
  if (job) {
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    job.error = null
    job.result = null
    job.log = []
  }
  try {
    pushLog(`COOKIE source=${resolvedCookie.source}`, job)
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
        'search',
        job,
        Number(config.searchTimeoutMs || 180000),
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
      'filter',
      job,
      Number(config.filterTimeoutMs || 180000),
    )

    state.lastResult = { searchPath, outputPath, finishedAt: new Date().toISOString() }
    pushLog(`RESULT ${outputPath}`, job)
    if (job) {
      job.status = 'succeeded'
      job.finishedAt = new Date().toISOString()
      job.result = { searchPath, outputPath, finishedAt: job.finishedAt }
    }
    return state.lastResult
  } catch (error) {
    if (job) {
      job.status = 'failed'
      job.error = error.message
      job.finishedAt = new Date().toISOString()
    }
    throw error
  } finally {
    state.running = false
    state.currentJobId = null
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  if (req.method === 'GET' && url.pathname === '/') return serveFile(res, path.join(UI_DIR, 'index.html'), 'text/html; charset=utf-8')
  if (req.method === 'GET' && url.pathname === '/app.js') return serveFile(res, path.join(UI_DIR, 'app.js'), 'application/javascript; charset=utf-8')
  if (req.method === 'GET' && url.pathname === '/styles.css') return serveFile(res, path.join(UI_DIR, 'styles.css'), 'text/css; charset=utf-8')
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const currentJob = getJob(state.currentJobId)
    return sendJson(res, 200, { ...state, currentJob: serializeJob(currentJob) })
  }

  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    try {
      const raw = await readBody(req)
      const body = JSON.parse(raw || '{}')
      const keywords = Array.isArray(body.keywords) ? body.keywords.map((s) => String(s).trim()).filter(Boolean) : []
      if (!keywords.length) return sendJson(res, 400, { error: 'keywords required' })
      if (state.running) return sendJson(res, 409, { error: 'A task is already running' })

      const config = {
        cookie: String(body.cookie || ''),
        keywords,
        days: Number(body.days || 1),
        target: Number(body.target || 100),
        pages: Number(body.pages || 2),
        count: Number(body.count || 50),
        scrollLoops: Number(body.scrollLoops || 28),
        searchTimeoutMs: Number(body.searchTimeoutMs || 180000),
        filterTimeoutMs: Number(body.filterTimeoutMs || 180000),
        extraNameExcludes: Array.isArray(body.extraNameExcludes) ? body.extraNameExcludes : [],
        extraCommentExcludes: Array.isArray(body.extraCommentExcludes) ? body.extraCommentExcludes : [],
      }

      const job = createJob(config)
      runPipeline(config, job).catch((error) => {
        pushLog(`PIPELINE ERROR ${error.message}`, job)
      })
      return sendJson(res, 202, { ok: true, job: serializeJob(job) })
    } catch (error) {
      return sendJson(res, 500, { error: error.message })
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    const parts = url.pathname.split('/').filter(Boolean)
    const jobId = parts[2]
    const action = parts[3] || ''
    const job = getJob(jobId)
    if (!job) return sendJson(res, 404, { error: 'job not found' })

    if (!action) {
      return sendJson(res, 200, { job: serializeJob(job) })
    }

    if (action === 'result') {
      if (!job.result?.outputPath) return sendJson(res, 404, { error: 'no result yet' })
      try {
        const csv = fs.readFileSync(job.result.outputPath, 'utf8')
        return sendJson(res, 200, { ...job.result, csv, job: serializeJob(job) })
      } catch (error) {
        return sendJson(res, 500, { error: error.message })
      }
    }

    if (action === 'download') {
      if (!job.result?.outputPath) return sendJson(res, 404, { error: 'no result yet' })
      try {
        const file = fs.readFileSync(job.result.outputPath)
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${path.basename(job.result.outputPath)}"`,
        })
        return res.end(file)
      } catch (error) {
        return sendJson(res, 500, { error: error.message })
      }
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    try {
      const raw = await readBody(req)
      const body = JSON.parse(raw || '{}')
      const keywords = Array.isArray(body.keywords) ? body.keywords.map((s) => String(s).trim()).filter(Boolean) : []
      if (!keywords.length) return sendJson(res, 400, { error: 'keywords required' })
      if (state.running) return sendJson(res, 409, { error: 'A task is already running' })
      const config = {
        cookie: String(body.cookie || ''),
        keywords,
        days: Number(body.days || 1),
        target: Number(body.target || 100),
        pages: Number(body.pages || 2),
        count: Number(body.count || 50),
        scrollLoops: Number(body.scrollLoops || 28),
        searchTimeoutMs: Number(body.searchTimeoutMs || 180000),
        filterTimeoutMs: Number(body.filterTimeoutMs || 180000),
        extraNameExcludes: Array.isArray(body.extraNameExcludes) ? body.extraNameExcludes : [],
        extraCommentExcludes: Array.isArray(body.extraCommentExcludes) ? body.extraCommentExcludes : [],
      }
      const job = createJob(config)
      runPipeline(config, job).catch((error) => pushLog(`PIPELINE ERROR ${error.message}`, job))
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
server.on('error', (error) => {
  const message = `SERVER ERROR ${error.stack || error.message}`
  pushLog(message)
  console.error(message)
})

server.listen(port, () => {
  console.log(`xiansuodouyin running at http://127.0.0.1:${port}`)
})
