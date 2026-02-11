import {
  App,
  ItemView,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  moment
} from "obsidian";

const VIEW_TYPE_EISENHOWER = "eisenhower-todos-view";

/** ========== 设置项 ========== */
interface EisenhowerSettings {
  importantTag: string;
  urgentTag: string;
  importantKey: string;
  urgentKey: string;
  startKey: string;
  dueKey: string;
  createdKey: string;
  dateFormat: string;
  writeBackMode: "auto" | "keys" | "tags";
  density: "comfortable" | "compact";
}

const DEFAULT_SETTINGS: EisenhowerSettings = {
  importantTag: "#important",
  urgentTag: "#urgent",
  importantKey: "important",
  urgentKey: "urgent",
  startKey: "start",
  dueKey: "due",
  createdKey: "created",
  dateFormat: "YYYY-MM-DD",
  writeBackMode: "auto",
  density: "comfortable"
};

type Quadrant = "IU" | "InU" | "nIU" | "nInU";

interface TaskItem {
  text: string;
  file: TFile;
  line: number;
  important: boolean;
  urgent: boolean;
  start?: Date;
  due?: Date;
  created?: Date;
  collaborators?: string[];
  tags?: string[];
  originalLine: string;
}

/** ========== 插件主体 ========== */
export default class EisenhowerTodosPlugin extends Plugin {
  settings: EisenhowerSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_EISENHOWER, (leaf) => new EisenhowerView(leaf, this));

    this.addRibbonIcon("check-square", "Open Eisenhower TODOs", () => this.activateView());
    this.addCommand({ id: "open-eisenhower-todos", name: "Open Eisenhower TODOs", callback: () => this.activateView() });

    this.addSettingTab(new EisenhowerSettingTab(this.app, this));

    // 自动刷新
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshView()));
    this.registerEvent(this.app.vault.on("modify", () => this.refreshView()));
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EISENHOWER);
    if (leaves.length === 0) {
      await this.app.workspace.getRightLeaf(false).setViewState({ type: VIEW_TYPE_EISENHOWER, active: true });
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  refreshView() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_EISENHOWER)) {
      const view = leaf.view;
      if (view instanceof EisenhowerView) view.renderTasks();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshView();
  }

  /** ========== 任务读取 ========== */
  async collectTasks(): Promise<TaskItem[]> {
    const files = this.app.vault.getMarkdownFiles();
    const tasks: TaskItem[] = [];
    const importantTag = prefixHash(this.settings.importantTag);
    const urgentTag = prefixHash(this.settings.urgentTag);

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const lines = content.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = /^\s*[-*]\s+\[\s\]\s+(.*)$/.exec(line);
        if (!m) continue;

        const raw = m[1];
        const impKV = extractBool(raw, this.settings.importantKey);
        const urgKV = extractBool(raw, this.settings.urgentKey);

        const important = (typeof impKV === "boolean") ? impKV : raw.includes(importantTag);
        const urgent = (typeof urgKV === "boolean") ? urgKV : raw.includes(urgentTag);

        const start = extractDate(raw, this.settings.startKey, {
          fallbackKeys: this.settings.startKey.trim().toLowerCase() === "start" ? [] : ["start"],
          icons: ["🛫"]
        });

        const due = extractDate(raw, this.settings.dueKey, {
          fallbackKeys: this.settings.dueKey.trim().toLowerCase() === "due" ? [] : ["due"],
          icons: ["📅"]
        });
        let created = extractDate(raw, this.settings.createdKey, {
          fallbackKeys: this.settings.createdKey.trim().toLowerCase() === "created" ? [] : ["created"],
          icons: ["📋"]
        });
        if (!created) {
          const stat = await this.app.vault.adapter.stat(file.path);
          if (stat?.ctime) created = new Date(stat.ctime);
        }

        const collaborators = extractCollaborators(raw);
        const tags = extractTags(raw, importantTag, urgentTag);

        const text = cleanupTaskText(raw, {
          dueKey: this.settings.dueKey,
          createdKey: this.settings.createdKey,
          startKey: this.settings.startKey,
          importantKey: this.settings.importantKey,
          urgentKey: this.settings.urgentKey,
          importantTag,
          urgentTag
        });
        if (!text) continue;

        tasks.push({
          text,
          file,
          line: i,
          important,
          urgent,
          start: start ?? undefined,
          due: due ?? undefined,
          created: created ?? undefined,
          collaborators: collaborators.length > 0 ? collaborators : undefined,
          tags: tags.length > 0 ? tags : undefined,
          originalLine: line
        });
      }
    }
    return tasks;
  }

  /** ========== 写回：完成/重要/紧急 ========= */
  async writeBackToggleDone(t: TaskItem, done: boolean) {
    const today = moment().format(this.settings.dateFormat);
    await this.vaultLineTransform(t.file, t.line, (line) => {
      if (done) {
        // 勾选：[ ] → [x]，并追加 ✅ 日期
        line = line.replace(/^(\s*[-*]\s+\[)\s(\]\s+)/, `$1x$2`);
        // 先移除可能已有的 ✅ 日期，避免重复
        line = line.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "");
        line = `${line} ✅ ${today}`;
      } else {
        // 取消勾选：[x] → [ ]，并移除 ✅ 日期
        line = line.replace(/^(\s*[-*]\s+\[)[xX](\]\s+)/, `$1 $2`);
        line = line.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "");
      }
      return line;
    });
  }

  async writeBackSetImportanceUrgency(t: TaskItem, important: boolean, urgent: boolean) {
    const importantTag = prefixHash(this.settings.importantTag);
    const urgentTag = prefixHash(this.settings.urgentTag);

    await this.vaultLineTransform(t.file, t.line, (line) => {
      const mode = this.settings.writeBackMode;
      const preferKeys =
        mode === "keys" ||
        (mode === "auto" && (line.includes(`${this.settings.importantKey}:`) || line.includes(`${this.settings.urgentKey}:`)));

      if (preferKeys) {
        line = upsertBoolKV(line, this.settings.importantKey, important);
        line = upsertBoolKV(line, this.settings.urgentKey, urgent);
        line = removeTag(line, importantTag);
        line = removeTag(line, urgentTag);
      } else {
        line = removeKV(line, this.settings.importantKey);
        line = removeKV(line, this.settings.urgentKey);
        line = setTag(line, importantTag, important);
        line = setTag(line, urgentTag, urgent);
      }
      return squashSpaces(line);
    });
  }

  /** 行替换工具 */
  private async vaultLineTransform(file: TFile, lineIdx: number, replacer: (line: string) => string) {
    await this.app.vault.process(file, (data) => {
      const arr = data.split(/\r?\n/);
      if (lineIdx < 0 || lineIdx >= arr.length) return data;
      arr[lineIdx] = replacer(arr[lineIdx]);
      return arr.join("\n");
    });
    new Notice("已写回笔记");
  }
}

