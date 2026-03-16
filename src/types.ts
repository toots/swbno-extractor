export interface ArcGISField { name: string; alias: string; type: string }

export interface LayerMeta {
  name: string
  serviceUrl: string
  fields: ArcGISField[]
  numericFields: Set<string>
  dateFields: Set<string>
}

export interface ServiceEntry {
  serviceName: string
  layerId: number
  layerName: string
  featureServerUrl: string
  navKey: string
}

export type Feature = { attributes: Record<string, string | number | null> }
export type SortDir = 'asc' | 'desc'
