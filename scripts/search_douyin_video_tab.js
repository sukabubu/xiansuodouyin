const { chromium } = require('playwright')
const fs = require('fs')

const keywords = (process.env.SEARCH_KEYWORDS || '').split(',').map((s) => s.trim()).filter(Boolean)
const output = process.env.SEARCH_OUTPUT
if (!keywords.length) {
  console.error('SEARCH_KEYWORDS is required')
  process.exit(1)
}
if (!output) {
  console.error('SEARCH_OUTPUT is required')
  process.exit(1)
}

function extractItems(json, keyword) {
  const out = []
  for (const row of json.data || []) {
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
  page.on('response', async (response) => {
    const url = response.url()
    if (!url.includes('/aweme/v1/web/general/search/single/') && !url.includes('/aweme/v1/web/search/item/')) return
    try {
      const json = await response.json()
      for (const item of extractItems(json, keyword)) {
        if (!item.aweme_id || seen.has(item.aweme_id)) continue
        seen.add(item.aweme_id)
        items.push(item)
      }
    } catch {}
  })
  await page.goto(`https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(8000)
  await page.getByText('视频', { exact: true }).click().catch(() => {})
  await page.waitForTimeout(6000)
  for (let i = 0; i < scrollLoops; i += 1) {
    await page.mouse.wheel(0, 2600)
    await page.waitForTimeout(1200)
  }
  await context.close()
  return items
}

async function main() {
  const browser = await chromium.launch({ headless: true })
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
