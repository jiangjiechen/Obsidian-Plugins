<%*
// 以文件名为准（YYYY），否则使用今年
let y = moment(tp.file.title, 'YYYY', true);
if (!y.isValid()) y = moment();

const prevYear = y.clone().subtract(1, 'year').format('YYYY');
const nextYear = y.clone().add(1, 'year').format('YYYY');
const yLabel = y.format('YYYY年');

// 生成全年双月 OKR 索引（01-02, 03-04, ... 11-12）
function oddMonthTitle(yy, startMonth) {
  const s = moment(`${yy}-${String(startMonth).padStart(2,'0')}`, 'YYYY-MM');
  return s.format('YYYY-MM');
}

const okrList = [1,3,5,7,9,11].map(m => oddMonthTitle(y.format('YYYY'), m));
%>

# <% yLabel %> · 年度规划

> 导航：[[<% prevYear %>]] ← 上一年 | 下一年 → [[<% nextYear %>]]

## 年度主题
- 

## 年度重点目标
- 

## 关键结果（框架）
- 

## 主要项目（Project）
- 

## 资源与风险
- 资源：
- 风险与缓解：

## 检视节奏（例：月度、双月 OKR、季度/里程碑）



---
## OKR 索引（双月）
- [[<% okrList[0] %>]]
- [[<% okrList[1] %>]]
- [[<% okrList[2] %>]]
- [[<% okrList[3] %>]]
- [[<% okrList[4] %>]]
- [[<% okrList[5] %>]]

## 月度索引
<%* for (let i = 1; i <= 12; i++) { const label = y.format('YYYY') + '-' + String(i).padStart(2,'0'); tR += `- [[${label}]]\n`; } %>
