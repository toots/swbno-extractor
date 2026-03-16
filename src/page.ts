import type { LayerMeta, ServiceEntry } from './types'
import { fetchLayerMeta, fetchAll } from './arcgis'
import { createTableState, renderTable, buildCSV, downloadCSV } from './table'

const metaCache = new Map<string, LayerMeta>()

export async function renderPage(
  contentEl: HTMLElement,
  entry: ServiceEntry,
  getNavKey: () => string,
): Promise<void> {
  contentEl.innerHTML = `<div class="loading-skeleton"><div class="spinner-large"></div><p>Loading ${entry.layerName}…</p></div>`

  let meta: LayerMeta
  try {
    if (metaCache.has(entry.navKey)) {
      meta = metaCache.get(entry.navKey)!
    } else {
      const layerUrl = `${entry.featureServerUrl}/${entry.layerId}`
      meta = await fetchLayerMeta(layerUrl)
      metaCache.set(entry.navKey, meta)
    }
  } catch (err) {
    if (getNavKey() !== entry.navKey) return
    const msg = err instanceof Error ? err.message : String(err)
    contentEl.innerHTML = `<div class="empty-state">Failed to load metadata: ${msg}</div>`
    return
  }

  if (getNavKey() !== entry.navKey) return

  const layerUrl = `${entry.featureServerUrl}/${entry.layerId}`
  const mapUrl = `https://www.arcgis.com/apps/mapviewer/index.html?url=${encodeURIComponent(layerUrl)}`
  const slug = entry.serviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  contentEl.innerHTML = `
    <h2 class="page-title">${meta.name}</h2>
    <div class="controls">
      <button id="btn-generate"><span class="spinner" style="display:none"></span>Generate Report</button>
      <button id="btn-download" style="display:none">Download CSV</button>
      <span id="status"></span>
      <span id="row-count" class="row-count"></span>
    </div>
    <div class="panel">
      <div class="panel-header"><span>Map Viewer</span></div>
      <div id="iframe-container">
        <iframe src="${mapUrl}" title="${meta.name} map" allowfullscreen></iframe>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <span>Data <span id="table-row-count" class="row-count"></span></span>
      </div>
      <div id="table-container">
        <div class="empty-state">Click "Generate Report" to fetch data.</div>
      </div>
    </div>
  `

  const btnGenerate = contentEl.querySelector('#btn-generate') as HTMLButtonElement
  const btnDownload = contentEl.querySelector('#btn-download') as HTMLButtonElement
  const statusEl = contentEl.querySelector('#status') as HTMLSpanElement
  const rowCountEl = contentEl.querySelector('#row-count') as HTMLSpanElement
  const tableContainer = contentEl.querySelector('#table-container') as HTMLDivElement
  const spinner = btnGenerate.querySelector('.spinner') as HTMLElement

  let csvContent = ''

  function setStatus(msg: string, isError = false) {
    statusEl.textContent = msg
    statusEl.className = isError ? 'error' : ''
  }

  function setLoading(loading: boolean) {
    spinner.style.display = loading ? 'inline-block' : 'none'
    btnGenerate.disabled = loading
    if (!loading) spinner.style.display = 'none'
  }

  async function generate() {
    if (getNavKey() !== entry.navKey) return
    setLoading(true)
    setStatus('Connecting to ArcGIS feature service…')
    btnDownload.style.display = 'none'
    rowCountEl.textContent = ''

    try {
      const features = await fetchAll(layerUrl, meta.fields, meta.dateFields, count => {
        setStatus(`Fetching… ${count} records so far`)
      })

      if (getNavKey() !== entry.navKey) return

      if (features.length === 0) {
        tableContainer.innerHTML = '<div class="empty-state">No records returned.</div>'
        setStatus('Done — no records found.')
        return
      }

      const state = createTableState(meta, features)
      renderTable(tableContainer, state)
      csvContent = buildCSV(state)
      rowCountEl.textContent = `— ${features.length.toLocaleString()} records`
      btnDownload.style.display = 'inline-block'
      setStatus(`Done. ${features.length.toLocaleString()} records loaded.`)
    } catch (err) {
      if (getNavKey() !== entry.navKey) return
      const msg = err instanceof Error ? err.message : String(err)
      setStatus(`Error: ${msg}`, true)
      tableContainer.innerHTML = `<div class="empty-state">Failed to load data: ${msg}</div>`
    } finally {
      setLoading(false)
    }
  }

  btnGenerate.addEventListener('click', generate)
  btnDownload.addEventListener('click', () => {
    if (csvContent) downloadCSV(csvContent, slug)
  })

  generate()
}
