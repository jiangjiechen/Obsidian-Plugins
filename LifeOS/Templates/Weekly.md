<%*
// 以文件名为准（GGGG-[W]WW），否则使用本周
let w = moment(tp.file.title, "GGGG-[W]WW", true);
if (!w.isValid()) w = moment();

const prevWeek = w.clone().subtract(1, 'week').format('GGGG-[W]WW');
const nextWeek = w.clone().add(1, 'week').format('GGGG-[W]WW');
const monthTitle = w.clone().format('YYYY-MM');

function okrTitleFor(date) {
  const m = date.month() + 1; // 1-12
  const start = (m % 2 === 1) ? m : (m - 1);
  const end = start + 1;
  const yyyy = date.format('YYYY');
  const s = String(start).padStart(2, '0');
  const e = String(end).padStart(2, '0');
  return `OKR ${yyyy}-${s}~${yyyy}-${e}`;
}
const okrTitle = okrTitleFor(w);
function oddMonthTitleFor(date) {
  const m = date.month() + 1;
  const start = (m % 2 === 1) ? m : (m - 1);
  const yyyy = date.format('YYYY');
  return `${yyyy}-${String(start).padStart(2,'0')}`;
}
const okrMonthlyTitle = oddMonthTitleFor(w);
const weekLabel = `第${String(w.isoWeek()).padStart(2,'0')}周`;
const ws = w.clone().startOf('isoWeek');
const we = ws.clone().add(6, 'day');
const rangeLabel = `${ws.format('YYYY-MM-DD')}–${we.format('YYYY-MM-DD')}`;
%>

# <% weekLabel %>（<% rangeLabel %>）

> 导航：[[<% prevWeek %>]] ← 上周 | 本月 [[<% okrMonthlyTitle %>|<% monthTitle %>]] | 下周 → [[<% nextWeek %>]]  
> 关联：本双月OKR [[<% okrMonthlyTitle %>]]


## 每周三策

**核心进展**：总结过去阶段的重要推进点，用于确认项目所处位置。
1. 

**本周关键动向**：列出 2–4 条主要工作线或探索方向，以「项目线 + 当前目标」形式书写。
1. 

**前瞻与风险**：展望下阶段关注点或潜在阻碍，保持与 timeline 同步。
1. 

## 本周里程碑 / 交付

- [ ] 
- [ ] 
- [ ] 


## OKR 同步

![[<% okrMonthlyTitle %>#双月目标]]


## 本周汇总
```dataviewjs
const { DateTime } = dv.luxon;
const m = dv.current().file.name.match(/^(\d{4})-W(\d{2})$/);
let weekStart = m ? DateTime.fromObject({ weekYear: +m[1], weekNumber: +m[2], weekday: 1 }) : DateTime.now();
weekStart = weekStart.startOf('day');
const weekEnd = weekStart.plus({ days: 6 }).endOf('day');

// 本周日记索引
const days = dv.pages()
  .where(p => /^(\d{4})-(\d{2})-(\d{2})$/.test(p.file.name))
  .where(p => { const d = DateTime.fromISO(p.file.name); return d && d.toMillis() >= weekStart.toMillis() && d.toMillis() <= weekEnd.toMillis(); })
  .sort(p => p.file.name, 'asc');

dv.header(3, '日记索引');
dv.list(days.map(p => dv.fileLink(p.file.path)));

// 当周到期任务
function parseTaskDate(t){
  if (t.due) return t.due;               // due::
  if (t.scheduled) return t.scheduled;   // scheduled::
  if (t.start) return t.start;           // start::
  const m = (t.text || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? DateTime.fromISO(m[0]) : null;
}

let tasks = [];
for (let p of dv.pages()) {
  if (!p.file || !p.file.tasks) continue;
  for (let t of p.file.tasks) {
    const due = parseTaskDate(t);
    if (due && !t.completed && due.toMillis() >= weekStart.toMillis() && due.toMillis() <= weekEnd.toMillis()) {
      tasks.push(t);
    }
  }
}

dv.header(3, '到期任务');
dv.taskList(tasks, {shortMode: false});
```
