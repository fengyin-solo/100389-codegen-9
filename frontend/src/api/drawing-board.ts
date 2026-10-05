import { canTransition, moduleMeta, transitionEntry } from '@/api/local-service'
import { listRows, loadBoard, resetBoard, resetRows, saveBoard } from '@/data/local-store'
import type {
  ArchiveItem,
  DrawingBoardStore,
  DrawingReview,
  DrawingVersion,
  ReshootItem,
} from '@/data/drawing-board-types'
import type { ActionResult, EntryRow } from '@/data/types'

const DRAWING_KEY = 'drawing'
const FEATURE_KEY = 'feature'
const PHOTO_KEY = 'photography'
const TRENCH_KEY = 'trench'
const drawingMeta = moduleMeta(DRAWING_KEY)

// 校核阶段按状态机口径展示，避免直接按状态数组下标（已数字化与需修改的顺序不代表流程）。
const STAGE_OF_STATUS: Record<string, string> = {
  绘制中: '①绘制',
  需修改: '①绘制（退回修改）',
  待校核: '②待校核',
  已校核: '③校核通过·待数字化',
  已数字化: '④已数字化交档',
}

// 从绘图对象里解析跨模块编号：FEAT-0003 / FEAT0003 遗迹、T0103 探方、DRAW-0017 图纸。
const CODE_PATTERN = /(?:FEAT|T|DRAW)-?\d{4}/gi

function normalizeCode(code: string): string {
  return code.replace(/-/g, '').toUpperCase()
}

export function parseRefs(text: string): { features: string[]; trenches: string[]; drawings: string[] } {
  const hits = text.match(CODE_PATTERN) ?? []
  const features = new Set<string>()
  const trenches = new Set<string>()
  const drawings = new Set<string>()
  for (const raw of hits) {
    const code = normalizeCode(raw)
    if (code.startsWith('FEAT')) features.add(code)
    else if (code.startsWith('DRAW')) drawings.add(code)
    else if (code.startsWith('T')) trenches.add(code)
  }
  return { features: [...features], trenches: [...trenches], drawings: [...drawings] }
}

function rowCode(row: EntryRow, fields: string[]): string {
  for (const field of fields) {
    const value = row[field]
    if (typeof value !== 'string') continue
    const match = value.match(CODE_PATTERN)
    if (match) {
      return normalizeCode(match[0])
    }
  }
  return ''
}

function featureCode(row: EntryRow): string {
  return rowCode(row, ['遗迹编号'])
}

function trenchCode(row: EntryRow): string {
  return rowCode(row, ['探方编号'])
}

// 影像按「拍摄对象」里出现的图纸/遗迹/探方编号与图纸关联。
function photoMatches(row: EntryRow, refs: ReturnType<typeof parseRefs>): boolean {
  const subject = String(row['拍摄对象'] ?? '')
  const photoRefs = parseRefs(subject)
  const target = new Set([...refs.features, ...refs.trenches, ...refs.drawings])
  return [...photoRefs.features, ...photoRefs.trenches, ...photoRefs.drawings].some((code) => target.has(code))
}

function findFeature(code: string): EntryRow | undefined {
  return listRows(FEATURE_KEY).find((row) => featureCode(row) === code)
}

function findTrench(code: string): EntryRow | undefined {
  return listRows(TRENCH_KEY).find((row) => trenchCode(row) === code)
}

function linkedPhotos(refs: ReturnType<typeof parseRefs>): EntryRow[] {
  return listRows(PHOTO_KEY).filter((row) => photoMatches(row, refs))
}

// 图纸引用到的探方：优先用关联遗迹的所属探方补齐（如 H3 → T0103）。
function refsWithFeatureTrenches(refs: ReturnType<typeof parseRefs>): ReturnType<typeof parseRefs> {
  const trenches = new Set(refs.trenches)
  for (const code of refs.features) {
    const feature = findFeature(code)
    if (feature) {
      const trench = parseRefs(String(feature['所属探方'] ?? '')).trenches
      trench.forEach((item) => trenches.add(item))
    }
  }
  return { ...refs, trenches: [...trenches] }
}

