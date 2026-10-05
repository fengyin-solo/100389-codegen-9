import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import {
  loadHandover,
  resetAllToSeed,
  resetHandover,
  saveHandover,
  stampToday,
} from '@/data/archive-store'
import type { ActionResult, EntryRow } from '@/data/types'
import type { ArchiveItem, HandoverState, ReshootItem } from '@/data/archive-store'

export type DrawingRow = EntryRow

/** 需补图的遗迹：已进入完绘/解剖阶段但还没有校核通过图纸的遗迹。 */
export type FeatureGap = {
  featureNo: string
  trenchNo: string
  featureType: string
  status: string
  reason: string
}

/** 需补图的探方：发掘中/已到底但还没有校核通过图纸的探方。 */
export type TrenchGap = {
  trenchNo: string
  area: string
  status: string
  reason: string
}

/** 需补拍的影像：已有校核通过图纸，但图纸对象在影像模块没有已归档影像。 */
export type PhotoGap = {
  drawingNo: string
  drawingObject: string
  drawingType: string
  photoType: string
  photoStatusLabel: string
  reason: string
}

export type BoardView = {
  drawings: EntryRow[]
  featureGaps: FeatureGap[]
  trenchGaps: TrenchGap[]
  photoGaps: PhotoGap[]
  reshoots: ReshootItem[]
  archives: ArchiveItem[]
  stats: {
    total: number
    drawing: number
    checking: number
    approved: number
    digitized: number
    gapFeatures: number
    gapTrenches: number
    gapPhotos: number
    pendingReshoots: number
    pendingArchives: number
  }
}

const DRAWING_STATUSES = MODULE_BY_KEY.get('drawing')!.statuses
const DRAWING_TRANSITIONS = MODULE_BY_KEY.get('drawing')!.transitions!

// 遗迹到了这些阶段就应该已经有校核通过的图纸
const FEATURE_DUE_STATUSES = ['已完绘', '已解剖', '已归档']
const TRENCH_DUE_STATUSES = ['发掘中', '已到底', '已回填']

function drawings(): EntryRow[] {
  return listRows('drawing')
}

function findDrawing(id: number): EntryRow | undefined {
  return drawings().find((row) => Number(row.id) === id)
}

function persistDrawings(rows: EntryRow[]): void {
  saveRows('drawing', rows)
}

/** 已校核或已数字化的图纸都算「校核通过」，历史图纸持续有效。 */
function approvedDrawingNos(): Set<string> {
  const set = new Set<string>()
  for (const row of drawings()) {
    if (row.status === '已校核' || row.status === '已数字化') {
      set.add(String(row['图纸编号']))
    }
  }
  return set
}

/** 图纸编号 -> 最新校核通过图纸（同对象多版取校核通过的最高版本）。 */
function approvedDrawingsByObject(): Map<string, EntryRow> {
  const map = new Map<string, EntryRow>()
  for (const row of drawings()) {
    if (row.status !== '已校核' && row.status !== '已数字化') {
      continue
    }
    const object = String(row['绘图对象'])
    const prev = map.get(object)
    if (!prev || Number(row['版本'] ?? 1) > Number(prev['版本'] ?? 1)) {
      map.set(object, row)
    }
  }
  return map
}

// 严格阶段守卫：与通用 runAction 同一套白名单，看板操作再校验一次。
function guardTransition(action: string, current: string, target: string): ActionResult | null {
  if (current === target) {
    return { ok: false, message: `图纸已经是「${target}」，不用重复操作` }
  }
  const allowed = DRAWING_TRANSITIONS[action] ?? []
  if (!allowed.includes(current)) {
    const currentIndex = DRAWING_STATUSES.indexOf(current)
    const targetIndex = DRAWING_STATUSES.indexOf(target)
    if (targetIndex >= 0 && currentIndex >= 0 && targetIndex < currentIndex) {
      return { ok: false, message: `回退操作已拦下：「${current}」不能退回到「${target}」，如需返工请走「退回修改」` }
    }
    if (target === '已数字化' && current !== '已校核') {
      return { ok: false, message: `不能从「${current}」直接跳到「已数字化」：须先校核通过` }
    }
    return { ok: false, message: `状态流转不合法：「${current}」不允许执行「${action}」，请按 ${allowed.join('、')} 阶段逐步推进` }
  }
  return null
}

