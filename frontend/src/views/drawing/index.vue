<template>
  <section class="page" data-module="drawing">
    <header class="page-head">
      <div>
        <h2>实测绘图 · 交档看板</h2>
        <p class="page-desc">
          以绘图对象为主轴跟踪图纸校核与交档；校核通过后自动生成跨模块的影像补拍清单与遗迹归档清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出图纸台账</button>
        <button class="btn ghost danger" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="rule-banner">
      <strong>版本裁定规则</strong>
      <ul>
        <li>校核通过以当次提交的<strong>最新版本</strong>为裁定底图；退回后重新提交会生成新版本，旧版本上未结案的退回意见自动标记为「已被新版本覆盖」，不再阻断新版本。</li>
        <li>每个版本快照永久保留各自比例尺；<strong>历史图纸按原比例尺兼容</strong>（如 1:2000 旧图不做换算），归档清单按出单时版本的原比例尺存档。</li>
        <li>状态只能沿「绘制中 → 待校核 → 已校核 → 已数字化」逐级推进，退回修改仅限待校核阶段；跨阶段跳级与非法回退一律拦截。</li>
      </ul>
    </div>

    <div class="stat-row">
      <article v-for="item in boardStats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 看板主轴：绘图对象 -->
    <h3 class="board-title">交档看板（绘图对象主轴）</h3>
    <table class="data-table board-table">
      <thead>
        <tr>
          <th>图纸编号</th>
          <th>绘图对象</th>
          <th>绘图类型</th>
          <th>比例尺（当前版）</th>
          <th>校核阶段</th>
          <th>待补图 · 遗迹</th>
          <th>待补图 · 探方</th>
          <th>待补图 · 影像</th>
          <th>版本/校核</th>
          <th>阶段操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in board.rows" :key="String(row.drawing.id)">
          <tr :class="{ 'is-open': expandedId === Number(row.drawing.id) }">
            <td>{{ row.drawing['图纸编号'] }}</td>
            <td>{{ row.drawing['绘图对象'] }}</td>
            <td>{{ row.drawing['绘图类型'] }}</td>
            <td>
              <strong>{{ row.latest?.scale ?? row.drawing['比例尺'] }}</strong>
              <span v-if="row.versions.length > 1" class="muted"> · v{{ row.latest?.version }}</span>
            </td>
            <td><span class="stage-badge" :class="stageClass(String(row.drawing.status))">{{ row.stage }}</span></td>
            <td>
              <span v-if="!row.pendingFeatures.length" class="muted">—</span>
              <span v-for="item in row.pendingFeatures" :key="String(item.id)" class="chip warn">
                {{ item['遗迹编号'] }}
              </span>
            </td>
            <td>
              <span v-if="!row.pendingTrenches.length" class="muted">—</span>
              <span v-for="item in row.pendingTrenches" :key="String(item.id)" class="chip warn">
                {{ item['探方编号'] }}
              </span>
            </td>
            <td>
              <span v-if="!row.pendingPhotos.length" class="muted">—</span>
              <span
                v-for="(item, idx) in row.pendingPhotos"
                :key="idx"
                class="chip"
                :class="item.kind === '需重拍影像' ? 'danger' : 'warn'"
                :title="item.label"
              >
                {{ item.kind === '需重拍影像' ? item.photo?.['影像编号'] : '缺口' }}
              </span>
            </td>
            <td>
              <button class="link" type="button" @click="toggleExpand(Number(row.drawing.id))">
                {{ expandedId === Number(row.drawing.id) ? '收起' : `版本 ${row.versions.length || 0} / 意见` }}
              </button>
            </td>
            <td class="op-cell">
              <template v-for="action in allowedActions(String(row.drawing.status))" :key="action">
                <button class="link" type="button" @click="openForm(Number(row.drawing.id), action)">{{ action }}</button>
              </template>
            </td>
          </tr>
          <tr v-if="expandedId === Number(row.drawing.id)" class="detail-row">
            <td colspan="10">
              <div class="detail-grid">
                <div>
                  <h4>图纸版本（各版保留原比例尺）</h4>
                  <p v-if="!row.versions.length" class="muted">尚未提交过校核，暂无版本快照。</p>
                  <ol v-else class="timeline">
                    <li v-for="ver in [...row.versions].reverse()" :key="ver.version">
                      <strong>v{{ ver.version }}</strong> · 比例尺 {{ ver.scale }} · {{ ver.submittedAt }}
                      <br /><span class="muted">{{ ver.changeNote }}</span>
                    </li>
                  </ol>
                </div>
                <div>
                  <h4>校核意见</h4>
                  <p v-if="!reviewsOf(Number(row.drawing.id)).length" class="muted">暂无校核意见。</p>
                  <ul v-else class="review-list">
                    <li v-for="review in [...reviewsOf(Number(row.drawing.id))].reverse()" :key="review.id">
                      <span class="review-state" :class="`rs-${review.state}`">{{ reviewStateLabel(review.state) }}</span>
                      v{{ review.version }} · {{ review.reviewer }} · {{ review.createdAt }}
                      <br /><span class="muted">{{ review.comment }}</span>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- 操作表单 -->
              <div v-if="form.drawingId === Number(row.drawing.id)" class="action-form">
                <template v-if="form.action === '提交校核'">
                  <label>本版比例尺（历史图纸可沿用原比例尺）
                    <input v-model="form.scale" placeholder="如 1:20 / 1:50 / 1:2000" />
                  </label>
                  <label class="grow">修改说明
                    <input v-model="form.note" placeholder="首次提交可留空；退回后重交请写明修改内容" />
                  </label>
                </template>
                <template v-else-if="form.action === '确认校核'">
                  <label class="grow">校核意见
                    <input v-model="form.comment" placeholder="可留空，默认「校核通过」" />
                  </label>
                </template>
                <template v-else-if="form.action === '退回修改'">
                  <label class="grow">退回意见（必填）
                    <input v-model="form.comment" placeholder="说明比例尺、图面要素或记录冲突等问题" />
                  </label>
                </template>
                <template v-else-if="form.action === '完成数字化'">
                  <span class="muted">确认将校核通过图纸数字化交档；仍有未处理补拍/归档清单项时会被拦下。</span>
                </template>
                <div class="form-actions">
                  <button class="btn primary" type="button" @click="submitForm">确定</button>
                  <button class="btn ghost" type="button" @click="closeForm">取消</button>
                </div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <!-- 三个独立补图栏目 -->
    <h3 class="board-title">需要补图（按对象独立汇总）</h3>
    <div class="pending-grid">
      <article class="pending-panel">
        <header><h4>待补图遗迹</h4><span class="count">{{ board.pending.features.length }}</span></header>
          <ul class="pending-list">
            <li v-for="item in board.pending.features" :key="String(item.feature['遗迹编号'])">
              <strong>{{ item.feature['遗迹编号'] }}</strong>
              <span class="muted">{{ item.feature['遗迹类型'] }} · {{ item.feature['所属探方'] }}</span>
              <span class="from">来自：{{ item.drawings.map((d) => d['图纸编号']).join('、') }}</span>
            </li>
            <li v-if="!board.pending.features.length" class="muted">暂无</li>
          </ul>
        </article>
      <article class="pending-panel">
        <header><h4>待补图探方</h4><span class="count">{{ board.pending.trenches.length }}</span></header>
          <ul class="pending-list">
            <li v-for="item in board.pending.trenches" :key="String(item.trench['探方编号'])">
              <strong>{{ item.trench['探方编号'] }}</strong>
              <span class="muted">{{ item.trench['所属发掘区'] }} · {{ item.trench['探方尺寸'] }}</span>
              <span class="from">来自：{{ item.drawings.map((d) => d['图纸编号']).join('、') }}</span>
            </li>
            <li v-if="!board.pending.trenches.length" class="muted">暂无</li>
          </ul>
        </article>
      <article class="pending-panel">
        <header><h4>待补图影像</h4><span class="count">{{ board.pending.photos.length }}</span></header>
          <ul class="pending-list">
            <li v-for="(item, idx) in board.pending.photos" :key="idx">
              <strong>{{ item.photo ? item.photo['影像编号'] : '影像缺口' }}</strong>
              <span class="chip" :class="item.kind === '需重拍影像' ? 'danger' : 'warn'">{{ item.kind }}</span>
              <span class="muted">{{ item.photo ? item.photo['拍摄对象'] : item.label }}</span>
              <span class="from">来自：{{ item.drawings.map((d) => d['图纸编号']).join('、') }}</span>
            </li>
            <li v-if="!board.pending.photos.length" class="muted">暂无</li>
          </ul>
        </article>
    </div>

    <!-- 校核通过后真实生成的跨模块清单 -->
    <div class="list-grid">
      <section class="check-list">
        <header class="list-head">
          <h4>影像补拍清单 <span class="muted">（校核通过自动生成）</span></h4>
          <button class="btn" type="button" :disabled="!board.reshootItems.length" @click="exportReshoot">导出 CSV</button>
        </header>
        <table class="data-table">
          <thead>
            <tr><th>来源图纸</th><th>类型</th><th>对象</th><th>要求比例尺</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in board.reshootItems" :key="item.id">
              <td>{{ item.drawingNo }}</td>
              <td><span class="chip" :class="item.kind === '需重拍影像' ? 'danger' : 'warn'">{{ item.kind }}</span></td>
              <td>{{ item.photoNo ? `${item.photoNo} ` : '' }}{{ item.subject }}</td>
              <td>{{ item.requiredScale }}</td>
              <td>{{ item.status }}<span v-if="item.resolvedAt" class="muted"> · {{ item.resolvedAt }}</span></td>
              <td>
                <button v-if="item.status === '待补拍'" class="link" type="button" @click="doResolve('reshoot', item.id)">
                  登记补拍完成
                </button>
                <span v-else class="muted">已闭环</span>
              </td>
            </tr>
            <tr v-if="!board.reshootItems.length"><td colspan="6" class="empty-state">暂无清单：图纸校核通过后自动生成</td></tr>
          </tbody>
        </table>
      </section>

      <section class="check-list">
        <header class="list-head">
          <h4>遗迹归档清单 <span class="muted">（校核通过自动生成）</span></h4>
          <button class="btn" type="button" :disabled="!board.archiveItems.length" @click="exportArchive">导出 CSV</button>
        </header>
        <table class="data-table">
          <thead>
            <tr><th>来源图纸</th><th>遗迹编号</th><th>遗迹类型</th><th>探方</th><th>版本/比例尺</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in board.archiveItems" :key="item.id">
              <td>{{ item.drawingNo }}</td>
              <td>{{ item.featureNo }}</td>
              <td>{{ item.featureType }}</td>
              <td>{{ item.trenchNo }}</td>
              <td>v{{ item.version }} · {{ item.scale }}</td>
              <td>{{ item.status }}<span v-if="item.resolvedAt" class="muted"> · {{ item.resolvedAt }}</span></td>
              <td>
                <button v-if="item.status === '待归档'" class="link" type="button" @click="doResolve('archive', item.id)">
                  执行归档
                </button>
                <span v-else class="muted">已闭环</span>
              </td>
            </tr>
            <tr v-if="!board.archiveItems.length"><td colspan="7" class="empty-state">暂无清单：图纸校核通过后自动生成</td></tr>
          </tbody>
        </table>
      </section>
    </div>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadCsv, downloadEntries, moduleMeta } from '@/api/local-service'