export type BoardRow = {
  drawing: EntryRow
  stage: string
  latest: DrawingVersion | null
  versions: DrawingVersion[]
  openReview: DrawingReview | null
  refs: ReturnType<typeof parseRefs>
  pendingFeatures: EntryRow[]
  pendingTrenches: EntryRow[]
  pendingPhotos: { kind: '需重拍影像' | '影像缺口'; photo?: EntryRow; label: string }[]
}

export type BoardAggregate = {
  rows: BoardRow[]
  pending: {
    features: { feature: EntryRow; drawings: EntryRow[] }[]
    trenches: { trench: EntryRow; drawings: EntryRow[] }[]
    photos: { kind: '需重拍影像' | '影像缺口'; photo?: EntryRow; label: string; drawings: EntryRow[] }[]
  }
  reshootItems: ReshootItem[]
  archiveItems: ArchiveItem[]
}

function isOpenStage(status: string): boolean {
  return status === '绘制中' || status === '待校核' || status === '需修改' || status === '已校核'
}

function buildBoardRow(drawing: EntryRow, store: DrawingBoardStore): BoardRow {
  const rawRefs = refsWithFeatureTrenches(parseRefs(String(drawing['绘图对象'] ?? '')))
  const versions = store.versions.filter((item) => item.drawingId === Number(drawing.id))
  const latest = versions.length ? versions[versions.length - 1] : null
  const openReview = latest
    ? store.reviews.find((item) => item.drawingId === Number(drawing.id) && item.version === latest.version && (item.state === 'active' || item.state === 'rejected')) ?? null
    : null

  // 「需要补图」按校核阶段实时判定：未到数字化的图纸，关联遗迹/探方即为补图对象；
  // 影像一栏额外列出被安排重拍的影像和完全没有影像记录的缺口。
  const open = isOpenStage(String(drawing.status))
  const pendingFeatures = open
    ? rawRefs.features.map(findFeature).filter((item): item is EntryRow => Boolean(item))
    : []
  const pendingTrenches = open
    ? rawRefs.trenches.map(findTrench).filter((item): item is EntryRow => Boolean(item))
    : []

  const pendingPhotos: BoardRow['pendingPhotos'] = []
  if (open) {
    const photos = linkedPhotos(rawRefs)
    for (const photo of photos) {
      if (String(photo.status) === '需重拍') {
        pendingPhotos.push({ kind: '需重拍影像', photo, label: `${photo['影像编号']} ${photo['拍摄对象']}` })
      }
    }
    // 缺口按每个引用对象分别判定：同探方其它遗迹有影像，不能掩盖本遗迹/本探方没有影像。
    for (const code of [...rawRefs.features, ...rawRefs.trenches]) {
      const own = photos.filter((photo) => {
        const refs = parseRefs(String(photo['拍摄对象'] ?? ''))
        return refs.features.includes(code) || refs.trenches.includes(code) || refs.drawings.includes(code)
      })
      if (!own.some((photo) => String(photo.status) !== '需重拍')) {
        pendingPhotos.push({
          kind: '影像缺口',
          label: own.length ? `${code} 关联影像全部需重拍` : `${code} 无影像记录`,
        })
      }
    }
  }

  return {
    drawing,
    stage: STAGE_OF_STATUS[String(drawing.status)] ?? String(drawing.status),
    latest,
    versions,
    openReview,
    refs: rawRefs,
    pendingFeatures,
    pendingTrenches,
    pendingPhotos,
  }
}

