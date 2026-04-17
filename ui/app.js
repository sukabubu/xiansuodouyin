const el = {
  keywords: document.getElementById('keywords'),
  days: document.getElementById('days'),
  target: document.getElementById('target'),
  pages: document.getElementById('pages'),
  count: document.getElementById('count'),
  scrollLoops: document.getElementById('scrollLoops'),
  extraNameExcludes: document.getElementById('extraNameExcludes'),
  extraCommentExcludes: document.getElementById('extraCommentExcludes'),
  runBtn: document.getElementById('runBtn'),
  statusBadge: document.getElementById('statusBadge'),
  statusJson: document.getElementById('statusJson'),
  logBox: document.getElementById('logBox'),
  resultMeta: document.getElementById('resultMeta'),
  tableWrap: document.getElementById('tableWrap'),
  statsBar: document.getElementById('statsBar'),
  downloadLink: document.getElementById('downloadLink'),
  refreshBtn: document.getElementById('refreshBtn'),
}

const presets = {
  crossborder: { keywords: ['跨境电商', 'tiktok跨境', 'tk小店', '外贸', '亚马逊跨境'] },
  ads: { keywords: ['FB投流', 'Facebook投流', 'Meta广告', '海外广告投放', '独立站'] },
  simple: { keywords: [] },
}

function lines(value) {
  return value.split('\n').map((s) => s.trim()).filter(Boolean)
}

function parseCsv(csv) {
  const lines = csv.trim().split('\n')
  if (!lines.length) return { headers: [], rows: [] }
  const split = (line) => {
    const out = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else q = !q
      } else if (ch === ',' && !q) {
        out.push(cur)
        cur = ''
      } else cur += ch
    }
    out.push(cur)
    return out
  }
  const headers = split(lines[0])
  const rows = lines.slice(1).filter(Boolean).map((line) => split(line))
  return { headers, rows }
}

function renderTable(csv) {
  const { headers, rows } = parseCsv(csv)
  if (!headers.length) {
    el.tableWrap.innerHTML = '<div class="muted" style="padding:12px">暂无结果</div>'
    return
  }
  const limited = rows.slice(0, 50)
  const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${limited.map((row) => `<tr>${row.map((cell) => `<td>${String(cell || '').replaceAll('<', '&lt;')}</td>`).join('')}</tr>`).join('')}</tbody>`
  el.tableWrap.innerHTML = `<table>${thead}${tbody}</table>`
}

function renderStats(status, result) {
  const stats = [
    ['运行中', status.running ? '是' : '否'],
    ['日志条数', String((status.log || []).length)],
    ['结果文件', result?.outputPath ? '已生成' : '暂无'],
    ['预览行数', result?.csv ? String(Math.max(result.csv.split('\n').length - 1, 0)) : '0'],
  ]
  el.statsBar.innerHTML = stats.map(([label, value]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join('')
}

async function refresh() {
  const status = await fetch('/api/status').then((r) => r.json())
  el.statusJson.textContent = JSON.stringify(status, null, 2)
  el.logBox.textContent = (status.log || []).slice(-80).join('\n')
  el.statusBadge.textContent = status.running ? 'running' : 'idle'
  el.statusBadge.className = `badge ${status.running ? 'running' : 'idle'}`
  let result = null
  if (status.lastResult?.outputPath) {
    result = await fetch('/api/result').then((r) => (r.ok ? r.json() : null))
    if (result) {
      el.resultMeta.textContent = `${result.outputPath}`
      el.downloadLink.href = '/api/download'
      el.downloadLink.classList.remove('disabled')
      renderTable(result.csv)
    }
  } else {
    el.downloadLink.href = '#'
    el.downloadLink.classList.add('disabled')
    renderTable('')
  }
  renderStats(status, result)
}

el.runBtn.addEventListener('click', async () => {
  await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords: lines(el.keywords.value),
      days: Number(el.days.value),
      target: Number(el.target.value),
      pages: Number(el.pages.value),
      count: Number(el.count.value),
      scrollLoops: Number(el.scrollLoops.value),
      extraNameExcludes: lines(el.extraNameExcludes.value),
      extraCommentExcludes: lines(el.extraCommentExcludes.value),
    }),
  })
  await refresh()
})

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = presets[btn.dataset.preset]
    el.keywords.value = (preset?.keywords || []).join('\n')
  })
})

el.refreshBtn.addEventListener('click', refresh)
refresh()
setInterval(refresh, 3000)
