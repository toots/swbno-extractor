const TARGET_URL = 'https://swbno.org/Projects/WorkOrderDashboard'
const PROXY_URL = `https://api.allorigins.win/get?url=${encodeURIComponent(TARGET_URL)}`

const btnGenerate = document.getElementById('btn-generate') as HTMLButtonElement
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLSpanElement
const tableContainer = document.getElementById('table-container') as HTMLDivElement
const rowCountEl = document.getElementById('row-count') as HTMLSpanElement

let csvContent = ''

function setStatus(msg: string, isError = false) {
  statusEl.textContent = msg
  statusEl.className = isError ? 'error' : ''
}

function setLoading(loading: boolean) {
  if (loading) {
    btnGenerate.innerHTML = '<span class="spinner"></span>Fetching…'
    btnGenerate.disabled = true
  } else {
    btnGenerate.innerHTML = 'Generate Report'
    btnGenerate.disabled = false
  }
}

async function fetchDashboard(): Promise<Document> {
  const response = await fetch(PROXY_URL)
  if (!response.ok) throw new Error(`Proxy request failed: ${response.status}`)
  const json = await response.json() as { contents: string; status: { url: string } }
  const parser = new DOMParser()
  return parser.parseFromString(json.contents, 'text/html')
}

function findMainTable(doc: Document): HTMLTableElement | null {
  // Try to find the largest table (most rows) as the main work order table
  const tables = Array.from(doc.querySelectorAll('table'))
  if (tables.length === 0) return null
  return tables.reduce((best, t) => t.rows.length > best.rows.length ? t : best)
}

function tableToRows(table: HTMLTableElement): string[][] {
  const rows: string[][] = []
  for (const row of Array.from(table.rows)) {
    const cells = Array.from(row.cells).map(cell => cell.innerText.trim().replace(/\s+/g, ' '))
    if (cells.some(c => c !== '')) rows.push(cells)
  }
  return rows
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function rowsToCSV(rows: string[][]): string {
  return rows.map(row => row.map(escapeCSV).join(',')).join('\n')
}

function renderTable(rows: string[][]) {
  if (rows.length === 0) {
    tableContainer.innerHTML = '<div class="empty-state">No table data found on the page.</div>'
    return
  }

  const [header, ...body] = rows
  const dataRows = body.length

  const thead = `<thead><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${body.map(
    row => `<tr>${row.map((cell, i) => {
      // Pad short rows to match header length
      return i < header.length ? `<td>${cell}</td>` : ''
    }).join('')}</tr>`
  ).join('')}</tbody>`

  tableContainer.innerHTML = `<table id="preview-table">${thead}${tbody}</table>`
  rowCountEl.textContent = `— ${dataRows.toLocaleString()} row${dataRows !== 1 ? 's' : ''}`
}

async function generateReport() {
  setLoading(true)
  setStatus('Fetching dashboard via CORS proxy…')
  btnDownload.style.display = 'none'
  rowCountEl.textContent = ''

  try {
    const doc = await fetchDashboard()
    setStatus('Parsing table…')

    const table = findMainTable(doc)
    if (!table) {
      throw new Error('No table found on the page. The site structure may have changed.')
    }

    const rows = tableToRows(table)
    csvContent = rowsToCSV(rows)
    renderTable(rows)
    btnDownload.style.display = 'inline-block'
    setStatus(`Done. ${rows.length - 1} work orders extracted.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setStatus(`Error: ${message}`, true)
    tableContainer.innerHTML = `<div class="empty-state">Failed to load data. ${message}</div>`
  } finally {
    setLoading(false)
  }
}

function downloadCSV() {
  if (!csvContent) return
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `swbno-work-orders-${timestamp}.csv`
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

btnGenerate.addEventListener('click', generateReport)
btnDownload.addEventListener('click', downloadCSV)