type DrawingPatch = {
  status?: string
  pending?: boolean
  abnormal?: boolean
  版本?: number
  校核意见?: string
}

function updateDrawing(row: EntryRow, patch: DrawingPatch): EntryRow {
  const next = drawings()
  const index = next.findIndex((item) => Number(item.id) === Number(row.id))
  if (index < 0) {
    return row
  }
  const updated: EntryRow = { ...next[index], ...patch }
  next[index] = updated
  persistDrawings(next)
  return updated
}

/** 提交校核：绘制中/需修改 -> 待校核，返工再交时版本号递增。 */
export function submitForReview(id: number): ActionResult {
  const row = findDrawing(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的图纸` }
  }
  const blocked = guardTransition('提交校核', String(row.status), '待校核')
  if (blocked) {
    return blocked
  }
  const fromRework = String(row.status) === '需修改'
  const version = fromRework ? Number(row['版本'] ?? 1) + 1 : Number(row['版本'] ?? 1)
  updateDrawing(row, {
    status: '待校核',
    版本: version,
    pending: true,
    abnormal: false,
  })
  return {
    ok: true,
    message: fromRework
      ? `图纸 ${row['图纸编号']} 修改后以 v${version} 重新提交校核（比例尺沿用底版 ${row['比例尺']}）`
      : `图纸 ${row['图纸编号']} 已提交校核，版本 v${version}`,
  }
}

/** 退回修改：仅待校核可退回，必须登记校核意见；图纸不回退到绘制中，而是进入需修改。 */
export function rejectDrawing(id: number, opinion: string): ActionResult {
  const row = findDrawing(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的图纸` }
  }
  const blocked = guardTransition('退回修改', String(row.status), '需修改')
  if (blocked) {
    return blocked
  }
  if (!opinion.trim()) {
    return { ok: false, message: '退回修改必须填写校核意见，绘图人按意见返工' }
  }
  updateDrawing(row, {
    status: '需修改',
    校核意见: opinion.trim(),
    pending: true,
    abnormal: false,
  })
  return { ok: true, message: `图纸 ${row['图纸编号']} 已退回修改，版本与比例尺保留，意见已登记` }
}

function photoTypeFor(drawingType: string): string {
  if (drawingType.includes('探方')) {
    return '探方全景'
  }
  return '遗迹照片'
}

/** 在影像模块新建一条「需重拍」档案（图纸对象此前没有任何影像记录时）。 */
function createPhotoForObject(object: string, photoType: string): EntryRow {
  const photos = listRows('photography')
  const nextId = photos.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const photo: EntryRow = {
    id: nextId,
    status: '需重拍',
    pending: true,
    abnormal: true,
    影像编号: `PHOT-${String(nextId).padStart(4, '0')}`,
    拍摄对象: object,
    拍摄类型: photoType,
    拍摄方位: '待补拍',
    拍摄日期: '',
    摄影人员: '',
    存储路径: '',
    影像状态: '需重拍',
  }
  saveRows('photography', [...photos, photo])
  return photo
}

/**
 * 确认校核：仅待校核 -> 已校核。通过后真实生成跨模块清单：
 *  - 影像补拍清单：图纸对象在影像模块没有已归档影像时建条目（没有档案就连带登记一条影像）；
 *  - 遗迹归档清单：图纸对象是遗迹时建条目，并按版本裁决规则处理比例尺冲突。
 */