import {
  approveReview,
  completeDigitalize,
  exportBoardCsv,
  loadDrawingBoard,
  rejectReview,
  resetDrawingBoard,
  resolveArchive,
  resolveReshoot,
  reviewHistory,
  submitForReview,
} from '@/api/drawing-board'
import type { ActionResult } from '@/data/types'
import type { ReviewState } from '@/data/drawing-board-types'

const meta = moduleMeta('drawing')

const board = ref(loadDrawingBoard())
const expandedId = ref<number | null>(null)
const message = ref('')
const messageOk = ref(false)

const form = reactive<{ drawingId: number | null; action: string; scale: string; note: string; comment: string }>({
  drawingId: null,
  action: '',
  scale: '1:20',
  note: '',
  comment: '',
})

const boardStats = computed(() => {
  const rows = board.value.rows
  const count = (status: string) => rows.filter((row) => String(row.drawing.status) === status).length
  return [
    { label: '图纸总数', value: rows.length },
    { label: '待校核', value: count('待校核') },
    { label: '校核通过·待数字化', value: count('已校核') },
    { label: '已数字化交档', value: count('已数字化') },
    { label: '退回修改', value: count('需修改') + count('绘制中') },
    { label: '待补拍', value: board.value.reshootItems.filter((item) => item.status === '待补拍').length },
    { label: '待归档遗迹', value: board.value.archiveItems.filter((item) => item.status === '待归档').length },
  ]
})

