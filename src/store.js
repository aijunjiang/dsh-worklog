/**
 * dsh-worklog 持久化存储：一个 items.json 文件保存全部工作记录。
 * 位置默认 ${DSH_HOME:-~/.dsh}/dsh-worklog/items.json。
 * 原子写（同目录临时文件 + rename），启动时全量载入内存。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function defaultBaseDir() {
  const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')
  return join(home, 'dsh-worklog')
}

export function createStore(baseDir) {
  mkdirSync(baseDir, { recursive: true })
  const file = join(baseDir, 'items.json')

  /** @type {Record<string, object>} sessionId → item */
  let items = {}
  let meta = { schema: 1, lastScanMs: 0, lastSummaryMs: 0 }
  let saveTimer = null

  function load() {
    try {
      if (!existsSync(file)) return
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      if (raw && typeof raw === 'object') {
        if (raw.items && typeof raw.items === 'object') items = raw.items
        if (raw.meta && typeof raw.meta === 'object') meta = { ...meta, ...raw.meta }
      }
    } catch (e) {
      // 存储损坏时从空库开始，不抛给上层
      items = {}
      meta = { schema: 1, lastScanMs: 0, lastSummaryMs: 0 }
    }
  }

  /** 防抖落盘。 */
  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      flush()
    }, 800)
  }

  function flush() {
    const tmp = `${file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify({ schema: 1, meta, items }, null, 2), 'utf8')
      renameSync(tmp, file)
    } catch (e) {
      // 保留内存态；下次扫描会再试
    }
  }

  function all() {
    return Object.values(items)
  }

  function get(sessionId) {
    return items[sessionId] || null
  }

  function upsert(sessionId, next) {
    items[sessionId] = next
    scheduleSave()
  }

  function patch(sessionId, fields) {
    const cur = items[sessionId] || {}
    items[sessionId] = { ...cur, ...fields }
    scheduleSave()
  }

  function remove(sessionId) {
    if (items[sessionId]) {
      delete items[sessionId]
      scheduleSave()
    }
  }

  load()
  return {
    baseDir,
    file,
    all,
    get,
    upsert,
    patch,
    remove,
    flush,
    getMeta: () => meta,
    setMeta(fields) {
      meta = { ...meta, ...fields }
      scheduleSave()
    },
  }
}
