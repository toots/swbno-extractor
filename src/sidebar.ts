import type { ServiceEntry } from './types'

export function renderSidebar(listEl: HTMLElement, entries: ServiceEntry[]): void {
  const grouped = new Map<string, ServiceEntry[]>()
  for (const entry of entries) {
    const group = grouped.get(entry.serviceName) ?? []
    group.push(entry)
    grouped.set(entry.serviceName, group)
  }

  const items: string[] = []
  for (const [serviceName, group] of grouped) {
    if (group.length > 1) {
      const label = serviceName.replace(/_/g, ' ')
      items.push(`<li class="group-label" title="${serviceName}">${label}</li>`)
    }
    for (const entry of group) {
      const label = group.length > 1 ? entry.layerName : serviceName.replace(/_/g, ' ')
      items.push(
        `<li class="nav-item" data-key="${entry.navKey}" title="${entry.layerName}">${label}</li>`
      )
    }
  }

  listEl.innerHTML = items.join('')

  listEl.querySelectorAll('.nav-item').forEach(li => {
    li.addEventListener('click', () => {
      const key = (li as HTMLElement).dataset.key!
      window.location.hash = `/` + key
    })
  })
}

export function markActive(listEl: HTMLElement, navKey: string): void {
  listEl.querySelectorAll('.nav-item').forEach(li => {
    li.classList.toggle('active', (li as HTMLElement).dataset.key === navKey)
  })
}
