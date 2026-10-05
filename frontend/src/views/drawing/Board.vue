<template>
  <section class="page board-page">
    <header class="page-head">
      <div>
        <h2>实测绘图 · 交档看板</h2>
        <p class="page-desc">
          以绘图对象为主轴跟踪图纸校核阶段；需要补图的遗迹、探方、影像分列呈现；校核通过后真实生成跨模块清单并可闭环回写。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/drawing">返回图纸管理</RouterLink>
        <button class="btn" type="button" @click="restoreDemo">恢复演示数据</button>
      </div>
    </header>

    <div class="rule-banner">
      <strong>流转与裁决规则</strong>
      <ul>
        <li>阶段只能逐级推进：绘制中 / 需修改 → 待校核 → 已校核 → 已数字化；<b>不能从绘制中直接跳到已数字化</b>，任何回退操作都会被拦下（返工统一走「退回修改」，进入需修改）。</li>
        <li>图纸版本与校核意见冲突时，以<b>最新校核通过版</b>作为归档底图，校核意见随图归档；<b>历史图纸按原比例尺兼容保留</b>，不回算、不重绘。</li>
        <li>「确认校核」通过后才真实生成跨模块的影像补拍清单与遗迹归档清单，并在影像记录、遗迹单位模块留痕。</li>
      </ul>
    </div>

    <p v-if="flash" class="flash" :class="flashOk ? 'flash-ok' : 'flash-err'">{{ flash }}</p>

    <div class="stat-row board-stats">
      <article class="stat-card">
        <span class="stat-label">图纸总数</span>
        <strong class="stat-value">{{ board.stats.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">绘制中</span>
        <strong class="stat-value">{{ board.stats.drawing }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待校核/需修改</span>
        <strong class="stat-value">{{ board.stats.checking }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">校核通过</span>
        <strong class="stat-value">{{ board.stats.approved }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已数字化</span>
        <strong class="stat-value">{{ board.stats.digitized }}</strong>
      </article>
      <article class="stat-card warn">
        <span class="stat-label">补图缺口（遗迹/探方/影像）</span>
        <strong class="stat-value">
          {{ board.stats.gapFeatures }} / {{ board.stats.gapTrenches }} / {{ board.stats.gapPhotos }}
        </strong>
      </article>
      <article class="stat-card warn">
        <span class="stat-label">待闭环（补拍/归档）</span>
        <strong class="stat-value">
          {{ board.stats.pendingReshoots }} / {{ board.stats.pendingArchives }}
        </strong>
      </article>
    </div>

    <h3 class="block-title">校核阶段主表（以绘图对象为主轴）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>绘图对象</th>
          <th>图纸编号</th>
          <th>绘图类型</th>
          <th>比例尺</th>
          <th>版本</th>
          <th>当前校核阶段</th>
          <th>校核意见</th>
          <th style="width: 260px">阶段推进</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in board.drawings" :key="String(row.id)">
          <td class="object-cell">{{ row['绘图对象'] }}</td>
          <td>{{ row['图纸编号'] }}</td>
          <td>{{ row['绘图类型'] }}</td>
          <td>{{ row['比例尺'] }}</td>
          <td>v{{ row['版本'] ?? 1 }}</td>
          <td><span class="stage-badge" :data-stage="String(row.status)">{{ row.status }}</span></td>
          <td class="opinion-cell">{{ row['校核意见'] || '—' }}</td>
          <td class="row-actions board-actions">
            <template v-if="String(row.status) === '绘制中' || String(row.status) === '需修改'">
              <button class="link" type="button" @click="submit(row)">提交校核</button>
            </template>
            <template v-else-if="String(row.status) === '待校核'">
              <input
                v-model="opinions[String(row.id)]"
                class="opinion-input"
                :placeholder="`校核 ${row['图纸编号']}（退回必填）`"
              />
              <button class="link danger" type="button" @click="reject(row)">退回修改</button>
              <button class="link primary-link" type="button" @click="approve(row)">确认校核</button>
            </template>
            <template v-else-if="String(row.status) === '已校核'">
              <button class="link primary-link" type="button" @click="digitize(row)">完成数字化</button>
            </template>
            <template v-else>
              <span class="muted-text">流程已完结</span>
            </template>
          </td>
        </tr>
        <tr v-if="!board.drawings.length">
          <td colspan="8" class="empty-state">暂无图纸</td>
        </tr>
      </tbody>
    </table>

    <h3 class="block-title">需要补图 / 补拍的对象</h3>
    <div class="gap-grid">
      <section class="gap-col">
        <header class="gap-head">
          <span>需补图的遗迹</span>
          <b>{{ board.featureGaps.length }}</b>
        </header>
        <table class="mini-table">
          <thead>
            <tr><th>遗迹</th><th>所属探方</th><th>类型</th><th>现状</th></tr>
          </thead>
          <tbody>
            <tr v-for="gap in board.featureGaps" :key="gap.featureNo">
              <td>{{ gap.featureNo }}</td>
              <td>{{ gap.trenchNo }}</td>
              <td>{{ gap.featureType }}</td>
              <td><span class="tag warn-tag">{{ gap.status }}</span></td>
            </tr>
            <tr v-if="!board.featureGaps.length">
              <td colspan="4" class="empty-state">无缺口</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="gap-col">
        <header class="gap-head">
          <span>需补图的探方</span>
          <b>{{ board.trenchGaps.length }}</b>
        </header>
        <table class="mini-table">
          <thead>
            <tr><th>探方</th><th>发掘区</th><th>现状</th></tr>
          </thead>
          <tbody>
            <tr v-for="gap in board.trenchGaps" :key="gap.trenchNo">
              <td>{{ gap.trenchNo }}</td>
              <td>{{ gap.area }}</td>
              <td><span class="tag warn-tag">{{ gap.status }}</span></td>
            </tr>
            <tr v-if="!board.trenchGaps.length">
              <td colspan="3" class="empty-state">无缺口</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="gap-col">
        <header class="gap-head">
          <span>需补拍的影像</span>
          <b>{{ board.photoGaps.length }}</b>
        </header>
        <table class="mini-table">
          <thead>
            <tr><th>图纸</th><th>对象</th><th>影像现状</th></tr>
          </thead>
          <tbody>
            <tr v-for="gap in board.photoGaps" :key="gap.drawingNo">
              <td>{{ gap.drawingNo }}</td>
              <td>{{ gap.drawingObject }}<br /><small class="muted-text">{{ gap.photoType }}</small></td>
              <td><span class="tag warn-tag">{{ gap.photoStatusLabel }}</span></td>
            </tr>
            <tr v-if="!board.photoGaps.length">
              <td colspan="3" class="empty-state">无缺口</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <div class="list-grid">
      <section class="list-col">
        <header class="gap-head">
          <span>影像补拍清单（校核通过后真实生成）</span>
          <span class="head-actions">
            <button class="btn small" type="button" @click="exportReshoot">导出 CSV</button>
            <b>{{ board.stats.pendingReshoots }} 待补拍</b>
          </span>
        </header>
        <table class="mini-table">
          <thead>
            <tr><th>图纸</th><th>影像编号</th><th>原因</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in board.reshoots" :key="item.id">
              <td>{{ item.drawingNo }}<br /><small class="muted-text">对象 {{ item.drawingObject }}</small></td>
              <td>
                {{ item.photoNo }}
                <span v-if="item.photoCreated" class="tag new-tag" title="校核通过时跨模块登记进影像模块">新登记</span>
              </td>
              <td class="reason-cell">{{ item.reason }}</td>
              <td><span class="tag" :class="item.status === '已补拍' ? 'ok-tag' : 'warn-tag'">{{ item.status }}</span></td>
              <td>
                <button v-if="item.status === '待补拍'" class="link primary-link" type="button" @click="finishReshoot(item.id)">
                  补拍完成
                </button>
                <span v-else class="muted-text">已闭环</span>
              </td>
            </tr>
            <tr v-if="!board.reshoots.length">
              <td colspan="5" class="empty-state">尚无清单，图纸校核通过后自动生成</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="list-col">
        <header class="gap-head">
          <span>遗迹归档清单（校核通过后真实生成）</span>
          <span class="head-actions">
            <button class="btn small" type="button" @click="exportArchive">导出 CSV</button>
            <b>{{ board.stats.pendingArchives }} 待归档</b>
          </span>
        </header>
        <table class="mini-table">
          <thead>
            <tr><th>图纸</th><th>遗迹/探方</th><th>采用版本与比例尺</th><th>裁决</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in board.archives" :key="item.id">
              <td>{{ item.drawingNo }}</td>
              <td>{{ item.featureNo }}<br /><small class="muted-text">{{ item.trenchNo }} · {{ item.featureType }}</small></td>
              <td>v{{ item.version }} · {{ item.scale }}</td>
              <td class="reason-cell">
                <span v-if="item.versionNote" class="tag note-tag" :title="item.versionNote">版本裁决</span>
                <span v-else class="muted-text">无冲突</span>
              </td>
              <td><span class="tag" :class="item.status === '已归档' ? 'ok-tag' : 'warn-tag'">{{ item.status }}</span></td>
              <td>
                <button v-if="item.status === '待归档'" class="link primary-link" type="button" @click="finishArchive(item.id)">
                  办理归档
                </button>
                <span v-else class="muted-text">已闭环</span>
              </td>
            </tr>
            <tr v-if="!board.archives.length">
              <td colspan="6" class="empty-state">尚无清单，遗迹图纸校核通过后自动生成</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <footer class="page-foot">
      <span>清单闭环会回写影像记录 / 遗迹单位模块；数据保存在本机浏览器。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import {
  approveDrawing,
  completeArchive,
  completeReshoot,
  digitizeDrawing,
  exportArchives,
  exportReshoots,
  loadBoard,
  rejectDrawing,
  resetDemo,
  submitForReview,
} from '@/api/handover-board'
import type { BoardView } from '@/api/handover-board'
import type { EntryRow } from '@/data/types'

const emptyBoard = (): BoardView => ({
  drawings: [],
  featureGaps: [],
  trenchGaps: [],
  photoGaps: [],
  reshoots: [],
  archives: [],
  stats: {
    total: 0,
    drawing: 0,
    checking: 0,
    approved: 0,
    digitized: 0,
    gapFeatures: 0,
    gapTrenches: 0,
    gapPhotos: 0,
    pendingReshoots: 0,
    pendingArchives: 0,
  },
})

const board = reactive<BoardView>(emptyBoard())
const opinions = reactive<Record<string, string>>({})
const flash = ref('')
const flashOk = ref(true)

function refresh() {
  const next = loadBoard()
  Object.assign(board, next)
}

function notify(message: string, ok = true) {
  flash.value = message
  flashOk.value = ok
}

function submit(row: EntryRow) {
  const result = submitForReview(Number(row.id))
  notify(result.message, result.ok)
  refresh()
}

function reject(row: EntryRow) {
  const opinion = opinions[String(row.id)] ?? ''
  const result = rejectDrawing(Number(row.id), opinion)
  if (result.ok) {
    opinions[String(row.id)] = ''
  }
  notify(result.message, result.ok)
  refresh()
}

function approve(row: EntryRow) {
  const opinion = (opinions[String(row.id)] ?? '').trim()
  const { result } = approveDrawing(Number(row.id), opinion)
  if (result.ok) {
    opinions[String(row.id)] = ''
  }
  notify(result.message, result.ok)
  refresh()
}

function digitize(row: EntryRow) {
  const result = digitizeDrawing(Number(row.id))
  notify(result.message, result.ok)
  refresh()
}

function finishReshoot(id: number) {
  const result = completeReshoot(id)
  notify(result.message, result.ok)
  refresh()
}

function finishArchive(id: number) {
  const result = completeArchive(id)
  notify(result.message, result.ok)
  refresh()
}

function exportReshoot() {
  exportReshoots(board.reshoots)
}

function exportArchive() {
  exportArchives(board.archives)
}

function restoreDemo() {
  resetDemo()
  Object.keys(opinions).forEach((key) => delete opinions[key])
  refresh()
  notify('演示数据已恢复：业务登记与交档清单均回到初始状态')
}

onMounted(refresh)
</script>

<style scoped>
.board-page .block-title {
  margin: 18px 0 8px;
  font-size: 15px;
}
.rule-banner {
  background: #eef4ff;
  border: 1px solid #bcd3fb;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #334155;
}
.rule-banner ul { margin: 4px 0 0; padding-left: 18px; }
.board-stats .warn .stat-value { color: #b45309; }
.flash {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.flash-ok { background: #ecfdf3; border: 1px solid #a6f4c5; color: #027a48; }
.flash-err { background: #fef3f2; border: 1px solid #fda29b; color: #b42318; }
.object-cell { font-weight: 600; }
.opinion-cell { max-width: 220px; color: #475569; }
.stage-badge {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #eef2f7;
  color: #334155;
}
.stage-badge[data-stage='已校核'] { background: #d1fadf; color: #027a48; }
.stage-badge[data-stage='已数字化'] { background: #dbeafe; color: #1d4ed8; }
.stage-badge[data-stage='待校核'] { background: #fef0c7; color: #b54708; }
.stage-badge[data-stage='需修改'] { background: #fee4e2; color: #b42318; }
.board-actions { flex-wrap: wrap; gap: 8px; align-items: center; }
.opinion-input {
  width: 100%;
  min-width: 180px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  margin-bottom: 4px;
}
.link.danger { color: #b42318; }
.primary-link { font-weight: 600; }
.muted-text { color: var(--muted); font-size: 12px; }
.gap-grid,
.list-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 8px;
}
.list-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.gap-col,
.list-col {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.gap-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
}
.head-actions { display: flex; align-items: center; gap: 8px; font-weight: 400; }
.btn.small { padding: 3px 8px; font-size: 12px; }
.mini-table { width: 100%; border-collapse: collapse; }
.mini-table th,
.mini-table td {
  border-bottom: 1px solid #eef2f7;
  padding: 7px 9px;
  font-size: 12.5px;
  text-align: left;
  vertical-align: top;
}
.mini-table th { background: #fcfdff; color: var(--muted); font-weight: 500; }
.reason-cell { color: #475569; max-width: 220px; }
.tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11.5px;
  background: #eef2f7;
}
.warn-tag { background: #fef0c7; color: #b54708; }
.ok-tag { background: #d1fadf; color: #027a48; }
.new-tag { background: #dbeafe; color: #1d4ed8; margin-left: 4px; }
.note-tag { background: #ede9fe; color: #6d28d9; }
</style>
