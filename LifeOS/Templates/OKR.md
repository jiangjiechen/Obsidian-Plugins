<%*
// 以文件名为准（OKR YYYY-MM~YYYY-MM），否则按当前双月
const title = tp.file.title;
let m = title.match(/^OKR\s+(\d{4})-(\d{2})~(\d{4})-(\d{2})$/);

let start;
if (m) {
  start = moment(`${m[1]}-${m[2]}`, 'YYYY-MM');
} else {
  let now = moment();
  const mm = now.month() + 1;
  const startM = (mm % 2 === 1) ? mm : (mm - 1);
  start = moment(`${now.format('YYYY')}-${String(startM).padStart(2,'0')}`, 'YYYY-MM');
}

const end = start.clone().add(1, 'month');

function okrTitle(startMoment) {
  const s = startMoment.clone();
  const e = s.clone().add(1, 'month');
  return `OKR ${s.format('YYYY-MM')}~${e.format('YYYY-MM')}`;
}

const prevCycle = okrTitle(start.clone().subtract(2, 'month'));
const nextCycle = okrTitle(start.clone().add(2, 'month'));
const coverA = start.format('YYYY-MM');
const coverB = end.format('YYYY-MM');
const heading = `${start.format('YYYY年MM月')}–${end.format('YYYY年MM月')} · 双月OKR`;
%>

# <% heading %>

> 导航：[[<% prevCycle %>]] ← 上一周期 | 下一周期 → [[<% nextCycle %>]]  
> 覆盖月份：[[<% coverA %>]] · [[<% coverB %>]]

## O1
- **KR1**：
- **KR2**：
- **KR3**：

## O2
- **KR1**：
- **KR2**：
- **KR3**：

### O3
- **KR1**：
- **KR2**：
- **KR3**：

## 风险与缓解

- 风险：
- 缓解：

## 对齐

- 月度：[[<% coverA %>]] · [[<% coverB %>]]

