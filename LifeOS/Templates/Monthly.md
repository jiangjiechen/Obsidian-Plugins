<%*
// 以文件名为准（YYYY-MM），将月度模板改为双月 OKR
let m = moment(tp.file.title, "YYYY-MM", true);
if (!m.isValid()) m = moment();

const mm = m.month() + 1;
const isOdd = (mm % 2 === 1);
const start = isOdd ? m.clone() : m.clone().subtract(1, 'month');
const end   = start.clone().add(1, 'month');

const prevStart = start.clone().subtract(2, 'month');
const nextStart = start.clone().add(2, 'month');

const startTitle = start.format('YYYY-MM');
const endTitle   = end.format('YYYY-MM');
const prevTitle  = prevStart.format('YYYY-MM');
const nextTitle  = nextStart.format('YYYY-MM');

if (!isOdd) {
  // 偶数月：在生成的笔记中保留“打开即跳转”的持久代码（需开启 Templater 的 on file open）

  tR += `# ${m.format('YYYY年MM月')} · 月度（偶数月转发）\n\n`;
  tR += `> 本月归属于双月OKR [[${startTitle}]]–[[${endTitle}]]。请点击上述链接进入主文档。\n\n`;
  tR += `![[${startTitle}]]\n`;
} else {
  // 奇数月：直接输出双月 OKR 结构
  tR += `# ${start.format('YYYY年MM月')}–${end.format('YYYY年MM月')} · 双月OKR\n\n`;
  tR += `> 导航：[[${prevTitle}]] ← 上一周期 | 下一周期 → [[${nextTitle}]]  \n`;
  tR += `> 覆盖月份：[[${startTitle}]] · [[${endTitle}]]\n\n`;
  tR += `## 双月目标\n- **O1**：\n\t- **KR1**：\n\t- **KR2**：\n\t- **KR3**：\n- **O2**：\n\t- **KR1**：\n\t- **KR2**：\n\t- **KR3**：\n- **O3**：\n\t- **KR1**：\n\t- **KR2**：\n\t- **KR3**：\n\n`;
  tR += `## 检查与调整\n- \n\n`;
  tR += `## 风险与缓解\n- 风险：\n- 缓解：\n\n`;
  tR += `## 对齐\n- 月度：[[${startTitle}]] · [[${endTitle}]]\n`;
}
%>
