const { chromium } = require('playwright')
const fs = require('fs')
const { execFileSync } = require('child_process')

const keywords = (process.env.SEARCH_KEYWORDS || '').split(',').map((s) => s.trim()).filter(Boolean)
const output = process.env.SEARCH_OUTPUT
const initialWaitMs = Number(process.env.SEARCH_INITIAL_WAIT_MS || '3500')
const afterTabWaitMs = Number(process.env.SEARCH_AFTER_TAB_WAIT_MS || '2500')
const scrollWaitMs = Number(process.env.SEARCH_SCROLL_WAIT_MS || '900')
const settleIdleMs = Number(process.env.SEARCH_SETTLE_IDLE_MS || '1200')
const settleMaxMs = Number(process.env.SEARCH_SETTLE_MAX_MS || '6000')
const sliderPostWaitMs = Number(process.env.SEARCH_SLIDER_POST_WAIT_MS || '2500')
let shuttingDown = false
let activeBrowser = null
let verificationRequired = false

function log(event, extra = {}) {
  console.error(JSON.stringify({ event, ...extra }))
}

async function closeBrowserAndExit(code) {
  shuttingDown = true
  if (activeBrowser) {
    try {
      await activeBrowser.close()
    } catch {}
  }
  process.exit(code)
}

process.on('SIGTERM', () => {
  log('signal', { signal: 'SIGTERM' })
  closeBrowserAndExit(143)
})

process.on('SIGINT', () => {
  log('signal', { signal: 'SIGINT' })
  closeBrowserAndExit(130)
})

if (!keywords.length) {
  console.error('SEARCH_KEYWORDS is required')
  process.exit(1)
}
if (!output) {
  console.error('SEARCH_OUTPUT is required')
  process.exit(1)
}

function extractItems(json, keyword) {
  const candidates = []

  const walk = (value) => {
    if (!value) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value !== 'object') return

    if (value.aweme_info || value.aweme_mix_info?.mix_items?.[0]) {
      candidates.push(value)
    }

    for (const nested of Object.values(value)) {
      walk(nested)
    }
  }

  walk(json)

  const out = []
  for (const row of candidates) {
    const aweme = row.aweme_info || row.aweme_mix_info?.mix_items?.[0]
    if (!aweme) continue
    const author = aweme.author || {}
    out.push({
      keyword,
      aweme_id: aweme.aweme_id,
      desc: aweme.desc || '',
      create_time: aweme.create_time || 0,
      author_nickname: author.nickname || '',
      author_sec_uid: author.sec_uid || '',
      url: aweme.aweme_id ? `https://www.douyin.com/video/${aweme.aweme_id}` : '',
    })
  }
  return out
}

function extractJsonObjectsFromText(text) {
  const results = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) {
        start = i
      }
      depth += 1
      continue
    }

    if (ch === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1)
        try {
          results.push(JSON.parse(candidate))
        } catch {}
        start = -1
      }
    }
  }

  return results
}

function parseStreamPayload(text) {
  const objects = extractJsonObjectsFromText(text)
  return objects.filter((obj) => obj && typeof obj === 'object')
}

function extractItemsFromResponseBody(bodyText, keyword) {
  const objects = parseStreamPayload(bodyText)
  const merged = []
  const seen = new Set()

  for (const obj of objects) {
    for (const item of extractItems(obj, keyword)) {
      if (!item.aweme_id || seen.has(item.aweme_id)) continue
      seen.add(item.aweme_id)
      merged.push(item)
    }
  }

  return merged
}

function hasVerifyCheck(bodyText) {
  return parseStreamPayload(bodyText).some(
    (obj) => obj?.search_nil_info?.search_nil_type === 'verify_check',
  )
}

function detectSlider(cropPath) {
  const raw = execFileSync('python3', ['-c', `import sys, json; sys.path.insert(0, '/Users/mega/.openclaw-daodun/workspace'); from captcha_recognizer import Slider; s = Slider(); box, score = s.identify('${cropPath}'); offset, score2 = s.identify_offset('${cropPath}'); print(json.dumps({'box': box, 'score': score, 'offset': offset, 'offset_score': score2}))`], { encoding: 'utf8' })
  return JSON.parse(raw)
}