export function loadDrawingBoard(): BoardAggregate {
  const store = loadBoard()
  const rows = listRows(DRAWING_KEY).map((drawing) => buildBoardRow(drawing, store))

  const features = new Map<string, { feature: EntryRow; drawings: EntryRow[] }>()
  for (const row of rows) {
    for (const feature of row.pendingFeatures) {
      const code = featureCode(feature)
      const bucket = features.get(code) ?? { feature, drawings: [] }
      bucket.drawings.push(row.drawing)
      features.set(code, bucket)
    }
  }
  const trenches = new Map<string, { trench: EntryRow; drawings: EntryRow[] }>()
  for (const row of rows) {
    for (const trench of row.pendingTrenches) {
      const code = trenchCode(trench)
      const bucket = trenches.get(code) ?? { trench, drawings: [] }
      bucket.drawings.push(row.drawing)
      trenches.set(code, bucket)
    }
  }
  const photos = new Map<string, { kind: '需重拍影像' | '影像缺口'; photo?: EntryRow; label: string; drawings: EntryRow[] }>()
  for (const row of rows) {
    for (const item of row.pendingPhotos) {
      const key = item.photo ? `photo-${item.photo.id}` : `gap-${row.drawing.id}`
      const bucket = photos.get(key) ?? { kind: item.kind, photo: item.photo, label: item.label, drawings: [] }
      bucket.drawings.push(row.drawing)
      photos.set(key, bucket)
    }
  }

  return {
    rows,
    pending: {
      features: [...features.values()],
      trenches: [...trenches.values()],
      photos: [...photos.values()],
    },
    reshootItems: store.reshootItems,
    archiveItems: store.archiveItems,
  }
}

// ---- 版本与校核意见 ----

export function versionHistory(drawingId: number): DrawingVersion[] {
  return loadBoard().versions.filter((item) => item.drawingId === drawingId)
}

export function reviewHistory(drawingId: number): DrawingReview[] {
  return loadBoard().reviews.filter((item) => item.drawingId === drawingId)
}

function nextSeq(store: DrawingBoardStore, key: keyof DrawingBoardStore['seq']): number {
  store.seq[key] += 1
  return store.seq[key]
}

function drawingNo(drawing: EntryRow): string {
  return String(drawing['图纸编号'] ?? drawing.id)
}

function persist(store: DrawingBoardStore): void {
  saveBoard(store)
}

// 校核通过时真正落库的两份跨模块清单：影像补拍清单 + 遗迹归档清单。
function buildCheckLists(
  store: DrawingBoardStore,
  drawing: EntryRow,
  version: DrawingVersion,
): { reshoot: ReshootItem[]; archive: ArchiveItem[] } {
  const refs = refsWithFeatureTrenches(parseRefs(String(drawing['绘图对象'] ?? '')))
  const no = drawingNo(drawing)
  const reshoot: ReshootItem[] = []
  const activeKeys = new Set(
    store.reshootItems
      .filter((item) => item.status === '待补拍')
      .map((item) => `${item.kind}-${item.photoId ?? item.subject}`),
  )

  for (const photo of linkedPhotos(refs)) {
    if (String(photo.status) !== '需重拍') continue
    const key = `需重拍影像-${photo.id}`
    if (activeKeys.has(key)) continue
    reshoot.push({
      id: nextSeq(store, 'reshoot'),
      kind: '需重拍影像',
      drawingId: Number(drawing.id),
      drawingNo: no,
      subject: String(photo['拍摄对象'] ?? ''),
      photoId: Number(photo.id),
      photoNo: String(photo['影像编号'] ?? ''),
      reason: '校核通过：该影像已安排重拍，需按图纸范围补拍到位。',
      requiredScale: version.scale,
      status: '待补拍',
      createdAt: version.submittedAt,
      resolvedAt: '',
    })
    activeKeys.add(key)
  }

  // 影像缺口：按每个引用对象分别判定，没有任何一张正常影像即生成补拍任务。
  const photos = linkedPhotos(refs)
  for (const code of [...refs.features, ...refs.trenches]) {
    const own = photos.filter((photo) => {
      const photoRefs = parseRefs(String(photo['拍摄对象'] ?? ''))
      return photoRefs.features.includes(code) || photoRefs.trenches.includes(code) || photoRefs.drawings.includes(code)
    })
    if (own.some((photo) => String(photo.status) !== '需重拍')) continue
    const subject = refs.features.includes(code)
      ? `${code}（${findFeature(code)?.['遗迹类型'] ?? '遗迹'}）`
      : `探方 ${code} 全景`
    const key = `影像缺口-${subject}`
    if (activeKeys.has(key)) continue
    reshoot.push({
      id: nextSeq(store, 'reshoot'),
      kind: '影像缺口',
      drawingId: Number(drawing.id),
      drawingNo: no,
      subject,
      photoId: null,
      photoNo: null,
      reason: '校核交档要求影像齐备，但未找到对应影像记录，需补拍。',
      requiredScale: refs.features.includes(code) ? version.scale : '全景照（不套图纸比例尺）',
      status: '待补拍',
      createdAt: version.submittedAt,
      resolvedAt: '',
    })
    activeKeys.add(key)
  }

  const archive: ArchiveItem[] = []
  const activeArchive = new Set(
    store.archiveItems.map((item) => `${item.featureId}`),
  )
  for (const code of refs.features) {
    const feature = findFeature(code)
    if (!feature || activeArchive.has(String(feature.id))) continue
    archive.push({
      id: nextSeq(store, 'archive'),
      drawingId: Number(drawing.id),
      drawingNo: no,
      featureId: Number(feature.id),
      featureNo: String(feature['遗迹编号'] ?? code),
      trenchNo: String(feature['所属探方'] ?? parseRefs(String(feature['所属探方'] ?? '')).trenches.join('、')),
      featureType: String(feature['遗迹类型'] ?? ''),
      version: version.version,
      // 历史图纸兼容：归档清单按生成清单时的版本原比例尺记录，后续数字化也不换算。
      scale: version.scale,
      status: '待归档',
      createdAt: version.submittedAt,
      resolvedAt: '',
    })
    activeArchive.add(String(feature.id))
  }

  return { reshoot, archive }
}