export function approveDrawing(id: number, opinionInput = ''): { result: ActionResult; state: HandoverState } {
  const row = findDrawing(id)
  if (!row) {
    return { result: { ok: false, message: `没有找到编号为 ${id} 的图纸` }, state: loadHandover() }
  }
  const blocked = guardTransition('确认校核', String(row.status), '已校核')
  if (blocked) {
    return { result: blocked, state: loadHandover() }
  }

  const drawingNo = String(row['图纸编号'])
  const object = String(row['绘图对象'])
  const drawingType = String(row['绘图类型'])
  const scale = String(row['比例尺'])
  const version = Number(row['版本'] ?? 1)
  const opinion = (opinionInput.trim() || String(row['校核意见'] ?? '') || '通过')

  // 版本裁决：同一图纸编号存在多版且校核意见涉及比例尺、当前版比例尺又变了，
  // 以「最新校核通过版」为归档底图，原比例尺作为历史版保留兼容，不回算不重绘。
  const siblingVersions = drawings()
    .filter((item) => String(item['图纸编号']) === drawingNo)
    .map((item) => Number(item['版本'] ?? 1))
  const scaleChangedInRework =
    version > 1 && /比例|尺寸|标注|比例[尺]/.test(opinion) && siblingVersions.length > 0
  const versionNote = scaleChangedInRework
    ? `版本冲突裁决：以最新校核通过版 v${version}（${scale}）为归档底图；历史版本按原比例尺保留兼容，不回算重绘；校核意见随图归档`
    : ''

  updateDrawing(row, {
    status: '已校核',
    校核意见: opinion || '通过',
    pending: false,
    abnormal: false,
  })

  const state = loadHandover()
  const notes: string[] = []

  // —— 真实生成：影像补拍清单 ——
  const photos = listRows('photography')
  const archived = photos.some(
    (photo) => String(photo['拍摄对象']) === object && photo.status === '已归档',
  )
  if (!archived) {
    const exists = state.reshoots.some(
      (item) => item.drawingNo === drawingNo && item.status === '待补拍',
    )
    if (!exists) {
      const photoType = photoTypeFor(drawingType)
      let photo = photos.find((item) => String(item['拍摄对象']) === object)
      let created = false
      if (!photo) {
        photo = createPhotoForObject(object, photoType)
        created = true
      }
      state.seq += 1
      state.reshoots.push({
        id: state.seq,
        drawingNo,
        drawingObject: object,
        photoNo: String(photo['影像编号']),
        photoType: photoType,
        direction: String(photo['拍摄方位'] ?? ''),
        reason: created
          ? '校核通过：影像模块无该对象档案，已登记影像并要求补拍归档照'
          : `校核通过：现有影像「${photo['影像状态']}」未归档，需补拍归档照`,
        status: '待补拍',
        createdAt: stampToday(),
        resolvedAt: '',
        photoCreated: created,
      })
      notes.push(
        created
          ? `影像补拍清单 +1（${photo['影像编号']} 为跨模块新登记）`
          : `影像补拍清单 +1（${photo['影像编号']}）`,
      )
    }
  }

  // —— 真实生成：遗迹归档清单 ——
  const feature = listRows('feature').find((item) => String(item['遗迹编号']) === object)
  if (feature) {
    const exists = state.archives.some(
      (item) => item.drawingNo === drawingNo && item.status === '待归档',
    )
    if (!exists) {
      state.seq += 1
      state.archives.push({
        id: state.seq,
        drawingNo,
        featureNo: object,
        trenchNo: String(feature['所属探方'] ?? ''),
        featureType: String(feature['遗迹类型'] ?? ''),
        scale,
        version,
        opinion: opinion || '通过',
        status: '待归档',
        createdAt: stampToday(),
        resolvedAt: '',
        versionNote,
      })
      notes.push(`遗迹归档清单 +1（${object}）`)
    }
  }

  saveHandover(state)
  return {
    result: {
      ok: true,
      message:
        `图纸 ${drawingNo} 校核通过（v${version}，${scale}）。` +
        (notes.length ? notes.join('；') : '两份清单均无需新增（影像已归档、对象非遗迹）'),
    },
    state,
  }
}