const ACTIONS_BY_STATUS: Record<string, string[]> = {
  绘制中: ['提交校核'],
  需修改: ['提交校核'],
  待校核: ['确认校核', '退回修改'],
  已校核: ['完成数字化'],
  已数字化: [],
}

function allowedActions(status: string): string[] {
  return ACTIONS_BY_STATUS[status] ?? []
}

function stageClass(status: string): string {
  return {
    绘制中: 'st-drawing',
    需修改: 'st-reject',
    待校核: 'st-review',
    已校核: 'st-passed',
    已数字化: 'st-done',
  }[status] ?? ''
}

const reviewLabels: Record<ReviewState, string> = {
  active: '待结论',
  rejected: '退回修改',
  superseded: '已被新版本覆盖',
  passed: '校核通过',
}

function reviewStateLabel(state: ReviewState): string {
  return reviewLabels[state]
}

function reviewsOf(drawingId: number) {
  return reviewHistory(drawingId)
}

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

function openForm(drawingId: number, action: string) {
  message.value = ''
  const row = board.value.rows.find((item) => Number(item.drawing.id) === drawingId)
  form.drawingId = drawingId
  form.action = action
  form.scale = row?.latest?.scale ?? String(row?.drawing['比例尺'] ?? '1:20')
  form.note = ''
  form.comment = ''
}