type ActionOutcome = ActionResult & { created?: { reshoot: number; archive: number } }

// 提交校核：绘制中/需修改 → 待校核；退回后重交自动生成新版本，旧退回意见标记为被覆盖。
export function submitForReview(drawingId: number, scale: string, changeNote: string, operator: string): ActionOutcome {
  const store = loadBoard()
  const drawing = listRows(DRAWING_KEY).find((row) => Number(row.id) === drawingId)
  if (!drawing) return { ok: false, message: '没有找到对应图纸' }

  if (!canTransition(drawingMeta, '提交校核', String(drawing.status))) {
    return {
      ok: false,
      message: `状态流转被拦截：图纸当前为「${drawing.status}」，不能重复提交校核`,
    }
  }

  const priorVersions = store.versions.filter((item) => item.drawingId === drawingId)
  const resubmit = priorVersions.length > 0
  const version = resubmit ? priorVersions[priorVersions.length - 1].version + 1 : 1
  const today = new Date().toISOString().slice(0, 10)
  store.versions.push({
    drawingId,
    version,
    scale: scale.trim() || '1:20',
    changeNote: changeNote.trim() || (resubmit ? `按校核意见修改后第 ${version} 版重交` : '初版提交'),
    submittedAt: today,
  })

  if (resubmit) {
    // 版本裁定：以最新提交版本为准，旧版本上未结案的退回意见被新版本覆盖，留痕但不再阻断。
    for (const review of store.reviews) {
      if (review.drawingId === drawingId && review.state === 'rejected') {
        review.state = 'superseded'
      }
    }
  }
  store.reviews.push({
    id: nextSeq(store, 'review'),
    drawingId,
    version,
    state: 'active',
    comment: resubmit ? `${operator} 重新提交第 ${version} 版校核。` : `${operator} 提交校核。`,
    reviewer: operator,
    createdAt: today,
  })
  // 先写版本/意见，再走统一状态机拦截入口落状态。
  persist(store)
  const result = transitionEntry(DRAWING_KEY, drawingId, '提交校核', {
    patch: { 比例尺: scale.trim() || '1:20', 校核人: drawing['校核人'] || operator },
  })
  if (!result.ok) {
    return { ok: false, message: result.message }
  }
  return {
    ok: true,
    message: resubmit
      ? `已生成第 ${version} 版（比例尺 ${scale}）并提交校核；旧版本退回意见已标记为被新版本覆盖，以本版为准`
      : `第 1 版（比例尺 ${scale}）已提交校核`,
  }
}

