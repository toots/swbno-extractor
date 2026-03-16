import type { ServiceEntry } from './types'
import { fetchServiceList, fetchFeatureServerLayers } from './arcgis'
import { renderSidebar, markActive } from './sidebar'
import { renderPage } from './page'

const sidebarList = document.getElementById('sidebar-list') as HTMLUListElement
const mainContent = document.getElementById('main-content') as HTMLElement

let entries: ServiceEntry[] = []
let currentNavKey = ''

function parseHash(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

function navigate() {
  const key = parseHash()
  const entry = entries.find(e => e.navKey === key) ?? entries[0]
  if (!entry) return
  if (entry.navKey === currentNavKey) return
  currentNavKey = entry.navKey
  if (window.location.hash !== `#/${entry.navKey}`) {
    history.replaceState(null, '', `#/${entry.navKey}`)
  }
  markActive(sidebarList, entry.navKey)
  const snapshot = currentNavKey
  renderPage(mainContent, entry, () => snapshot === currentNavKey ? currentNavKey : '')
}

async function init() {
  mainContent.innerHTML = '<div class="loading-skeleton"><div class="spinner-large"></div><p>Loading services…</p></div>'

  try {
    const services = await fetchServiceList()
    const layerGroups = await Promise.all(
      services.map(async svc => {
        try {
          const layers = await fetchFeatureServerLayers(svc.url)
          return layers.map(layer => ({
            serviceName: svc.name,
            layerId: layer.id,
            layerName: layer.name,
            featureServerUrl: svc.url,
            navKey: `${svc.name}/${layer.id}`,
          } satisfies ServiceEntry))
        } catch {
          return []
        }
      })
    )
    entries = layerGroups.flat()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    mainContent.innerHTML = `<div class="empty-state">Failed to load services: ${msg}</div>`
    return
  }

  if (entries.length === 0) {
    mainContent.innerHTML = '<div class="empty-state">No FeatureServer services found.</div>'
    return
  }

  renderSidebar(sidebarList, entries)
  navigate()
}

window.addEventListener('hashchange', () => {
  currentNavKey = ''
  navigate()
})

init()
