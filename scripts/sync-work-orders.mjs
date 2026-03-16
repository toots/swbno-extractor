#!/usr/bin/env node
// Sync open work orders from ArcGIS, detect closures, update snapshot.

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LAYER_URL = 'https://services1.arcgis.com/cYAR0YQ3Tr6M4FbT/arcgis/rest/services/Open_Maintenance_Work_Orders_(View)/FeatureServer/0'
const SNAPSHOT_PATH = resolve(__dirname, '../public/data/work_orders_snapshot.json')
const MAX_RECORD_COUNT = 10000
const WO_KEY = 'W_O_NO'

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${url}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json
}

async function fetchFields() {
  const json = await getJson(`${LAYER_URL}?f=json`)
  return (json.fields ?? []).map(f => f.name)
}

async function fetchPage(fields, offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: fields.join(','),
    resultOffset: String(offset),
    resultRecordCount: String(MAX_RECORD_COUNT),
    f: 'json',
  })
  const json = await getJson(`${LAYER_URL}/query?${params}`)
  return {
    features: json.features ?? [],
    exceededTransferLimit: json.exceededTransferLimit ?? false,
  }
}

async function fetchAll(fields) {
  const all = []
  let offset = 0
  while (true) {
    const { features, exceededTransferLimit } = await fetchPage(fields, offset)
    all.push(...features)
    process.stdout.write(`\rFetched ${all.length} records…`)
    if (!exceededTransferLimit || features.length === 0) break
    offset += features.length
  }
  process.stdout.write('\n')
  return all
}

async function readSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) return { last_updated: null, open: {}, closed: {} }
  const raw = await readFile(SNAPSHOT_PATH, 'utf8')
  return JSON.parse(raw)
}

async function main() {
  const now = new Date().toISOString()

  console.log('Reading snapshot…')
  const snapshot = await readSnapshot()

  console.log('Fetching layer fields…')
  const fields = await fetchFields()

  console.log('Fetching current work orders from ArcGIS…')
  const liveFeatures = await fetchAll(fields)

  const liveKeys = new Set(liveFeatures.map(f => String(f.attributes[WO_KEY])))

  let opened = 0
  let closed = 0
  let reopened = 0

  // Move disappeared WOs from open → closed
  for (const [key, entry] of Object.entries(snapshot.open)) {
    if (!liveKeys.has(key)) {
      snapshot.closed[key] = { ...entry, closed_at: now }
      delete snapshot.open[key]
      closed++
    }
  }

  // Add newly seen WOs to open; re-open previously closed ones that reappear
  for (const feature of liveFeatures) {
    const key = String(feature.attributes[WO_KEY])
    if (snapshot.closed[key]) {
      snapshot.open[key] = { first_seen: snapshot.closed[key].first_seen, attributes: feature.attributes }
      delete snapshot.closed[key]
      reopened++
    } else if (!snapshot.open[key]) {
      snapshot.open[key] = { first_seen: now, attributes: feature.attributes }
      opened++
    }
  }

  snapshot.last_updated = now

  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')

  console.log(`Done. opened=${opened} closed=${closed} reopened=${reopened} total_open=${Object.keys(snapshot.open).length} total_closed=${Object.keys(snapshot.closed).length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
