const FEATURE_SERVICE =
  'https://services1.arcgis.com/cYAR0YQ3Tr6M4FbT/arcgis/rest/services/Open_Maintenance_Work_Orders_(View)/FeatureServer/0'

const FIELDS = ['W_O_NO', 'WO_DATE', 'Zone', 'ADD_', 'STREET', 'CROSS_STREET',
  'PROBLEM_CODE', 'STATUS', 'PROBLEM_DESC', 'W_O_AGE', 'DEPT_CODE',
  'WO_TYPE', 'PRIORITY_CODE']

const HEADERS = ['Work Order #', 'Date', 'Zone', 'Address #', 'Street',
  'Cross Street', 'Problem Code', 'Status', 'Problem Description', 'Age (days)',
  'Dept Code', 'WO Type', 'Priority']

const MAX_RECORD_COUNT = 2000

const btnGenerate = document.getElementById('btn-generate') as HTMLButtonElement
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLSpanElement
const tableContainer = document.getElementById('table-container') as HTMLDivElement
const rowCountEl = document.getElementById('row-count') as HTMLSpanElement

type Feature = { attributes: Record<string, string | number | null> }

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

function featuresToRows(features: Feature[]): string[][] {
  return features.map(f => FIELDS.map(field => formatValue(field, f.attributes[field] ?? null)))
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function rowsToCSV(rows: string[][]): string {
  const lines = [HEADERS, ...rows].map(row => row.map(escapeCSV).join(','))
  return lines.join('\n')
}

function renderTable(rows: string[][]) {
  const thead = `<thead><tr>${HEADERS.map(h => `<th>${h}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${rows.map(
    row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
  ).join('')}</tbody>`
  tableContainer.innerHTML = `<table id="preview-table">${thead}${tbody}</table>`
  rowCountEl.textContent = `— ${rows.length.toLocaleString()} records`
}

async function generateReport() {
  setLoading(true)
  setStatus('Connecting to ArcGIS feature service…')
  btnDownload.style.display = 'none'
  rowCountEl.textContent = ''

  try {
    const features = await fetchAll()
    if (features.length === 0) {
      tableContainer.innerHTML = '<div class="empty-state">No records returned.</div>'
      setStatus('Done — no records found.')
      return
    }
    const rows = featuresToRows(features)
    csvContent = rowsToCSV(rows)
    renderTable(rows)
    btnDownload.style.display = 'inline-block'
    setStatus(`Done. ${rows.length.toLocaleString()} work orders loaded.`)
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
