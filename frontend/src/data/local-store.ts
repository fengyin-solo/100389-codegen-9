import { SEED_ROWS } from './seed'
import { SEED_DRAWING_BOARD } from './board-seed'
import type { DrawingBoardStore } from './drawing-board-types'
import type { EntryRow } from './types'

// 本地持久化：业务条目放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'
// 实测绘图交档看板的版本、校核意见、补拍/归档清单单独占一个命名空间。
const BOARD_KEY = 'field-archaeology-digital:drawing-board'
// 示例数据结构调整后整体重新播种：旧版占位数据无法支撑跨模块关联，直接升级。
const SCHEMA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type PersistedBundle = {
  version: number
  entries: Record<string, EntryRow[]>
}

function writeEntries(entries: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    const bundle: PersistedBundle = { version: SCHEMA_VERSION, entries }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    writeEntries(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as PersistedBundle | Record<string, EntryRow[]>
    // 兼容 v1：没有版本包裹层时按旧结构读取，同时检测示例数据是否需要升级。
    if (!('version' in parsed)) {
      writeEntries(fallback)
      return fallback
    }
    const bundle = parsed as PersistedBundle
    if (bundle.version !== SCHEMA_VERSION) {
      writeEntries(fallback)
      return fallback
    }
    const seeded: Record<string, EntryRow[]> = clone(SEED_ROWS)
    const stored: Record<string, EntryRow[]> = clone(bundle.entries)
    return { ...seeded, ...stored }
  } catch {
    writeEntries(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  writeEntries(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// ---- 实测绘图交档看板数据（版本、校核意见、跨模块清单） ----

function readBoard(): DrawingBoardStore {
  const fallback = clone(SEED_DRAWING_BOARD)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(BOARD_KEY)
  if (!raw) {
    window.localStorage.setItem(BOARD_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<DrawingBoardStore>) }
  } catch {
    window.localStorage.setItem(BOARD_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let boardCache: DrawingBoardStore | null = null

export function loadBoard(): DrawingBoardStore {
  if (boardCache === null) {
    boardCache = readBoard()
  }
  return boardCache
}

export function saveBoard(store: DrawingBoardStore): void {
  boardCache = store
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(BOARD_KEY, JSON.stringify(store))
  }
}

export function resetBoard(): DrawingBoardStore {
  const fresh = clone(SEED_DRAWING_BOARD)
  saveBoard(fresh)
  return fresh
}
