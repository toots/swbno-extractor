import type { ArcGISField, Feature, LayerMeta, SortDir } from './types'

export interface TableState {
  features: Feature[]
  fields: ArcGISField[]
  numericFields: Set<string>
  dateFields: Set<string>
  sortCol: number
  sortDir: SortDir
}

export function createTableState(meta: LayerMeta, features: Feature[]): TableState {
  return {
    features,
    fields: meta.fields,
    numericFields: meta.numericFields,
    dateFields: meta.dateFields,
    sortCol: -1,
    sortDir: 'asc',
  }
}

export function formatValue(type: string, value: string | number | null): string {
  if (value === null || value === undefined) return ''
  if (type === 'esriFieldTypeDate' && typeof value === 'number') {
    return new Date(value).toLocaleDateString('en-US')
  }
  if (type === 'esriFieldTypeTimespan' && typeof value === 'number') {
    const days = Math.floor(value / 24)
    const hours = Math.floor(value % 24)
    return days > 0 ? `${days}d ${hours}h` : `${hours}h`
  }
  return String(value)
}

function sortedFeatures(state: TableState): Feature[] {
  if (state.sortCol < 0) return state.features
  const field = state.fields[state.sortCol]
  const numeric = state.numericFields.has(field.name)
  return [...state.features].sort((a, b) => {
    const av = a.attributes[field.name] ?? (numeric ? -Infinity : '')
    const bv = b.attributes[field.name] ?? (numeric ? -Infinity : '')
    let cmp: number
    if (numeric) {
      cmp = (av as number) - (bv as number)
    } else {
      cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
    }
    return state.sortDir === 'asc' ? cmp : -cmp
  })
}

function renderThead(state: TableState): string {
  const ths = state.fields.map((f, i) => {
    const indicator = i === state.sortCol ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : ''
    const active = i === state.sortCol ? ' class="sorted"' : ''
    return `<th${active} data-col="${i}">${f.alias || f.name}${indicator}</th>`
  }).join('')
  return `<thead><tr>${ths}</tr></thead>`
}

function renderTbody(state: TableState, features: Feature[]): string {
  return `<tbody>${features.map(f =>
    `<tr>${state.fields.map(field =>
      `<td>${formatValue(field.type, f.attributes[field.name] ?? null)}</td>`
    ).join('')}</tr>`
  ).join('')}</tbody>`
}

export function renderTable(container: HTMLElement, state: TableState): void {
  const features = sortedFeatures(state)
  const existing = container.querySelector('#preview-table')
  if (existing) {
    existing.querySelector('thead')!.outerHTML = renderThead(state)
    existing.querySelector('tbody')!.outerHTML = renderTbody(state, features)
    attachHeaderListeners(container, state)
  } else {
    container.innerHTML =
      `<table id="preview-table">${renderThead(state)}${renderTbody(state, features)}</table>`
    attachHeaderListeners(container, state)
  }
}

export function attachHeaderListeners(container: HTMLElement, state: TableState): void {
  const table = container.querySelector('#preview-table')!
  table.querySelectorAll('thead th').forEach(th => {
    (th as HTMLElement).addEventListener('click', () => {
      const col = Number((th as HTMLElement).dataset.col)
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'
      } else {
        state.sortCol = col
        state.sortDir = 'asc'
      }
      renderTable(container, state)
    })
  })
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function buildCSV(state: TableState): string {
  const headers = state.fields.map(f => f.alias || f.name)
  const rows = state.features.map(f =>
    state.fields.map(field => escapeCSV(formatValue(field.type, f.attributes[field.name] ?? null)))
  )
  return [headers.map(escapeCSV), ...rows].map(r => r.join(',')).join('\n')
}

export function downloadCSV(csv: string, slug: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug}-${timestamp}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