// 确认校核：待校核 → 已校核，同时生成跨模块补拍清单与遗迹归档清单。
export function approveReview(drawingId: number, comment: string, reviewer: string): ActionOutcome {
  const store = loadBoard()
  const drawing = listRows(DRAWING_KEY).find((row) => Number(row.id) === drawingId)
  if (!drawing) return { ok: false, message: '没有找到对应图纸' }
  if (!canTransition(drawingMeta, '确认校核', String(drawing.status))) {
    return {
      ok: false,
      message: `状态流转被拦截：图纸当前为「${drawing.status}」，只有待校核阶段能确认校核`,
    }
  }
  const versions = store.versions.filter((item) => item.drawingId === drawingId)
  const latest = versions[versions.length - 1]
  if (!latest) return { ok: false, message: '缺少版本记录，无法确认校核' }

  const today = new Date().toISOString().slice(0, 10)
  const open = store.reviews.find(
    (item) => item.drawingId === drawingId && item.version === latest.version && item.state === 'active',
  )
  if (open) {
    open.state = 'passed'
    if (comment.trim()) open.comment = comment.trim()
  } else {
    store.reviews.push({
      id: nextSeq(store, 'review'),
      drawingId,
      version: latest.version,
      state: 'passed',
      comment: comment.trim() || '校核通过。',
      reviewer,
      createdAt: today,
    })
  }

  const lists = buildCheckLists(store, drawing, latest)
  store.reshootItems.push(...lists.reshoot)
  store.archiveItems.push(...lists.archive)
  persist(store)

  const result = transitionEntry(DRAWING_KEY, drawingId, '确认校核', { patch: { 校核人: reviewer } })
  if (!result.ok) return { ok: false, message: result.message }

  const reshootCount = lists.reshoot.length
  const archiveCount = lists.archive.length
  return {
    ok: true,
    created: { reshoot: reshootCount, archive: archiveCount },
    message:
      `校核通过，以第 ${latest.version} 版（比例尺 ${latest.scale}）为裁定底图；` +
      `已生成跨模块影像补拍清单 ${reshootCount} 项、遗迹归档清单 ${archiveCount} 项`,
  }
}

// 退回修改：只允许待校核阶段发起；图纸回到绘制，意见留痕。
export function rejectReview(drawingId: number, comment: string, reviewer: string): ActionResult {
  const store = loadBoard()
  const drawing = listRows(DRAWING_KEY).find((row) => Number(row.id) === drawingId)
  if (!drawing) return { ok: false, message: '没有找到对应图纸' }
  if (!canTransition(drawingMeta, '退回修改', String(drawing.status))) {
    return {
      ok: false,
      message: `回退操作被拦下：图纸当前为「${drawing.status}」，退回修改只能在待校核阶段发起，已校核/已数字化图纸不能回退`,
    }
  }
  if (!comment.trim()) {
    return { ok: false, message: '退回修改必须填写校核意见，说明需要修改的内容' }
  }
  const latest = store.versions.filter((item) => item.drawingId === drawingId).slice(-1)[0]
  if (!latest) return { ok: false, message: '缺少版本记录，无法退回' }
  const today = new Date().toISOString().slice(0, 10)
  const open = store.reviews.find(
    (item) => item.drawingId === drawingId && item.version === latest.version && item.state === 'active',
  )
  if (open) {
    open.state = 'rejected'
    open.comment = comment.trim()
    open.reviewer = reviewer
  } else {
    store.reviews.push({
      id: nextSeq(store, 'review'),
      drawingId,
      version: latest.version,
      state: 'rejected',
      comment: comment.trim(),
      reviewer,
      createdAt: today,
    })
  }
  persist(store)

  const result = transitionEntry(DRAWING_KEY, drawingId, '退回修改', { patch: { 校核人: reviewer } })
  if (!result.ok) return result
  return { ok: true, message: `已退回修改（第 ${latest.version} 版），图纸回到绘制阶段，修改后需重新提交新版本` }
}

// 完成数字化：只允许已校核图纸推进；绘制中直接数字化会被状态机拦下。
export function completeDigitalize(drawingId: number): ActionResult {
  const store = loadBoard()
  const drawing = listRows(DRAWING_KEY).find((row) => Number(row.id) === drawingId)
  if (!drawing) return { ok: false, message: '没有找到对应图纸' }
  if (!canTransition(drawingMeta, '完成数字化', String(drawing.status))) {
    return {
      ok: false,
      message: `状态流转被拦截：图纸当前为「${drawing.status}」，只有校核通过的图纸才能数字化，不能跨阶段跳级`,
    }
  }
  const pendingReshoot = store.reshootItems.some((item) => item.drawingId === drawingId && item.status === '待补拍')
  const pendingArchive = store.archiveItems.some((item) => item.drawingId === drawingId && item.status === '待归档')
  if (pendingReshoot || pendingArchive) {
    return {
      ok: false,
      message:
        `交档未完成：该图纸仍有${pendingReshoot ? '影像补拍 ' : ''}${pendingArchive ? '遗迹归档 ' : ''}清单项未处理，不能数字化交档`,
    }
  }
  return transitionEntry(DRAWING_KEY, drawingId, '完成数字化')
}

