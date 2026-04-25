const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const fs = require('fs')

const outputDir = '/Users/mega/xiansuodouyin/data'
const shotPath = `${outputDir}/captcha-shot.png`
const cropPath = `${outputDir}/captcha-crop.png`
const cookie = process.env.DOUYIN_COOKIE || ''

function parseDetector() {
  const raw = execFileSync('python3', ['-c', `
import sys, json
sys.path.insert(0, '/Users/mega/.openclaw-daodun/workspace')
from captcha_recognizer import Slider
s = Slider()
box, score = s.identify('${cropPath}')
offset, score2 = s.identify_offset('${cropPath}')
print(json.dumps({'box': box, 'score': score, 'offset': offset, 'offset_score': score2}))
`], { encoding: 'utf8' })
  return JSON.parse(raw)
}

async function humanDrag(page, startX, startY, distance) {
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  const steps = 18
  for (let i = 1; i <= steps; i += 1) {
    const x = startX + (distance * i) / steps + Math.sin(i / 2) * 2
    const y = startY + Math.sin(i / 3) * 1.5
    await page.mouse.move(x, y)
    await page.waitForTimeout(25 + Math.floor(Math.random() * 20))
  }
  await page.waitForTimeout(120)
  await page.mouse.up()
}

async function main() {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const browser = await chromium.launch({ headless: false, slowMo: 120 })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1800 },
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
  })

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
  await page.goto('https://www.douyin.com/search/%E8%B7%A8%E5%A2%83%E7%94%B5%E5%95%86?type=general', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  await page.getByText('视频', { exact: true }).click().catch(() => {})
  await page.waitForTimeout(4000)

  await page.screenshot({ path: shotPath, fullPage: true })

  const panel = { x: 529, y: 707, width: 381, height: 385 }
  await page.screenshot({ path: cropPath, clip: panel })

  const det = parseDetector()
  const sliderX = Number(det.offset)
  const gapX = Number(det.box[0])
  const dragDistance = Math.max(0, gapX - sliderX)

  const handleX = panel.x + sliderX + 20
  const handleY = panel.y + 310

  console.log(JSON.stringify({ det, dragDistance, handleX, handleY }))

  await humanDrag(page, handleX, handleY, dragDistance)
  await page.waitForTimeout(12000)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
