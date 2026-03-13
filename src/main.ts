const FEATURE_SERVICE =
  'https://services1.arcgis.com/cYAR0YQ3Tr6M4FbT/arcgis/rest/services/Open_Maintenance_Work_Orders_(View)/FeatureServer/0'

const FIELDS = ['W_O_NO', 'WO_DATE', 'Zone', 'ADD_', 'STREET', 'CROSS_STREET',
  'PROBLEM_CODE', 'STATUS', 'PROBLEM_DESC', 'W_O_AGE', 'DEPT_CODE',
  'WO_TYPE', 'PRIORITY_CODE']

const HEADERS = ['Work Order #', 'Date', 'Zone', 'Address #', 'Street',
  'Cross Street', 'Problem Code', 'Status', 'Problem Description', 'Age (days)',
  'Dept Code', 'WO Type', 'Priority']

// Columns where raw values are numbers and should sort numerically
const NUMERIC_FIELDS = new Set(['WO_DATE', 'W_O_AGE', 'ADD_'])

const MAX_RECORD_COUNT = 2000

const btnGenerate = document.getElementById('btn-generate') as HTMLButtonElement
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLSpanElement
const tableContainer = document.getElementById('table-container') as HTMLDivElement
const rowCountEl = document.getElementById('row-count') as HTMLSpanElement

type Feature = { attributes: Record<string, string | number | null> }
type SortDir = 'asc' | 'desc'

let allFeatures: Feature[] = []
let csvContent = ''
let sortCol = -1
let sortDir: SortDir = 'asc'

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

async function fetchPage(offset: number): Promise<{ features: Feature[]; exceededTransferLimit: boolean }> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: FIELDS.join(','),
    resultOffset: String(offset),
    resultRecordCount: String(MAX_RECORD_COUNT),
    orderByFields: 'WO_DATE DESC',
    f: 'json',
  })
  const res = await fetch(`${FEATURE_SERVICE}/query?${params}`)
  if (!res.ok) throw new Error(`ArcGIS request failed: ${res.status}`)
  const json = await res.json() as { features: Feature[]; exceededTransferLimit?: boolean; error?: { message: string } }
  if (json.error) throw new Error(json.error.message)
  return { features: json.features ?? [], exceededTransferLimit: json.exceededTransferLimit ?? false }
}

async function fetchAll(): Promise<Feature[]> {
  const all: Feature[] = []
  let offset = 0
  while (true) {
    const { features, exceededTransferLimit } = await fetchPage(offset)
    all.push(...features)
    setStatus(`Fetching… ${all.length} records so far`)
    if (!exceededTransferLimit || features.length === 0) break
    offset += features.length
  }
  return all
}

function formatValue(field: string, value: string | number | null): string {
  if (value === null || value === undefined) return ''
  if (field === 'WO_DATE' && typeof value === 'number') {
    return new Date(value).toLocaleDateString('en-US')
  }
  return String(value)
}

function sortedFeatures(): Feature[] {
  if (sortCol < 0) return allFeatures
  const field = FIELDS[sortCol]
  const numeric = NUMERIC_FIELDS.has(field)
  return [...allFeatures].sort((a, b) => {
    const av = a.attributes[field] ?? (numeric ? -Infinity : '')
    const bv = b.attributes[field] ?? (numeric ? -Infinity : '')
    let cmp: number
    if (numeric) {
      cmp = (av as number) - (bv as number)
    } else {
      cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
    }
    return sortDir === 'asc' ? cmp : -cmp
  })
}

function renderTbody(features: Feature[]): string {
  return `<tbody>${features.map(f =>
    `<tr>${FIELDS.map(field =>
      `<td>${formatValue(field, f.attributes[field] ?? null)}</td>`
    ).join('')}</tr>`
  ).join('')}</tbody>`
}

function renderThead(): string {
  const ths = HEADERS.map((h, i) => {
    const indicator = i === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
    const active = i === sortCol ? ' class="sorted"' : ''
    return `<th${active} data-col="${i}">${h}${indicator}</th>`
  }).join('')
  return `<thead><tr>${ths}</tr></thead>`
}

function renderTable() {
  const features = sortedFeatures()
  const table = document.getElementById('preview-table')
  if (table) {
    table.querySelector('thead')!.outerHTML = renderThead()
    table.querySelector('tbody')!.outerHTML = renderTbody(features)
    // Re-attach header after innerHTML replacement loses the element reference
    attachHeaderListeners()
  } else {
    tableContainer.innerHTML =
      `<table id="preview-table">${renderThead()}${renderTbody(features)}</table>`
    attachHeaderListeners()
  }
}

function attachHeaderListeners() {
  const table = document.getElementById('preview-table')!
  table.querySelectorAll('thead th').forEach(th => {
    (th as HTMLElement).addEventListener('click', () => {
      const col = Number((th as HTMLElement).dataset.col)
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc'
      } else {
        sortCol = col
        sortDir = 'asc'
      }
      renderTable()
    })
  })
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function buildCSV(features: Feature[]): string {
  const rows = features.map(f => FIELDS.map(field => escapeCSV(formatValue(field, f.attributes[field] ?? null))))
  return [HEADERS.map(escapeCSV), ...rows].map(r => r.join(',')).join('\n')
}

async function generateReport() {
  setLoading(true)
  setStatus('Connecting to ArcGIS feature service…')
  btnDownload.style.display = 'none'
  rowCountEl.textContent = ''
  sortCol = -1

  try {
    allFeatures = await fetchAll()
    if (allFeatures.length === 0) {
      tableContainer.innerHTML = '<div class="empty-state">No records returned.</div>'
      setStatus('Done — no records found.')
      return
    }
    csvContent = buildCSV(allFeatures)
    renderTable()
    rowCountEl.textContent = `— ${allFeatures.length.toLocaleString()} records`
    btnDownload.style.display = 'inline-block'
    setStatus(`Done. ${allFeatures.length.toLocaleString()} work orders loaded.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setStatus(`Error: ${message}`, true)
    tableContainer.innerHTML = `<div class="empty-state">Failed to load data: ${message}</div>`
  } finally {
    setLoading(false)
  }
}

function downloadCSV() {
  if (!csvContent) return
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `swbno-work-orders-${timestamp}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

btnGenerate.addEventListener('click', generateReport)
btnDownload.addEventListener('click', downloadCSV)
