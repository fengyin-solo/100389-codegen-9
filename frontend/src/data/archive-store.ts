import { resetAllRows } from './local-store'

// 交档看板专用持久化：校核通过后真实生成的跨模块清单放在这里，和业务登记数据分开存。
const ARCHIVE_KEY = 'field-archaeology-digital:drawing-handover:v1'

/** 影像补拍清单条目：指向影像记录模块，补拍完成后回写影像模块状态。 */
export type ReshootItem = {
  id: number
  drawingNo: string
  drawingObject: string
  photoNo: string
  photoType: string
  direction: string
  reason: string
  status: '待补拍' | '已补拍'
  createdAt: string
  resolvedAt: string
  /** true 表示校核时在影像模块都查不到对应档案，是随清单一并登记进影像模块的。 */
  photoCreated: boolean
}

/** 遗迹归档清单条目：指向遗迹单位模块，归档完成后把遗迹推进到「已归档」。 */
export type ArchiveItem = {
  id: number
  drawingNo: string
  featureNo: string
  trenchNo: string
  featureType: string
  scale: string
  version: number
  opinion: string
  status: '待归档' | '已归档'
  createdAt: string
  resolvedAt: string
  /** 图纸版本与校核意见冲突时记录裁决结论；无冲突为空。 */
  versionNote: string
}

export type HandoverState = {
  reshoots: ReshootItem[]
  archives: ArchiveItem[]
  seq: number
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 初始示例清单：DRAW-0003 校核通过后已生成（影像只有一张未归档的 H05，故需补拍）。
export function seedHandover(): HandoverState {
  return {
    reshoots: [
      {
        id: 1,
        drawingNo: 'DRAW-0003',
        drawingObject: 'H05',
        photoNo: 'PHOT-0002',
        photoType: '遗迹照片',
        direction: '由南向北',
        reason: '校核通过：影像档案未归档，按交档要求补拍归档照',
        status: '待补拍',
        createdAt: '2026-09-27',
        resolvedAt: '',
        photoCreated: false,
      },
    ],
    archives: [
      {
        id: 2,
        drawingNo: 'DRAW-0003',
        featureNo: 'H05',
        trenchNo: 'T0101',
        featureType: '灰坑',
        scale: '1:20',
        version: 1,
        opinion: '通过',
        status: '待归档',
        createdAt: '2026-09-27',
        resolvedAt: '',
        versionNote: '',
      },
    ],
    seq: 2,
  }
}

let cache: HandoverState | null = null

function read(): HandoverState {
  if (cache) {
    return cache
  }
  const fallback = seedHandover()
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = fallback
    return cache
  }
  const raw = window.localStorage.getItem(ARCHIVE_KEY)
  if (!raw) {
    cache = fallback
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(cache))
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as HandoverState
    cache = { reshoots: parsed.reshoots ?? [], archives: parsed.archives ?? [], seq: parsed.seq ?? 0 }
  } catch {
    cache = fallback
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(cache))
  }
  return cache
}

function persist(state: HandoverState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(state))
  }
}

export function loadHandover(): HandoverState {
  return clone(read())
}

export function saveHandover(state: HandoverState): HandoverState {
  persist(state)
  return clone(state)
}

export function resetHandover(): HandoverState {
  const fresh = seedHandover()
  persist(fresh)
  return clone(fresh)
}

export function handoverKey(): string {
  return ARCHIVE_KEY
}

/** 交档看板连带把业务登记数据整体恢复到示例状态：跨模块回位用。 */
export function resetAllToSeed(): void {
  resetAllRows()
}

// ---- 看板需要的跨模块读取/回写统一走 src/api/handover-board.ts ----

export function stampToday(): string {
  return today()
}
