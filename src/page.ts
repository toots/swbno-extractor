import type { ArcGISField, Feature, LayerMeta, ServiceEntry } from './types'
import { fetchLayerMeta, fetchAll } from './arcgis'
import { createTableState, renderTable, buildCSV, downloadCSV } from './table'

const metaCache = new Map<string, LayerMeta>()

const WO_SERVICE = 'Open_Maintenance_Work_Orders_(View)'

interface SnapshotEntry {
  first_seen: string
  closed_at?: string
  attributes: Record<string, string | number | null>
}

interface Snapshot {
  last_updated: string | null
  open: Record<string, SnapshotEntry>
  closed: Record<string, SnapshotEntry>
}

async function fetchSnapshot(): Promise<Snapshot | null> {
  try {
    const res = await fetch('./data/work_orders_snapshot.json')
    if (!res.ok) return null
    return await res.json() as Snapshot
  } catch {
    return null
  }
}

function mergeClosedWorkOrders(
  meta: LayerMeta,
  liveFeatures: Feature[],
  snapshot: Snapshot,
): { features: Feature[]; meta: LayerMeta } {
  const daysToCloseField: ArcGISField = {
    name: 'TIME_TO_CLOSE',
    alias: 'Time to Close',
    type: 'esriFieldTypeTimespan',
  }

  const closedEntries = Object.values(snapshot.closed)
  const closedFeatures: Feature[] = closedEntries.map(entry => {
    const firstSeen = new Date(entry.first_seen).getTime()
    const closedAt = new Date(entry.closed_at!).getTime()
    const hoursToClose = (closedAt - firstSeen) / 3_600_000
    return {
      attributes: {
        ...entry.attributes,
        STATUS: 'CLOSED',
        TIME_TO_CLOSE: hoursToClose,
      },
    }
  })

  const augmentedMeta: LayerMeta = {
    ...meta,
    fields: [...meta.fields, daysToCloseField],
    numericFields: new Set([...meta.numericFields, 'TIME_TO_CLOSE']),
  }

  return { features: [...liveFeatures, ...closedFeatures], meta: augmentedMeta }
}

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
      const isWOService = entry.serviceName === WO_SERVICE

      const [liveFeatures, snapshot] = await Promise.all([
        fetchAll(layerUrl, meta.fields, meta.dateFields, count => {
          setStatus(`Fetching… ${count} records so far`)
        }),
        isWOService ? fetchSnapshot() : Promise.resolve(null),
      ])

      if (getNavKey() !== entry.navKey) return

      let features = liveFeatures
      let effectiveMeta = meta

      if (isWOService && snapshot) {
        const merged = mergeClosedWorkOrders(meta, liveFeatures, snapshot)
        features = merged.features
        effectiveMeta = merged.meta
      }

      if (features.length === 0) {
        tableContainer.innerHTML = '<div class="empty-state">No records returned.</div>'
        setStatus('Done — no records found.')
        return
      }

      const state = createTableState(effectiveMeta, features)
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