function closeForm() {
  form.drawingId = null
  form.action = ''
}

function reload() {
  board.value = loadDrawingBoard()
}

function notify(result: ActionResult) {
  messageOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    closeForm()
    reload()
  }
}

function submitForm() {
  if (form.drawingId === null) return
  const id = form.drawingId
  const operator = '梁思正'
  if (form.action === '提交校核') {
    notify(submitForReview(id, form.scale, form.note, '苏文卿'))
  } else if (form.action === '确认校核') {
    notify(approveReview(id, form.comment, operator))
  } else if (form.action === '退回修改') {
    notify(rejectReview(id, form.comment, operator))
  } else if (form.action === '完成数字化') {
    notify(completeDigitalize(id))
  }
}

function doResolve(kind: 'reshoot' | 'archive', id: number) {
  notify(kind === 'reshoot' ? resolveReshoot(id) : resolveArchive(id))
}

function exportRows() {
  downloadEntries(meta.key)
}

function exportReshoot() {
  downloadCsv('影像补拍清单.csv', exportBoardCsv('reshoot', board.value.reshootItems))
}

function exportArchive() {
  downloadCsv('遗迹归档清单.csv', exportBoardCsv('archive', board.value.archiveItems))
}

function resetAll() {
  resetDrawingBoard()
  reload()
  messageOk.value = true
  message.value = '交档看板与图纸/遗迹/探方/影像示例数据已重置'
}

onMounted(reload)
</script>
