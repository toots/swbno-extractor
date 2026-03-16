import type { ArcGISField, Feature, LayerMeta } from './types'

const ORG_REST = 'https://services1.arcgis.com/cYAR0YQ3Tr6M4FbT/arcgis/rest'
const MAX_RECORD_COUNT = 10000

const HIDDEN_FIELD_RE = /^shape(_|__)?(area|length|len)$/i

function isHidden(field: ArcGISField): boolean {
  return field.type === 'esriFieldTypeGeometry'
    || field.name.toLowerCase() === 'shape'
    || HIDDEN_FIELD_RE.test(field.name)
}

const NUMERIC_TYPES = new Set([
  'esriFieldTypeInteger',
  'esriFieldTypeDouble',
  'esriFieldTypeSingle',
  'esriFieldTypeSmallInteger',
  'esriFieldTypeOID',
])

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${url}`)
  const json = await res.json() as { error?: { message: string } }
  if (json.error) throw new Error((json.error as { message: string }).message)
  return json
}

export async function fetchServiceList(): Promise<Array<{ name: string; url: string }>> {
  const json = await getJson(`${ORG_REST}/services?f=json`) as {
    services?: Array<{ name: string; type: string; url: string }>
  }
  return (json.services ?? [])
    .filter(s => s.type === 'FeatureServer')
    .map(s => ({ name: s.name.replace(/^.+\//, ''), url: s.url }))
}

export async function fetchFeatureServerLayers(url: string): Promise<Array<{ id: number; name: string }>> {
  const json = await getJson(`${url}?f=json`) as {
    layers?: Array<{ id: number; name: string }>
  }
  return json.layers ?? []
}

export async function fetchLayerMeta(layerUrl: string): Promise<LayerMeta> {
  const json = await getJson(`${layerUrl}?f=json`) as {
    name: string
    fields?: ArcGISField[]
  }
  const allFields: ArcGISField[] = json.fields ?? []
  const fields = allFields.filter(f => !isHidden(f))
  const numericFields = new Set(fields.filter(f => NUMERIC_TYPES.has(f.type)).map(f => f.name))
  const dateFields = new Set(fields.filter(f => f.type === 'esriFieldTypeDate').map(f => f.name))
  return { name: json.name, serviceUrl: layerUrl, fields, numericFields, dateFields }
}

export async function fetchPage(
  layerUrl: string,
  fields: ArcGISField[],
  offset: number,
  orderByFields?: string,
): Promise<{ features: Feature[]; exceededTransferLimit: boolean }> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: fields.map(f => f.name).join(','),
    resultOffset: String(offset),
    resultRecordCount: String(MAX_RECORD_COUNT),
    f: 'json',
  })
  if (orderByFields) params.set('orderByFields', orderByFields)
  const res = await fetch(`${layerUrl}/query?${params}`)
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status}`)
  const json = await res.json() as {
    features: Feature[]
    exceededTransferLimit?: boolean
    error?: { message: string }
  }
  if (json.error) throw new Error(json.error.message)
  return { features: json.features ?? [], exceededTransferLimit: json.exceededTransferLimit ?? false }
}

export async function fetchAll(
  layerUrl: string,
  fields: ArcGISField[],
  dateFields: Set<string>,
  onProgress: (count: number) => void,
): Promise<Feature[]> {
  const dateFieldNames = [...dateFields]
  const orderByFields = dateFieldNames.length > 0 ? `${dateFieldNames[0]} DESC` : undefined
  const all: Feature[] = []
  let offset = 0
  while (true) {
    const { features, exceededTransferLimit } = await fetchPage(layerUrl, fields, offset, orderByFields)
    all.push(...features)
    onProgress(all.length)
    if (!exceededTransferLimit || features.length === 0) break
    offset += features.length
  }
  return all
}
