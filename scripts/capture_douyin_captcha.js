const { chromium } = require('playwright')
const fs = require('fs')

const output = process.env.CAPTCHA_OUTPUT || '/Users/mega/xiansuodouyin/data/captcha-shot.png'

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1800 },
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
  })
  const cookie = process.env.DOUYIN_COOKIE || ''
  if (cookie) {
    const cookies = cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=')
      const name = i >= 0 ? pair.slice(0, i) : pair
      const value = i >= 0 ? pair.slice(i + 1) : ''
      return { name, value, domain: '.douyin.com', path: '/', secure: true, sameSite: 'Lax' }
    }).filter((item) => item.name && item.name !== 'douyin.com')
    await context.addCookies(cookies)
  }

  const page = await context.newPage()
  await page.goto('https://www.douyin.com/search/%E8%B7%A8%E5%A2%83%E7%94%B5%E5%95%86?type=general', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  await page.getByText('视频', { exact: true }).click().catch(() => {})
  await page.waitForTimeout(4000)
  await page.screenshot({ path: output, fullPage: true })

  const info = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('div, img, canvas, iframe')).map((n) => ({
      tag: n.tagName,
      cls: n.className || '',
      id: n.id || '',
      text: (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      rect: (() => {
        const r = n.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      })(),
    }))
    return nodes.filter((n) => /验证|滑块|拖动|请完成|安全|拼图/.test(`${n.cls} ${n.id} ${n.text}`) || (n.rect.width > 200 && n.rect.height > 80 && n.rect.width < 500 && n.rect.height < 300)).slice(0, 80)
  })

  fs.writeFileSync('/Users/mega/xiansuodouyin/data/captcha-dom.json', JSON.stringify(info, null, 2))
  console.log(JSON.stringify({ output, infoCount: info.length }))
  await page.waitForTimeout(120000)
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
