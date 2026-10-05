/** 实测绘图交档看板的领域数据：图纸版本、校核意见、跨模块补拍/归档清单。 */

export type DrawingVersion = {
  drawingId: number
  version: number
  scale: string
  changeNote: string
  submittedAt: string
}

export type ReviewState = 'active' | 'rejected' | 'superseded' | 'passed'

export type DrawingReview = {
  id: number
  drawingId: number
  version: number
  state: ReviewState
  comment: string
  reviewer: string
  createdAt: string
}

export type ReshootItem = {
  id: number
  kind: '需重拍影像' | '影像缺口'
  drawingId: number
  drawingNo: string
  subject: string
  photoId: number | null
  photoNo: string | null
  reason: string
  requiredScale: string
  status: '待补拍' | '已补拍'
  createdAt: string
  resolvedAt: string
}

export type ArchiveItem = {
  id: number
  drawingId: number
  drawingNo: string
  featureId: number
  featureNo: string
  trenchNo: string
  featureType: string
  version: number
  scale: string
  status: '待归档' | '已归档'
  createdAt: string
  resolvedAt: string
}

export type DrawingBoardStore = {
  versions: DrawingVersion[]
  reviews: DrawingReview[]
  reshootItems: ReshootItem[]
  archiveItems: ArchiveItem[]
  seq: { review: number; reshoot: number; archive: number }
}