/** ========== 视图 ========== */
class EisenhowerView extends ItemView {
  plugin: EisenhowerTodosPlugin;
  containerEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: EisenhowerTodosPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_EISENHOWER; }
  getDisplayText(): string { return "Eisenhower TODOs"; }
  getIcon(): string { return "check-square"; }

  async onOpen() { await this.renderTasks(); }
  async onClose() {}

  async renderTasks() {
    const root = this.containerEl;
    root.empty();

    // 密度类名
    if (this.plugin.settings.density === "compact") root.addClass("eis-compact");
    else root.removeClass("eis-compact");

    const wrap = root.createDiv({ cls: "eisenhower-view" });

    const panels: Record<
      Quadrant,
      { title: string; el: HTMLElement; list: HTMLElement; countEl: HTMLElement }
    > = {
      IU: this.createPanel(wrap, "重要 · 紧急", "q-IU"),
      InU: this.createPanel(wrap, "重要 · 不紧急", "q-InU"),
      nIU: this.createPanel(wrap, "不重要 · 紧急", "q-nIU"),
      nInU: this.createPanel(wrap, "不重要 · 不紧急", "q-nInU")
    };

    const today = moment().startOf("day");
    let tasks = await this.plugin.collectTasks();
    tasks = tasks.filter((t) => !t.start || moment(t.start).isSameOrBefore(today, "day"));

    // 排序：due → created
    tasks.sort((a, b) => {
      if (a.due && b.due) return a.due.getTime() - b.due.getTime();
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      if (a.created && b.created) return a.created.getTime() - b.created.getTime();
      return 0;
    });

    const counters: Record<Quadrant, number> = { IU: 0, InU: 0, nIU: 0, nInU: 0 };
    for (const t of tasks) {
      const q = getQuadrant(t);
      counters[q]++;
      panels[q].list.appendChild(this.renderTaskCard(t));
    }
    (Object.keys(panels) as Quadrant[]).forEach((k) => panels[k].countEl.setText(String(counters[k])));

    // 拖拽投放
    for (const [q, p] of Object.entries(panels) as [Quadrant, any][]) {
      p.list.addEventListener("dragover", (ev: DragEvent) => { ev.preventDefault(); p.el.addClass("drop-target"); });
      p.list.addEventListener("dragleave", () => p.el.removeClass("drop-target"));
      p.list.addEventListener("drop", async (ev: DragEvent) => {
        ev.preventDefault(); p.el.removeClass("drop-target");
        const payload = ev.dataTransfer?.getData("application/json");
        if (!payload) return;
        try {
          const data = JSON.parse(payload) as { filePath: string; line: number };
          const file = this.plugin.app.vault.getAbstractFileByPath(data.filePath);
          if (!(file instanceof TFile)) return;

          const targetImportant = (q === "IU" || q === "InU");
          const targetUrgent   = (q === "IU" || q === "nIU");

          await this.plugin.writeBackSetImportanceUrgency(
            { text: "", file, line: data.line, important: false, urgent: false, originalLine: "" } as TaskItem,
            targetImportant, targetUrgent
          );
          await this.renderTasks();
        } catch (e) {
          console.error(e); new Notice("拖拽写回失败");
        }
      });
    }
  }

  private createPanel(container: HTMLElement, title: string, cls: string) {
    const panel = container.createDiv({ cls: `eisenhower-panel ${cls}` });
    const header = panel.createDiv({ cls: "eisenhower-title-row" });
    const titleEl = header.createDiv({ cls: "eisenhower-title" });
    titleEl.setText(title);
    const countEl = header.createDiv({ cls: "eisenhower-count-badge" });
    const list = panel.createDiv({ cls: "eisenhower-list" });
    return { el: panel, list, titleEl, countEl };
  }

  /** 关键：卡片的信息层次更清晰 */
  private renderTaskCard(t: TaskItem): HTMLElement {
    // 极简卡片：核心信息 + 悬浮操作
    const tooltipParts: string[] = [];
    tooltipParts.push(t.file ? `文件: ${t.file.basename}` : "");
    if (t.created) tooltipParts.push(`创建: ${moment(t.created).format(this.plugin.settings.dateFormat)}`);
    if (t.start)   tooltipParts.push(`开始: ${moment(t.start).format(this.plugin.settings.dateFormat)}`);
    if (t.due)     tooltipParts.push(`截止: ${moment(t.due).format(this.plugin.settings.dateFormat)}`);
    tooltipParts.push(`重要: ${t.important ? "是" : "否"}`, `紧急: ${t.urgent ? "是" : "否"}`);

    const card = createDiv({ cls: "eisenhower-card card-min", attr: { draggable: "true", title: tooltipParts.filter(Boolean).join(" · ") } });

    // 拖拽数据
    card.addEventListener("dragstart", (ev: DragEvent) => {
      ev.dataTransfer?.setData("application/json", JSON.stringify({ filePath: t.file.path, line: t.line }));
    });

    // 整个卡片点击跳转
    card.addEventListener("click", async (e) => {
      if (e.target === card || e.target instanceof HTMLElement && !e.target.closest('.icon-toggle') && !e.target.closest('input')) {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(t.file);
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          const editor = view.editor;
          editor.setCursor({ line: t.line, ch: 0 });
          editor.scrollIntoView({ from: { line: t.line, ch: 0 }, to: { line: t.line + 1, ch: 0 } }, true);
        }
      }
    });

    // 顶行：勾选 + 标题
    const top = card.createDiv({ cls: "card-topline" });

    const checkbox = top.createEl("input", { type: "checkbox" });
    checkbox.addClass("card-done-box");
    checkbox.addEventListener("change", async () => {
      await this.plugin.writeBackToggleDone(t, checkbox.checked);
      this.renderTasks();
    });

    const title = top.createDiv({ cls: "task-title" });
    title.setText(t.text);

    // 底部：时间chips + 合作者
    const bottom = card.createDiv({ cls: "card-bottom" });
    const chips = bottom.createDiv({ cls: "time-chips" });

    if (t.start) {
      const startChip = chips.createSpan({ cls: "chip chip-neutral" });
      startChip.setText(`开始 ${moment(t.start).format("MM-DD")}`);
    }

    if (t.due) {
      const today = moment().startOf("day");
      const dueMoment = moment(t.due);
      const dayDiff = dueMoment.clone().startOf("day").diff(today, "days");

      if (dayDiff < 0) {
        card.addClass("card-overdue");
        const overdueChip = chips.createSpan({ cls: "chip chip-danger" });
        overdueChip.setText(`逾期${Math.abs(dayDiff)}天`);
      } else if (dayDiff === 0) {
        card.addClass("card-due-today");
        const todayChip = chips.createSpan({ cls: "chip chip-warning" });
        todayChip.setText("今天到期");
      } else if (dayDiff <= 3) {
        const soonChip = chips.createSpan({ cls: "chip chip-warning" });
        soonChip.setText(`${dayDiff}天后到期`);
      } else {
        const normalChip = chips.createSpan({ cls: "chip chip-neutral" });
        normalChip.setText(dueMoment.format("MM-DD"));
      }
    }

    // 合作者chips
    if (t.collaborators && t.collaborators.length > 0) {
      t.collaborators.forEach(collaborator => {
        const collaboratorChip = chips.createSpan({ cls: "chip chip-collaborator" });
        collaboratorChip.setText(`@${collaborator}`);
      });
    }

    // 标签chips
    if (t.tags && t.tags.length > 0) {
      t.tags.forEach(tag => {
        const tagChip = chips.createSpan({ cls: "chip chip-tag" });
        tagChip.setText(`#${tag}`);
        tagChip.setAttribute("data-tag-color", String(getTagColorIndex(tag)));
      });
    }

    return card;
  }
}