// ---- 清单跨模块驱动 ----

// 补拍完成：标记清单并把对应影像从「需重拍」推进到「已拍摄」（走影像模块状态机）。
export function resolveReshoot(itemId: number): ActionResult {
  const store = loadBoard()
  const item = store.reshootItems.find((row) => row.id === itemId)
  if (!item) return { ok: false, message: '没有找到该补拍清单项' }
  if (item.status === '已补拍') return { ok: false, message: '该补拍项已处理，不用重复操作' }

  if (item.photoId !== null) {
    const result = transitionEntry(PHOTO_KEY, item.photoId, '重拍完成')
    if (!result.ok) return { ok: false, message: `影像模块流转失败：${result.message}` }
  }
  item.status = '已补拍'
  item.resolvedAt = new Date().toISOString().slice(0, 10)
  persist(store)
  return {
    ok: true,
    message:
      item.kind === '需重拍影像'
        ? `影像 ${item.photoNo ?? ''} 已补拍，影像档案状态同步为「已拍摄」`
        : `缺口「${item.subject}」已补拍登记`,
  }
}

// 归档遗迹：标记清单并把对应遗迹推进到「已归档」（走遗迹模块状态机）。
export function resolveArchive(itemId: number): ActionResult {
  const store = loadBoard()
  const item = store.archiveItems.find((row) => row.id === itemId)
  if (!item) return { ok: false, message: '没有找到该归档清单项' }
  if (item.status === '已归档') return { ok: false, message: '该遗迹已归档，不用重复操作' }

  const result = transitionEntry(FEATURE_KEY, item.featureId, '归档遗迹')
  if (!result.ok) return { ok: false, message: `遗迹模块流转失败：${result.message}` }
  item.status = '已归档'
  item.resolvedAt = new Date().toISOString().slice(0, 10)
  persist(store)
  return { ok: true, message: `遗迹 ${item.featureNo} 已归档（按第 ${item.version} 版、比例尺 ${item.scale} 存档）` }
}

export function resetDrawingBoard(): void {
  resetRows(DRAWING_KEY)
  resetRows(FEATURE_KEY)
  resetRows(PHOTO_KEY)
  resetRows(TRENCH_KEY)
  resetBoard()
}

function csvLine(values: (string | number)[]): string {
  return values
    .map((value) => {
      const text = String(value ?? '')
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    })
    .join(',')
}

export function exportBoardCsv(kind: 'reshoot' | 'archive', rows: ReshootItem[] | ArchiveItem[]): string {
  if (kind === 'reshoot') {
    const items = rows as ReshootItem[]
    const lines = [
      csvLine(['来源图纸', '类型', '影像编号', '补拍对象', '补拍原因', '要求比例尺', '状态', '生成日期', '完成日期']),
      ...items.map((item) =>
        csvLine([
          item.drawingNo,
          item.kind,
          item.photoNo ?? '',
          item.subject,
          item.reason,
          item.requiredScale,
          item.status,
          item.createdAt,
          item.resolvedAt,
        ]),
      ),
    ]
    return `﻿${lines.join('\n')}`
  }
  const items = rows as ArchiveItem[]
  const lines = [
    csvLine(['来源图纸', '遗迹编号', '遗迹类型', '所属探方', '裁定版本', '原比例尺', '状态', '生成日期', '归档日期']),
    ...items.map((item) =>
      csvLine([
        item.drawingNo,
        item.featureNo,
        item.featureType,
        item.trenchNo,
        `v${item.version}`,
        item.scale,
        item.status,
        item.createdAt,
        item.resolvedAt,
      ]),
    ),
  ]
  return `﻿${lines.join('\n')}`
}