async function dragSlider(page, startX, startY, distance) {
  await page.mouse.move(startX, startY, { steps: 6 })
  await page.mouse.down()
  const points = [0.10, 0.22, 0.34, 0.48, 0.62, 0.76, 0.88, 0.95, 1.0]
  for (let i = 0; i < points.length; i += 1) {
    const dx = distance * points[i]
    await page.mouse.move(startX + dx, startY + Math.sin(i / 2.5) * 1.1, { steps: 4 + i })
    await page.waitForTimeout(22 + Math.floor(Math.random() * 28))
  }
  await page.waitForTimeout(160).catch(() => {})
  await page.mouse.up()
}

async function waitForSettled(page, getCount, label) {
  const start = Date.now()
  let lastCount = getCount()
  let lastChangeAt = Date.now()

  while (!shuttingDown && !page.isClosed() && Date.now() - start < settleMaxMs) {
    await page.waitForTimeout(200).catch(() => {})
    const count = getCount()
    if (count !== lastCount) {
      lastCount = count
      lastChangeAt = Date.now()
    }
    if (Date.now() - lastChangeAt >= settleIdleMs) {
      break
    }
  }

  log('settled', { label, count: getCount(), elapsedMs: Date.now() - start })
}

async function hideDownloadGuide(page) {
  try {
    const changed = await page.evaluate(() => {
      const selectors = [
        '#douyin-web-download-guide-container',
        '[id*="download-guide"]',
        '[class*="download-guide"]',
      ]

      let hidden = 0

      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((node) => {
          node.style.display = 'none'
          node.style.visibility = 'hidden'
          node.style.pointerEvents = 'none'
          hidden += 1
        })
      }

      document.querySelectorAll('div,section,aside').forEach((node) => {
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim()
        if (!text.includes('下载电脑客户端')) return
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const looksFloating = ['fixed', 'sticky', 'absolute'].includes(style.position)
        const looksLikeGuide = rect.width >= 220 && rect.width <= 420 && rect.height >= 120 && rect.height <= 320
        if (looksFloating && looksLikeGuide) {
          node.style.display = 'none'
          node.style.visibility = 'hidden'
          node.style.pointerEvents = 'none'
          hidden += 1
        }
      })

      return hidden
    })

    if (changed > 0) {
      log('hide_download_guide', { hidden: changed })
    }
  } catch {}
}

async function clickVideoTab(page) {
  const target = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('a,button,div,span'))
      .map((node) => {
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim()
        const rect = node.getBoundingClientRect()
        return {
          text,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }
      })
      .filter((node) => node.text === '视频')
      .filter((node) => node.width > 20 && node.height > 20 && node.y > 40 && node.y < 160)
      .sort((a, b) => a.x - b.x)

    return candidates[0] || null
  }).catch(() => null)

  if (target) {
    log('video_tab_target', target)
    const x = target.x + target.width / 2
    const y = target.y + target.height / 2
    await page.mouse.click(x, y).catch(() => {})
    log('video_tab_clicked', { strategy: 'mouse', x, y })
    return true
  }

  const fallback = await page.getByText('视频', { exact: true }).first().click().then(() => true).catch(() => false)
  if (fallback) {
    log('video_tab_clicked', { strategy: 'playwright-text' })
  }
  return fallback
}

async function trySolveSlider(page) {
  const panel = { x: 529, y: 707, width: 381, height: 385 }
  const cropPath = '/Users/mega/xiansuodouyin/data/auto-slider-crop.png'
  const ok = await page.screenshot({ path: cropPath, clip: panel }).then(() => true).catch(() => false)
  if (!ok) return false

  let det
  try {
    det = detectSlider(cropPath)
  } catch {
    return false
  }

  const sliderLeft = Number(det.offset || 0)
  const gapLeft = Number((det.box || [0])[0] || 0)
  if (!sliderLeft || !gapLeft) return false

  const dragDistance = Math.max(0, gapLeft - sliderLeft - 2)
  const handleX = panel.x + sliderLeft + 18
  const handleY = panel.y + 310
  log('slider_detected', { sliderLeft, gapLeft, dragDistance })
  await dragSlider(page, handleX, handleY, dragDistance)
  await page.waitForTimeout(sliderPostWaitMs).catch(() => {})
  return true
}