/** 完成数字化：仅已校核 -> 已数字化，禁止越级。 */
export function digitizeDrawing(id: number): ActionResult {
  const row = findDrawing(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的图纸` }
  }
  const blocked = guardTransition('完成数字化', String(row.status), '已数字化')
  if (blocked) {
    return blocked
  }
  updateDrawing(row, { status: '已数字化', pending: false, abnormal: false })
  return { ok: true, message: `图纸 ${row['图纸编号']} 已数字化入库` }
}

/** 补拍完成：清单条目回写影像模块为「已归档」，再置为已补拍。 */
export function completeReshoot(id: number): ActionResult {
  const state = loadHandover()
  const item = state.reshoots.find((entry) => entry.id === id)
  if (!item) {
    return { ok: false, message: `没有找到编号为 ${id} 的补拍条目` }
  }
  if (item.status === '已补拍') {
    return { ok: false, message: '该条目已补拍完成' }
  }
  const photos = listRows('photography')
  const index = photos.findIndex((photo) => String(photo['影像编号']) === item.photoNo)
  if (index >= 0) {
    photos[index] = {
      ...photos[index],
      status: '已归档',
      pending: false,
      abnormal: false,
      影像状态: '已归档',
      拍摄日期: photos[index]['拍摄日期'] || stampToday(),
    }
    saveRows('photography', photos)
  }
  item.status = '已补拍'
  item.resolvedAt = stampToday()
  saveHandover(state)
  return { ok: true, message: `影像 ${item.photoNo} 已补拍并在影像模块归档，补拍清单闭环` }
}

/** 遗迹归档：清单条目回写遗迹模块为「已归档」。 */
export function completeArchive(id: number): ActionResult {
  const state = loadHandover()
  const item = state.archives.find((entry) => entry.id === id)
  if (!item) {
    return { ok: false, message: `没有找到编号为 ${id} 的归档条目` }
  }
  if (item.status === '已归档') {
    return { ok: false, message: '该遗迹已归档' }
  }
  const features = listRows('feature')
  const index = features.findIndex((feature) => String(feature['遗迹编号']) === item.featureNo)
  if (index >= 0) {
    features[index] = { ...features[index], status: '已归档', pending: false, abnormal: false }
    saveRows('feature', features)
  }
  item.status = '已归档'
  item.resolvedAt = stampToday()
  saveHandover(state)
  return { ok: true, message: `遗迹 ${item.featureNo} 已在遗迹单位模块归档，归档清单闭环` }
}

function computeFeatureGaps(approved: Set<string>): FeatureGap[] {
  const gaps: FeatureGap[] = []
  for (const feature of listRows('feature')) {
    const status = String(feature.status)
    if (!FEATURE_DUE_STATUSES.includes(status) || status === '已归档') {
      continue
    }
    const covered = drawings().some(
      (drawing) =>
        String(drawing['绘图对象']) === String(feature['遗迹编号']) &&
        approved.has(String(drawing['图纸编号'])),
    )
    if (!covered) {
      gaps.push({
        featureNo: String(feature['遗迹编号']),
        trenchNo: String(feature['所属探方'] ?? ''),
        featureType: String(feature['遗迹类型'] ?? ''),
        status,
        reason: `${status}但尚无校核通过的图纸`,
      })
    }
  }
  return gaps
}

function computeTrenchGaps(approved: Set<string>): TrenchGap[] {
  const gaps: TrenchGap[] = []
  for (const trench of listRows('trench')) {
    const status = String(trench.status)
    if (!TRENCH_DUE_STATUSES.includes(status)) {
      continue
    }
    const covered = drawings().some(
      (drawing) =>
        String(drawing['绘图对象']) === String(trench['探方编号']) &&
        approved.has(String(drawing['图纸编号'])),
    )
    if (!covered) {
      gaps.push({
        trenchNo: String(trench['探方编号']),
        area: String(trench['所属发掘区'] ?? ''),
        status,
        reason: `${status}但尚无校核通过的探方图`,
      })
    }
  }
  return gaps
}

function computePhotoGaps(): PhotoGap[] {
  const gaps: PhotoGap[] = []
  const byObject = approvedDrawingsByObject()
  for (const [object, drawing] of byObject) {
    const photos = listRows('photography')
    const archived = photos.some(
      (photo) => String(photo['拍摄对象']) === object && photo.status === '已归档',
    )
    if (archived) {
      continue
    }
    const current = photos.find((photo) => String(photo['拍摄对象']) === object)
    gaps.push({
      drawingNo: String(drawing['图纸编号']),
      drawingObject: object,
      drawingType: String(drawing['绘图类型']),
      photoType: photoTypeFor(String(drawing['绘图类型'])),
      photoStatusLabel: current ? String(current['影像状态']) : '影像模块无档案',
      reason: current
        ? `图纸已校核通过，但影像仍为「${current['影像状态']}」`
        : '图纸已校核通过，影像模块尚无该对象档案',
    })
  }
  return gaps
}

export function loadBoard(): BoardView {
  const rows = drawings()
  const approved = approvedDrawingNos()
  const state = loadHandover()
  const featureGaps = computeFeatureGaps(approved)
  const trenchGaps = computeTrenchGaps(approved)
  const photoGaps = computePhotoGaps()
  return {
    drawings: rows,
    featureGaps,
    trenchGaps,
    photoGaps,
    reshoots: state.reshoots,
    archives: state.archives,
    stats: {
      total: rows.length,
      drawing: rows.filter((row) => row.status === '绘制中').length,
      checking: rows.filter((row) => row.status === '待校核' || row.status === '需修改').length,
      approved: rows.filter((row) => row.status === '已校核').length,
      digitized: rows.filter((row) => row.status === '已数字化').length,
      gapFeatures: featureGaps.length,
      gapTrenches: trenchGaps.length,
      gapPhotos: photoGaps.length,
      pendingReshoots: state.reshoots.filter((item) => item.status === '待补拍').length,
      pendingArchives: state.archives.filter((item) => item.status === '待归档').length,
    },
  }
}

function csv(rows: (string | number)[][]): string {
  const escape = (value: string | number) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return `﻿${rows.map((line) => line.map(escape).join(',')).join('\n')}`
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const blob = new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function exportReshoots(items: ReshootItem[]): void {
  downloadCsv('影像补拍清单.csv', [
    ['图纸编号', '绘图对象', '影像编号', '影像类型', '拍摄方位', '生成原因', '状态', '生成日期', '完成日期'],
    ...items.map((item) => [
      item.drawingNo,
      item.drawingObject,
      item.photoNo,
      item.photoType,
      item.direction,
      item.reason,
      item.status,
      item.createdAt,
      item.resolvedAt,
    ]),
  ])
}

export function exportArchives(items: ArchiveItem[]): void {
  downloadCsv('遗迹归档清单.csv', [
    ['图纸编号', '遗迹编号', '所属探方', '遗迹类型', '采用比例尺', '采用版本', '校核意见', '版本裁决', '状态', '生成日期', '归档日期'],
    ...items.map((item) => [
      item.drawingNo,
      item.featureNo,
      item.trenchNo,
      item.featureType,
      item.scale,
      `v${item.version}`,
      item.opinion,
      item.versionNote,
      item.status,
      item.createdAt,
      item.resolvedAt,
    ]),
  ])
}

/** 恢复演示：业务登记数据与交档清单一起回到示例状态。 */
export function resetDemo(): void {
  resetAllToSeed()
  resetHandover()
}