/** ========== 设置面板 ========== */
class EisenhowerSettingTab extends PluginSettingTab {
  plugin: EisenhowerTodosPlugin;
  constructor(app: App, plugin: EisenhowerTodosPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Eisenhower TODOs 设置" });

    new Setting(containerEl).setName("重要标签").setDesc("例如 #important")
      .addText((t)=>t.setValue(this.plugin.settings.importantTag).onChange(async (v)=>{ this.plugin.settings.importantTag=v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("紧急标签").setDesc("例如 #urgent")
      .addText((t)=>t.setValue(this.plugin.settings.urgentTag).onChange(async (v)=>{ this.plugin.settings.urgentTag=v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("重要键名").setDesc("如 important:true/false")
      .addText((t)=>t.setValue(this.plugin.settings.importantKey).onChange(async (v)=>{ this.plugin.settings.importantKey=v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("紧急键名").setDesc("如 urgent:true/false")
      .addText((t)=>t.setValue(this.plugin.settings.urgentKey).onChange(async (v)=>{ this.plugin.settings.urgentKey=v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("截止日期键名").setDesc("如 due:YYYY-MM-DD")
      .addText((t)=>t.setValue(this.plugin.settings.dueKey).onChange(async (v)=>{ this.plugin.settings.dueKey=v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("开始日期键名").setDesc("如 start:YYYY-MM-DD")
      .addText((t)=>t.setValue(this.plugin.settings.startKey).onChange(async (v)=>{ this.plugin.settings.startKey=v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("创建日期键名").setDesc("如 created:YYYY-MM-DD")
      .addText((t)=>t.setValue(this.plugin.settings.createdKey).onChange(async (v)=>{ this.plugin.settings.createdKey=v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("日期显示格式").setDesc("moment 格式，如 YYYY-MM-DD")
      .addText((t)=>t.setValue(this.plugin.settings.dateFormat).onChange(async (v)=>{ this.plugin.settings.dateFormat=v.trim()||"YYYY-MM-DD"; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("写回模式").setDesc("auto：自动判断；keys：只写键值；tags：只增删标签")
      .addDropdown((d)=>{ d.addOption("auto","auto（推荐）"); d.addOption("keys","keys"); d.addOption("tags","tags");
        d.setValue(this.plugin.settings.writeBackMode);
        d.onChange(async (v: "auto"|"keys"|"tags")=>{ this.plugin.settings.writeBackMode=v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl).setName("显示密度")
      .addDropdown((d)=>{ d.addOption("comfortable","舒适"); d.addOption("compact","紧凑");
        d.setValue(this.plugin.settings.density);
        d.onChange(async (v: "comfortable"|"compact")=>{ this.plugin.settings.density=v; await this.plugin.saveSettings(); });
      });

  }
}

/** ========== 工具函数 ========== */
const DATE_TIME_REGEX_FRAGMENT = "\\d{4}-\\d{2}-\\d{2}(?:[ T]\\d{2}:\\d{2}(?::\\d{2})?)?";
const STRICT_DATE_FORMATS = [
  "YYYY-MM-DD",
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DDTHH:mm",
  "YYYY-MM-DDTHH:mm:ss"
];

interface ExtractDateOptions {
  fallbackKeys?: string[];
  icons?: string[];
}

function prefixHash(tag: string) { return tag.startsWith("#") ? tag : `#${tag}`; }

function extractBool(raw: string, key: string): boolean | null {
  const re = new RegExp(`\\b${escapeReg(key)}:(true|false)\\b`, "i");
  const m = re.exec(raw); if (!m) return null;
  return m[1].toLowerCase() === "true";
}

function extractDate(raw: string, key: string, options: ExtractDateOptions = {}): Date | null {
  const { fallbackKeys = [], icons = [] } = options;
  const keys = Array.from(new Set([key, ...fallbackKeys]
    .map((k) => k.trim())
    .filter((k) => k.length > 0)));

  for (const candidate of keys) {
    const kvRe = new RegExp(`\\b${escapeReg(candidate)}:\\s*(?:\\[\\[\\s*)?(${DATE_TIME_REGEX_FRAGMENT})(?:\\s*\\]\\])?`, "i");
    const kvMatch = kvRe.exec(raw);
    if (kvMatch) {
      const parsed = parseDateString(kvMatch[1]);
      if (parsed) return parsed;
    }

    const propertyRe = new RegExp(`\\b${escapeReg(candidate)}::\\s*(?:\\[\\[\\s*)?(${DATE_TIME_REGEX_FRAGMENT})(?:\\s*\\]\\])?`, "i");
    const propertyMatch = propertyRe.exec(raw);
    if (propertyMatch) {
      const parsed = parseDateString(propertyMatch[1]);
      if (parsed) return parsed;
    }
  }

  const iconTokens = Array.from(new Set(icons
    .map((icon) => icon.trim())
    .filter((icon) => icon.length > 0)));

  for (const icon of iconTokens) {
    const baseIcon = icon.endsWith("\uFE0F") ? icon.slice(0, -1) : icon;
    const iconPattern = `${escapeReg(baseIcon)}\\uFE0F?`;
    const iconRe = new RegExp(`${iconPattern}\\s*(?:\\[\\[\\s*)?(${DATE_TIME_REGEX_FRAGMENT})(?:\\s*\\]\\])?`, "i");
    const iconMatch = iconRe.exec(raw);
    if (iconMatch) {
      const parsed = parseDateString(iconMatch[1]);
      if (parsed) return parsed;
    }
  }

  return null;
}

function parseDateString(value: string): Date | null {
  const trimmed = value.trim();
  const parsed = moment(trimmed, STRICT_DATE_FORMATS, true);
  if (parsed.isValid()) return parsed.toDate();

  const iso = moment(trimmed, moment.ISO_8601, true);
  return iso.isValid() ? iso.toDate() : null;
}

function extractCollaborators(raw: string): string[] {
  const re = /@([a-zA-Z0-9_\u4e00-\u9fff]+)/g;
  const collaborators: string[] = [];
  let match;
  while ((match = re.exec(raw)) !== null) {
    collaborators.push(match[1]);
  }
  return collaborators;
}

function extractTags(raw: string, importantTag: string, urgentTag: string): string[] {
  const re = /#([a-zA-Z0-9_\u4e00-\u9fff]+)/g;
  const tags: string[] = [];
  let match;
  while ((match = re.exec(raw)) !== null) {
    const tag = match[1];
    const withHash = `#${tag}`;
    // 排除重要和紧急标签
    if (withHash !== importantTag && withHash !== urgentTag) {
      tags.push(tag);
    }
  }
  return tags;
}

function cleanupTaskText(raw: string, keys: { dueKey: string; startKey: string; createdKey: string; importantKey: string; urgentKey: string; importantTag: string; urgentTag: string; }) {
  let cleaned = raw;

  const datePatterns = [
    new RegExp(`\\b${escapeReg(keys.dueKey)}:\\s*(?:\\[\\[\\s*)?${DATE_TIME_REGEX_FRAGMENT}(?:\\s*\\]\\])?`, "ig"),
    new RegExp(`\\b${escapeReg(keys.dueKey)}::\\s*(?:\\[\\[\\s*)?${DATE_TIME_REGEX_FRAGMENT}(?:\\s*\\]\\])?`, "ig"),
    new RegExp(`\\b${escapeReg(keys.startKey)}:\\s*(?:\\[\\[\\s*)?${DATE_TIME_REGEX_FRAGMENT}(?:\\s*\\]\\])?`, "ig"),
    new RegExp(`\\b${escapeReg(keys.startKey)}::\\s*(?:\\[\\[\\s*)?${DATE_TIME_REGEX_FRAGMENT}(?:\\s*\\]\\])?`, "ig"),
    new RegExp(`\\b${escapeReg(keys.createdKey)}:\\s*(?:\\[\\[\\s*)?${DATE_TIME_REGEX_FRAGMENT}(?:\\s*\\]\\])?`, "ig"),
    new RegExp(`\\b${escapeReg(keys.createdKey)}::\\s*(?:\\[\\[\\s*)?${DATE_TIME_REGEX_FRAGMENT}(?:\\s*\\]\\])?`, "ig")
  ];
  for (const re of datePatterns) cleaned = cleaned.replace(re, "");

  const boolPatterns = [
    new RegExp(`\\b${escapeReg(keys.importantKey)}:(true|false)`, "ig"),
    new RegExp(`\\b${escapeReg(keys.importantKey)}::\\s*(true|false)`, "ig"),
    new RegExp(`\\b${escapeReg(keys.urgentKey)}:(true|false)`, "ig"),
    new RegExp(`\\b${escapeReg(keys.urgentKey)}::\\s*(true|false)`, "ig")
  ];
  for (const re of boolPatterns) cleaned = cleaned.replace(re, "");

  const metadataIcons = ["📅", "🛫", "⏳", "✅", "📋", "🕗"];
  for (const icon of metadataIcons) {
    const baseIcon = icon.endsWith("\uFE0F") ? icon.slice(0, -1) : icon;
    const iconPattern = `${escapeReg(baseIcon)}\\uFE0F?`;
    const iconRe = new RegExp(`${iconPattern}\\s*(?:\\[\\[\\s*)?${DATE_TIME_REGEX_FRAGMENT}(?:\\s*\\]\\])?`, "ig");
    cleaned = cleaned.replace(iconRe, "");
  }

  const priorityIcons = ["⏫", "🔼", "🔽", "⏬"];
  for (const icon of priorityIcons) {
    const iconRe = new RegExp(`${escapeReg(icon)}\\s*`, "ig");
    cleaned = cleaned.replace(iconRe, "");
  }

  cleaned = cleaned
    .replace(new RegExp(`${escapeReg(keys.importantTag)}\\b`, "g"), "")
    .replace(new RegExp(`${escapeReg(keys.urgentTag)}\\b`, "g"), "")
    .replace(/#([a-zA-Z0-9_\u4e00-\u9fff]+)/g, "")
    .replace(/@[a-zA-Z0-9_\u4e00-\u9fff]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned;
}

function upsertBoolKV(line: string, key: string, val: boolean): string {
  const re = new RegExp(`\\b${escapeReg(key)}:(true|false)\\b`, "i");
  if (re.test(line)) return line.replace(re, `${key}:${val ? "true" : "false"}`);
  return `${line} ${key}:${val ? "true" : "false"}`.trim();
}

function removeKV(line: string, key: string): string {
  const re = new RegExp(`\\s*\\b${escapeReg(key)}:(true|false)\\b`, "ig");
  return line.replace(re, "");
}

function setTag(line: string, tag: string, present: boolean): string {
  const has = new RegExp(`\\s*${escapeReg(tag)}\\b`, "ig");
  line = line.replace(has, "");
  return present ? `${line} ${tag}`.trim() : line.trim();
}

function removeTag(line: string, tag: string): string {
  const has = new RegExp(`\\s*${escapeReg(tag)}\\b`, "ig");
  return line.replace(has, "").trim();
}

function squashSpaces(s: string) { return s.replace(/\s{2,}/g, " ").trim(); }
function escapeReg(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function getQuadrant(t: Pick<TaskItem,"important"|"urgent">): Quadrant {
  if (t.important && t.urgent) return "IU";
  if (t.important && !t.urgent) return "InU";
  if (!t.important && t.urgent) return "nIU";
  return "nInU";
}

function getTagColorIndex(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    const char = tag.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % 8; // 8种颜色
}
