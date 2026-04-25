const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const mode = process.env.DEBUG_HEADLESS === '1' ? 'headless' : 'headed'
const headless = mode === 'headless'
const keyword = process.env.DEBUG_KEYWORD || '跨境电商'
const outDir = '/Users/mega/xiansuodouyin/data/debug-flow'
fs.mkdirSync(outDir, { recursive: true })

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
  await page.waitForTimeout(160)
  await page.mouse.up()
}

async function snapshot(page, label, extras = {}) {
  const png = path.join(outDir, `${mode}-${label}.png`)
  await page.screenshot({ path: png, fullPage: true }).catch(() => {})
  const info = await page.evaluate(() => {
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 2000)
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ({ href: a.href, text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim() }))
      .filter((x) => x.text || x.href.includes('/video/'))
      .slice(0, 40)
    return {
      title: document.title,
      url: location.href,
      bodyText,
      links,
    }
  })
  const payload = { ...info, ...extras, screenshot: png }
  fs.writeFileSync(path.join(outDir, `${mode}-${label}.json`), JSON.stringify(payload, null, 2))
  console.log(JSON.stringify({ step: label, title: info.title, url: info.url, bodySnippet: info.bodyText.slice(0, 160), extras }))
}

async function trySolveSlider(page) {
  const bodyText = await page.evaluate(() => document.body.innerText || '')
  if (!/验证|滑块|拖动/.test(bodyText)) return { attempted: false }
  const panel = { x: 529, y: 707, width: 381, height: 385 }
  const cropPath = path.join(outDir, `${mode}-slider-crop.png`)
  await page.screenshot({ path: cropPath, clip: panel }).catch(() => {})
  const det = detectSlider(cropPath)
  const sliderLeft = Number(det.offset || 0)
  const gapLeft = Number((det.box || [0])[0] || 0)
  if (!sliderLeft || !gapLeft) return { attempted: true, solved: false, det }
  const dragDistance = Math.max(0, gapLeft - sliderLeft - 2)
  const handleX = panel.x + sliderLeft + 18
  const handleY = panel.y + 310
  await dragSlider(page, handleX, handleY, dragDistance)
  await page.waitForTimeout(5000)
  return { attempted: true, solved: true, det, dragDistance, handleX, handleY }
}

async function main() {
  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 80 })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1800 },
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
  })
  const cookie = process.env.DOUYIN_COOKIE || ''
  if (cookie) {
    const cookies = cookie
      .split('; ')
      .map((pair) => {
        const i = pair.indexOf('=')
        const name = i >= 0 ? pair.slice(0, i) : pair
        const value = i >= 0 ? pair.slice(i + 1) : ''
        return { name, value, domain: '.douyin.com', path: '/', secure: true, sameSite: 'Lax' }
      })
      .filter((item) => item.name && item.name !== 'douyin.com')
    await context.addCookies(cookies)
  }

  const page = await context.newPage()
  const matched = []
  page.on('response', async (response) => {
    const url = response.url()
    if (/search|aweme\/v1\/web/.test(url)) {
      matched.push({ status: response.status(), url })
    }
  })

  await page.goto(`https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(7000)
  await snapshot(page, 'after-general', { mode, matchedCount: matched.length })

  const solve1 = await trySolveSlider(page)
  await snapshot(page, 'after-general-solve', { solve1, matchedCount: matched.length })

  await page.getByText('视频', { exact: true }).click().catch(() => {})
  await page.waitForTimeout(7000)
  await snapshot(page, 'after-video-click', { matchedCount: matched.length })

  const solve2 = await trySolveSlider(page)
  await snapshot(page, 'after-video-solve', { solve2, matchedCount: matched.length, recentUrls: matched.slice(-20) })

  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 2400)
    await page.waitForTimeout(1200)
  }
  await snapshot(page, 'after-scroll', { matchedCount: matched.length, recentUrls: matched.slice(-30) })

  await page.waitForTimeout(headless ? 0 : 15000)
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
