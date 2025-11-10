<%*
// 以文件名为准（YYYY-MM-DD），否则使用今天
let d = moment(tp.file.title, "YYYY-MM-DD", true);
if (!d.isValid()) d = moment();

const prev = d.clone().subtract(1, 'day').format('YYYY-MM-DD');
const next = d.clone().add(1, 'day').format('YYYY-MM-DD');
const weekTitle = d.clone().isoWeekYear() + "-W" + String(d.clone().isoWeek()).padStart(2, '0');
const monthTitle = d.clone().format('YYYY-MM');

function oddMonthTitleFor(date) {
  const m = date.month() + 1; // 1-12
  const start = (m % 2 === 1) ? m : (m - 1);
  const yyyy = date.format('YYYY');
  return `${yyyy}-${String(start).padStart(2, '0')}`;
}
const okrMonthlyTitle = oddMonthTitleFor(d);
%>
> 导航：[[<% prev %>]] ← 前一天 | 本周 [[<% weekTitle %>]] | 后一天 → [[<% next %>]]  
> 关联：本双月OKR [[<% okrMonthlyTitle %>]]

![[<% weekTitle %>#每周三策]]

## 每日三思

**昨日（Yesterday）**
1. 

**今日（Today）**
1. 

**阻碍（Blockers）**
1. 

## 今日TODO

- [ ] 
- [ ] 
- [ ] 

## 当期截止任务

```dataviewjs
const { DateTime } = dv.luxon;
let name = dv.current().file.name;
let d = DateTime.fromISO(name);
if (!d.isValid) d = DateTime.now();

const start = d.minus({ days: d.weekday - 1 }).startOf('day'); // 周一
const end = start.plus({ days: 6 }).endOf('day');             // 周日
const todayEnd = d.endOf('day');

function parseTaskDate(t){
  if (t.due) return t.due;               // due:: 2025-01-02
  if (t.scheduled) return t.scheduled;   // scheduled::
  if (t.start) return t.start;           // start::
  const m = (t.text || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? DateTime.fromISO(m[0]) : null;
}

let all = [];
for (let p of dv.pages()) {
  if (!p.file || !p.file.tasks) continue;
  for (let t of p.file.tasks) {
    const due = parseTaskDate(t);
    all.push({ t, due });
  }
}

const todayDue = all.filter(x => !x.t.completed && x.due && x.due.toMillis() <= todayEnd.toMillis());
const weekDue  = all.filter(x => !x.t.completed && x.due && x.due.toMillis() >= start.toMillis() && x.due.toMillis() <= end.toMillis());

dv.header(3, '今日到期 / 逾期');
dv.taskList(todayDue.map(x => x.t), {shortMode: false});

dv.header(3, '本周到期');
dv.taskList(weekDue.map(x => x.t), {shortMode: false});
```


## 速记 / 碎片