async function attemptVerificationRecovery(page, reason) {
  log('verification_required', { reason })
  verificationRequired = true
  const solved = await trySolveSlider(page)
  log('verification_recovery', { solved, reason })
  return solved
}

async function runKeyword(browser, cookie, keyword, scrollLoops) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1800 },
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
  })
  if (cookie) {
    const cookies = cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=')
      const name = index >= 0 ? pair.slice(0, index) : pair
      const value = index >= 0 ? pair.slice(index + 1) : ''
      return { name, value, domain: '.douyin.com', path: '/', secure: true, sameSite: 'Lax' }
    }).filter((item) => item.name && item.name !== 'douyin.com')
    await context.addCookies(cookies)
  }
  const page = await context.newPage()
  const items = []
  const seen = new Set()
  verificationRequired = false
  page.on('response', async (response) => {
    if (shuttingDown || page.isClosed()) return
    const resourceType = response.request().resourceType()
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return
    const url = response.url()
    try {
      const bodyText = await response.text()
      if (hasVerifyCheck(bodyText)) {
        await attemptVerificationRecovery(page, 'search_nil_verify_check')
      }
      const extracted = extractItemsFromResponseBody(bodyText, keyword)
      if (extracted.length > 0) {
        log('search_response', { url, resourceType, itemCount: extracted.length })
      }
      for (const item of extracted) {
        if (!item.aweme_id || seen.has(item.aweme_id)) continue
        seen.add(item.aweme_id)
        items.push(item)
      }
    } catch {}
  })
  log('keyword_start', { keyword, scrollLoops })
  await page.goto(`https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(initialWaitMs).catch(() => {})
  await hideDownloadGuide(page)
  await waitForSettled(page, () => items.length, 'after-goto')
  await trySolveSlider(page)
  await clickVideoTab(page)
  await page.waitForTimeout(afterTabWaitMs).catch(() => {})
  await hideDownloadGuide(page)
  await waitForSettled(page, () => items.length, 'after-video-tab')
  await trySolveSlider(page)
  for (let i = 0; i < scrollLoops; i += 1) {
    await page.mouse.wheel(0, 2600)
    await page.waitForTimeout(scrollWaitMs).catch(() => {})
    await waitForSettled(page, () => items.length, `scroll-${i + 1}`)
    if (verificationRequired && items.length === 0) {
      await attemptVerificationRecovery(page, `scroll-${i + 1}`)
      await waitForSettled(page, () => items.length, `scroll-${i + 1}-post-verify`)
    }
    if (shuttingDown || page.isClosed()) break
  }
  if (verificationRequired && items.length === 0) {
    log('keyword_verify_blocked', { keyword })
  }
  log('keyword_done', { keyword, itemCount: items.length })
  await context.close()
  return items
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  activeBrowser = browser
  const cookie = process.env.DOUYIN_COOKIE || ''
  const scrollLoops = Number(process.env.SEARCH_SCROLL_LOOPS || '28')
  const merged = []
  const seen = new Set()
  for (const keyword of keywords) {
    let items = []
    try {
      items = await runKeyword(browser, cookie, keyword, scrollLoops)
    } catch (error) {
      console.error(JSON.stringify({ keyword, error: error.message }))
      if (shuttingDown) {
        break
      }
      continue
    }
    for (const item of items) {
      if (seen.has(item.aweme_id)) continue
      seen.add(item.aweme_id)
      merged.push(item)
    }
    fs.writeFileSync(output, JSON.stringify({ keywords, collected_at: new Date().toISOString(), items: merged }, null, 2))
  }
  fs.writeFileSync(output, JSON.stringify({ keywords, collected_at: new Date().toISOString(), items: merged }, null, 2))
  console.log(JSON.stringify({ output, keywordCount: keywords.length, itemCount: merged.length }))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
