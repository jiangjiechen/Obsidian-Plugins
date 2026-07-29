import {
  App,
  ItemView,
  MarkdownView,
  Menu,
  Modal,
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
  /** 分组标签，逗号分隔；象限内按首个命中的标签分组折叠，留空不分组 */
  groupTags: string;
  /** 最近一次 pin 活动的日期（YYYY-MM-DD），用于跨天提示清理，非用户设置 */
  lastPinDate?: string;
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
  density: "comfortable",
  groupTags: ""
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
  priority?: number;
  pinned: boolean;
  originalLine: string;
  /** 缩进子任务（未完成的） */
  children?: TaskItem[];
  /** 已完成（[x]）的直接子任务数，用于进度显示 */
  childDone?: number;
}

const PIN_MARK = "📌";

/** ========== 插件主体 ========== */
export default class EisenhowerTodosPlugin extends Plugin {
  settings: EisenhowerSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_EISENHOWER, (leaf) => new EisenhowerView(leaf, this));

    this.addRibbonIcon("check-square", "Open Eisenhower TODOs", () => this.activateView());
    this.addCommand({ id: "open-eisenhower-todos", name: "Open Eisenhower TODOs", callback: () => this.activateView() });
    this.addCommand({ id: "week-rollover", name: "周滚动向导", callback: () => this.startWeekRollover() });

    this.addSettingTab(new EisenhowerSettingTab(this.app, this));

    // 自动刷新（debounce，避免每次按键触发全 vault 重扫）
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
  }

  onunload() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  private refreshTimer: number | null = null;
  scheduleRefresh() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshView();
    }, 500);
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
      if (view instanceof EisenhowerView) view.renderTasks(true);
    }
  }

  /** 收集带旧周标签（#WeekNN < 当前 ISO 周）的未完成任务并打开滚动向导 */
  async startWeekRollover() {
    const tasks = await this.collectTasks();
    const cur = moment().isoWeek();
    const stale = tasks.filter((t) => {
      const w = extractWeekNum(t.tags);
      return w !== null && w < cur;
    });
    if (stale.length === 0) { new Notice("没有需要滚动的旧周任务"); return; }
    new WeekRolloverModal(this.app, this, stale, cur, () => this.refreshView()).open();
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

      // 缩进栈：把缩进更深的任务行挂到最近的浅缩进任务下，组装父子树
      const stack: { indent: number; task: TaskItem }[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = /^(\s*)[-*]\s+\[(.)\]\s+(.*)$/.exec(line);
        if (!m) { stack.length = 0; continue; }

        const indent = m[1].length;
        const state = m[2];
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
        const parent = stack.length > 0 ? stack[stack.length - 1].task : null;

        if (state === "x" || state === "X") {
          // 已完成行：只计入父任务进度，不入栈
          if (parent) parent.childDone = (parent.childDone ?? 0) + 1;
          continue;
        }
        if (state !== " ") continue; // cancelled（- [-]）等其他状态不显示

        const raw = m[3];
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
        if (!created && file.stat.ctime) created = new Date(file.stat.ctime);

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

        const task: TaskItem = {
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
          priority: extractPriority(tags),
          pinned: raw.includes(PIN_MARK),
          originalLine: line
        };
        if (parent) (parent.children ??= []).push(task);
        else tasks.push(task);
        stack.push({ indent, task });
      }
    }
    return tasks;
  }

  /** ========== 写回：完成/重要/紧急 ========= */
  async writeBackToggleDone(t: TaskItem, done: boolean) {
    const today = moment().format(this.settings.dateFormat);
    const ok = await this.vaultLineTransform(t.file, t.line, (line) => {
      return this.transformDoneLine(line, done, today);
    }, t.originalLine || undefined);
    // 同步内存中的行内容，支持撤销缓冲的二次写回（勾选→撤销）通过校验
    if (ok && t.originalLine) t.originalLine = this.transformDoneLine(t.originalLine, done, today);
    return ok;
  }

  private transformDoneLine(line: string, done: boolean, today: string) {
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
    }, t.originalLine || undefined);
  }

  /** ========== 写回：今日聚焦 pin ========== */
  async writeBackTogglePin(t: TaskItem, pinned: boolean) {
    const ok = await this.vaultLineTransform(t.file, t.line, (line) => {
      line = line.replace(new RegExp(`\\s*${PIN_MARK}\\uFE0F?`, "g"), "");
      return pinned ? `${line} ${PIN_MARK}` : line;
    }, t.originalLine || undefined);
    if (ok) await this.markPinActivity();
  }

  /** 批量清除所有 📌（静默，不逐条弹 Notice） */
  async clearAllPins(tasks: TaskItem[]) {
    let cleared = 0;
    for (const t of tasks) {
      if (!t.pinned) continue;
      const ok = await this.vaultLineTransform(t.file, t.line, (line) => {
        return line.replace(new RegExp(`\\s*${PIN_MARK}\\uFE0F?`, "g"), "");
      }, t.originalLine || undefined, false);
      if (ok) cleared++;
    }
    await this.markPinActivity();
    new Notice(`已清除 ${cleared} 个聚焦标记`);
  }

  async markPinActivity() {
    this.settings.lastPinDate = moment().format("YYYY-MM-DD");
    await this.saveData(this.settings);
  }

  /** ========== 写回：周滚动动作（供向导调用，静默） ========== */
  async writeBackCarryWeek(t: TaskItem, targetWeek: number): Promise<boolean> {
    return this.vaultLineTransform(t.file, t.line, (line) =>
      line.replace(/#[Ww]eek\d{1,2}\b/g, `#Week${targetWeek}`),
      t.originalLine || undefined, false);
  }

  async writeBackDeferDue(t: TaskItem, newDue: string): Promise<boolean> {
    return this.vaultLineTransform(t.file, t.line, (line) =>
      replaceDueDate(line, this.settings.dueKey, newDue),
      t.originalLine || undefined, false);
  }

  async writeBackCancel(t: TaskItem): Promise<boolean> {
    return this.vaultLineTransform(t.file, t.line, (line) =>
      line.replace(/^(\s*[-*]\s+\[)\s(\])/, "$1-$2"),
      t.originalLine || undefined, false);
  }

  async writeBackDoneSilent(t: TaskItem): Promise<boolean> {
    const today = moment().format(this.settings.dateFormat);
    return this.vaultLineTransform(t.file, t.line, (line) =>
      this.transformDoneLine(line, true, today),
      t.originalLine || undefined, false);
  }

  /** 行替换工具：写回前校验行内容，防止文件被外部修改后写错行 */
  private async vaultLineTransform(file: TFile, lineIdx: number, replacer: (line: string) => string, expectedLine?: string, notify = true): Promise<boolean> {
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const arr = data.split(/\r?\n/);
      let idx = lineIdx;
      const lineMatches = idx >= 0 && idx < arr.length
        && (expectedLine === undefined || arr[idx] === expectedLine);
      if (!lineMatches) {
        // 行号失效：按原始内容全文查找，唯一匹配才写回
        if (expectedLine === undefined) return data;
        const found = arr.reduce<number[]>((acc, l, i) => (l === expectedLine ? [...acc, i] : acc), []);
        if (found.length !== 1) return data;
        idx = found[0];
      }
      arr[idx] = replacer(arr[idx]);
      ok = true;
      return arr.join("\n");
    });
    if (notify) {
      if (ok) new Notice("已写回笔记");
      else new Notice("任务行已变化，未写回，请重试");
    }
    return ok;
  }
}

/** ========== 视图 ========== */
class EisenhowerView extends ItemView {
  plugin: EisenhowerTodosPlugin;
  containerEl!: HTMLElement;
  private filterTags: string[] = [];
  private excludeTags: string[] = [];
  private filterCollabs: string[] = [];
  private excludeCollabs: string[] = [];
  private filterTexts: string[] = [];
  private excludeTexts: string[] = [];
  private filterMode: "AND" | "OR" = "OR";
  private cachedTasks: TaskItem[] | null = null;
  /** 已折叠的分组，key 为 `${quadrant}:${tag}`，仅会话内记忆 */
  private collapsedGroups = new Set<string>();
  /** 本会话内已点过「稍后」的周滚动提示 */
  private rolloverDismissed = false;
  /** 完成撤销窗口计数：>0 时冻结重渲染，避免撤销按钮被自动刷新吞掉 */
  private undoHoldCount = 0;

  constructor(leaf: WorkspaceLeaf, plugin: EisenhowerTodosPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_EISENHOWER; }
  getDisplayText(): string { return "Eisenhower TODOs"; }
  getIcon(): string { return "check-square"; }

  async onOpen() { await this.renderTasks(); }
  async onClose() {}

  async renderTasks(reload = false) {
    if (this.undoHoldCount > 0) return; // 撤销窗口期内冻结，到期后会统一刷新
    const root = this.containerEl;
    root.empty();

    // 密度类名
    if (this.plugin.settings.density === "compact") root.addClass("eis-compact");
    else root.removeClass("eis-compact");

    const outer = root.createDiv({ cls: "eisenhower-outer" });
    const wrap = outer.createDiv({ cls: "eisenhower-view" });

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
    if (reload || !this.cachedTasks) this.cachedTasks = await this.plugin.collectTasks();
    let tasks = this.cachedTasks.slice();
    tasks = tasks.filter((t) => !t.start || moment(t.start).isSameOrBefore(today, "day"));

    // 排序：📌 置顶 → #P0 > #P1 > … > 无 P 标签 → due → created
    tasks.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const pa = a.priority ?? Infinity;
      const pb = b.priority ?? Infinity;
      if (pa !== pb) return pa - pb;
      if (a.due && b.due) return a.due.getTime() - b.due.getTime();
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      if (a.created && b.created) return a.created.getTime() - b.created.getTime();
      return 0;
    });

    // 跨天聚焦提示（基于全量任务，不受筛选影响）
    this.renderPinBanner(outer, wrap, this.cachedTasks ?? []);

    // 旧周任务滚动提示
    this.renderRolloverBanner(outer, wrap, this.cachedTasks ?? []);

    // 筛选栏（需要全量 tasks 提取可用 tags）
    this.renderFilterToolbar(outer, wrap, tasks);

    // 应用筛选（tag + collaborator + 文本，包含 + 排除）
    const hasFilter = this.filterTags.length > 0 || this.excludeTags.length > 0
      || this.filterCollabs.length > 0 || this.excludeCollabs.length > 0
      || this.filterTexts.length > 0 || this.excludeTexts.length > 0;
    if (hasFilter) {
      tasks = tasks.filter((t) => {
        // 卡片级判定：子任务命中也保留整卡
        const agg = aggregateCard(t);
        const taskTags = agg.tags;
        const taskCollabs = agg.collabs;
        const taskText = agg.text;
        // 排除优先
        if (this.excludeTags.some((et) => taskTags.includes(et))) return false;
        if (this.excludeCollabs.some((ec) => taskCollabs.includes(ec))) return false;
        if (this.excludeTexts.some((eq) => taskText.includes(eq.toLowerCase()))) return false;
        // 包含：tag、collab、文本各自独立判断，都要通过
        let tagPass = true;
        if (this.filterTags.length > 0) {
          tagPass = this.filterMode === "AND"
            ? this.filterTags.every((ft) => taskTags.includes(ft))
            : this.filterTags.some((ft) => taskTags.includes(ft));
        }
        let collabPass = true;
        if (this.filterCollabs.length > 0) {
          collabPass = this.filterCollabs.some((fc) => taskCollabs.includes(fc));
        }
        const textPass = this.filterTexts.every((fq) => taskText.includes(fq.toLowerCase()));
        return tagPass && collabPass && textPass;
      });
    }

    const groupTags = this.plugin.settings.groupTags
      .split(",")
      .map((s) => s.trim().replace(/^#/, ""))
      .filter((s) => s.length > 0);

    const byQuadrant: Record<Quadrant, TaskItem[]> = { IU: [], InU: [], nIU: [], nInU: [] };
    for (const t of tasks) byQuadrant[getQuadrant(t)].push(t);

    for (const q of Object.keys(panels) as Quadrant[]) {
      panels[q].countEl.setText(String(byQuadrant[q].length));
      this.renderQuadrantList(panels[q].list, q, byQuadrant[q], groupTags);
    }

    // 拖拽投放
    for (const [q, p] of Object.entries(panels) as [Quadrant, any][]) {
      p.list.addEventListener("dragover", (ev: DragEvent) => { ev.preventDefault(); p.el.addClass("drop-target"); });
      p.list.addEventListener("dragleave", () => p.el.removeClass("drop-target"));
      p.list.addEventListener("drop", async (ev: DragEvent) => {
        ev.preventDefault(); p.el.removeClass("drop-target");
        const payload = ev.dataTransfer?.getData("application/json");
        if (!payload) return;
        try {
          const data = JSON.parse(payload) as { filePath: string; line: number; originalLine?: string };
          const file = this.plugin.app.vault.getAbstractFileByPath(data.filePath);
          if (!(file instanceof TFile)) return;

          const targetImportant = (q === "IU" || q === "InU");
          const targetUrgent   = (q === "IU" || q === "nIU");

          await this.plugin.writeBackSetImportanceUrgency(
            { text: "", file, line: data.line, important: false, urgent: false, originalLine: data.originalLine ?? "" } as TaskItem,
            targetImportant, targetUrgent
          );
          await this.renderTasks(true);
        } catch (e) {
          console.error(e); new Notice("拖拽写回失败");
        }
      });
    }
  }

  /** 跨天后仍有 📌 任务时提示清理，每天只问一次 */
  private renderPinBanner(outer: HTMLElement, grid: HTMLElement, allTasks: TaskItem[]) {
    const pinned = allTasks.filter((t) => t.pinned);
    if (pinned.length === 0) return;
    const today = moment().format("YYYY-MM-DD");
    if (this.plugin.settings.lastPinDate === today) return;

    const banner = outer.createDiv({ cls: "eis-pin-banner" });
    outer.insertBefore(banner, grid);
    banner.createSpan({ cls: "eis-pin-banner-text", text: `${PIN_MARK} 此前聚焦的 ${pinned.length} 个任务还在，今天继续吗？` });
    const keepBtn = banner.createEl("button", { cls: "eis-pin-banner-btn", text: "保留" });
    keepBtn.addEventListener("click", async () => {
      await this.plugin.markPinActivity();
      this.renderTasks();
    });
    const clearBtn = banner.createEl("button", { cls: "eis-pin-banner-btn eis-pin-banner-clear", text: "清除全部" });
    clearBtn.addEventListener("click", async () => {
      await this.plugin.clearAllPins(pinned);
      this.renderTasks(true);
    });
  }

  /** 检测到旧周标签任务时提示启动周滚动向导，「稍后」本会话内不再提示 */
  private renderRolloverBanner(outer: HTMLElement, grid: HTMLElement, allTasks: TaskItem[]) {
    if (this.rolloverDismissed) return;
    const cur = moment().isoWeek();
    const stale = allTasks.filter((t) => {
      const w = extractWeekNum(t.tags);
      return w !== null && w < cur;
    });
    if (stale.length === 0) return;

    const banner = outer.createDiv({ cls: "eis-pin-banner eis-rollover-banner" });
    outer.insertBefore(banner, grid);
    banner.createSpan({ cls: "eis-pin-banner-text", text: `⏭ 有 ${stale.length} 个旧周任务待滚动到 #Week${cur}` });
    const startBtn = banner.createEl("button", { cls: "eis-pin-banner-btn", text: "开始周滚动" });
    startBtn.addEventListener("click", () => {
      new WeekRolloverModal(this.app, this.plugin, stale, cur, () => this.renderTasks(true)).open();
    });
    const laterBtn = banner.createEl("button", { cls: "eis-pin-banner-btn eis-pin-banner-clear", text: "稍后" });
    laterBtn.addEventListener("click", () => {
      this.rolloverDismissed = true;
      this.renderTasks();
    });
  }

  private renderFilterToolbar(outer: HTMLElement, grid: HTMLElement, allTasks: TaskItem[]) {
    // 收集所有可用 tag 和 collaborator（含子任务）
    const allTagSet = new Set<string>();
    const allCollabSet = new Set<string>();
    for (const t of allTasks) {
      const agg = aggregateCard(t);
      agg.tags.forEach((tag) => allTagSet.add(tag));
      agg.collabs.forEach((c) => allCollabSet.add(c));
    }
    const allTagNames = Array.from(allTagSet).sort();
    const allCollabNames = Array.from(allCollabSet).sort();

    const toolbar = outer.createDiv({ cls: "eis-filter-toolbar" });
    outer.insertBefore(toolbar, grid);

    // AND/OR 切换（≥2 个包含 tag 时显示）
    if (this.filterTags.length >= 2) {
      const modeBtn = toolbar.createEl("button", {
        cls: "eis-filter-mode-btn",
        text: this.filterMode,
        attr: { title: this.filterMode === "AND" ? "所有标签都匹配" : "任一标签匹配" },
      });
      modeBtn.addEventListener("click", () => {
        this.filterMode = this.filterMode === "AND" ? "OR" : "AND";
        this.renderTasks();
      });
    }

    // 渲染 filter chip 的通用函数
    const renderChip = (
      name: string, prefix: string, chipCls: string,
      includeList: string[], excludeList: string[], isExclude: boolean,
      colorAttr?: { key: string; value: string },
      suffix = ""
    ) => {
      const cls = `chip ${chipCls} eis-filter-chip${isExclude ? " eis-filter-exclude" : ""}`;
      const chip = toolbar.createSpan({ cls });
      if (colorAttr) chip.setAttribute(colorAttr.key, colorAttr.value);
      const labelCls = isExclude ? "eis-exclude-label" : undefined;
      const label = chip.createSpan({
        text: `${prefix}${name}${suffix}`,
        cls: labelCls,
        attr: { title: isExclude ? "点击切换为包含" : "点击切换为排除" },
      });
      chip.createSpan({ cls: "eis-chip-remove", text: "×" });
      label.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isExclude) {
          const idx = excludeList.indexOf(name);
          if (idx >= 0) excludeList.splice(idx, 1);
          includeList.push(name);
        } else {
          const idx = includeList.indexOf(name);
          if (idx >= 0) includeList.splice(idx, 1);
          excludeList.push(name);
        }
        this.renderTasks();
      });
      chip.querySelector(".eis-chip-remove")!.addEventListener("click", (e) => {
        e.stopPropagation();
        const list = isExclude ? excludeList : includeList;
        const idx = list.indexOf(name);
        if (idx >= 0) list.splice(idx, 1);
        this.renderTasks();
      });
    };

    // Tag chips
    for (const tag of this.filterTags) {
      renderChip(tag, "#", "chip-tag", this.filterTags, this.excludeTags, false,
        { key: "data-tag-color", value: String(getTagColorIndex(tag)) });
    }
    for (const tag of this.excludeTags) {
      renderChip(tag, "#", "chip-tag", this.filterTags, this.excludeTags, true,
        { key: "data-tag-color", value: String(getTagColorIndex(tag)) });
    }

    // Collaborator chips
    for (const c of this.filterCollabs) {
      renderChip(c, "@", "chip-collaborator", this.filterCollabs, this.excludeCollabs, false);
    }
    for (const c of this.excludeCollabs) {
      renderChip(c, "@", "chip-collaborator", this.filterCollabs, this.excludeCollabs, true);
    }

    // 文本搜索 chips
    for (const q of this.filterTexts) {
      renderChip(q, "“", "chip-text", this.filterTexts, this.excludeTexts, false, undefined, "”");
    }
    for (const q of this.excludeTexts) {
      renderChip(q, "“", "chip-text", this.filterTexts, this.excludeTexts, true, undefined, "”");
    }

    // 清除全部
    const totalFilters = this.filterTags.length + this.excludeTags.length
      + this.filterCollabs.length + this.excludeCollabs.length
      + this.filterTexts.length + this.excludeTexts.length;
    if (totalFilters >= 2) {
      const clearBtn = toolbar.createEl("button", {
        cls: "eis-filter-clear",
        text: "清除",
        attr: { title: "清除所有筛选" },
      });
      clearBtn.addEventListener("click", () => {
        this.filterTags = [];
        this.excludeTags = [];
        this.filterCollabs = [];
        this.excludeCollabs = [];
        this.filterTexts = [];
        this.excludeTexts = [];
        this.renderTasks();
      });
    }

    // 输入框 + 统一下拉（tag + collaborator 混合搜索）
    const inputWrapper = toolbar.createDiv({ cls: "eis-filter-input-wrapper" });
    const input = inputWrapper.createEl("input", {
      cls: "eis-filter-input",
      attr: { type: "text", placeholder: "搜索 / #tag / @人…" },
    });
    const dropdown = inputWrapper.createDiv({ cls: "eis-filter-dropdown" });
    dropdown.style.display = "none";

    type SuggestionItem = { type: "tag" | "collab" | "text"; name: string };
    let selectedIdx = -1;
    let currentMatches: SuggestionItem[] = [];

    const updateSelection = () => {
      const items = dropdown.querySelectorAll(".eis-filter-dropdown-item");
      items.forEach((el, i) => {
        el.toggleClass("is-selected", i === selectedIdx);
      });
    };

    const showSuggestions = (query: string) => {
      dropdown.empty();
      selectedIdx = -1;
      const rawQ = query.trim();
      // 前缀路由：# 只补全 tag，@ 只补全协作人，其他文本搜索优先
      const isTagPrefix = rawQ.startsWith("#");
      const isCollabPrefix = rawQ.startsWith("@");
      const q = (isTagPrefix || isCollabPrefix ? rawQ.slice(1) : rawQ).toLowerCase();
      currentMatches = [];

      // tag 候选
      const tagMatches = isCollabPrefix ? [] : allTagNames
        .filter((t) => !this.filterTags.includes(t) && !this.excludeTags.includes(t))
        .filter((t) => !q || t.toLowerCase().includes(q))
        .map((name): SuggestionItem => ({ type: "tag", name }));

      // collaborator 候选
      const collabMatches = isTagPrefix ? [] : allCollabNames
        .filter((c) => !this.filterCollabs.includes(c) && !this.excludeCollabs.includes(c))
        .filter((c) => !q || c.toLowerCase().includes(q))
        .map((name): SuggestionItem => ({ type: "collab", name }));

      // 文本搜索项：非前缀输入时排第一
      const textMatches: SuggestionItem[] = (!isTagPrefix && !isCollabPrefix && rawQ && !this.filterTexts.includes(rawQ))
        ? [{ type: "text", name: rawQ }]
        : [];

      currentMatches = [...textMatches, ...tagMatches, ...collabMatches].slice(0, 10);

      if (currentMatches.length === 0 || !rawQ) {
        dropdown.style.display = "none";
        return;
      }
      dropdown.style.display = "block";
      for (const s of currentMatches) {
        const item = dropdown.createDiv({ cls: "eis-filter-dropdown-item" });
        if (s.type === "tag") {
          const tagChip = item.createSpan({ cls: "chip chip-tag" });
          tagChip.setText(`#${s.name}`);
          tagChip.setAttribute("data-tag-color", String(getTagColorIndex(s.name)));
        } else if (s.type === "collab") {
          const collabChip = item.createSpan({ cls: "chip chip-collaborator" });
          collabChip.setText(`@${s.name}`);
        } else {
          item.createSpan({ cls: "eis-search-suggestion", text: `搜索 “${s.name}”` });
        }
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectItem(s);
        });
      }
    };

    const selectItem = (s: SuggestionItem) => {
      if (s.type === "tag") this.filterTags.push(s.name);
      else if (s.type === "collab") this.filterCollabs.push(s.name);
      else this.filterTexts.push(s.name);
      this.renderTasks();
    };

    input.addEventListener("input", () => showSuggestions(input.value));
    input.addEventListener("focus", () => { if (input.value) showSuggestions(input.value); });
    input.addEventListener("blur", () => {
      setTimeout(() => { dropdown.style.display = "none"; }, 150);
    });
    input.addEventListener("keydown", (e) => {
      const visible = dropdown.style.display !== "none";
      const maxIdx = currentMatches.length - 1;
      if (e.key === "ArrowDown" && visible) {
        e.preventDefault();
        selectedIdx = selectedIdx < maxIdx ? selectedIdx + 1 : 0;
        updateSelection();
      } else if (e.key === "ArrowUp" && visible) {
        e.preventDefault();
        selectedIdx = selectedIdx > 0 ? selectedIdx - 1 : maxIdx;
        updateSelection();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (visible && selectedIdx >= 0 && selectedIdx <= maxIdx) {
          selectItem(currentMatches[selectedIdx]);
        } else if (visible && currentMatches.length > 0) {
          selectItem(currentMatches[0]);
        }
      } else if (e.key === "Escape") {
        dropdown.style.display = "none";
        input.blur();
      }
    });

    // 分组快捷入口：点击弹出标签勾选菜单，写入 groupTags 设置
    const currentGroups = this.plugin.settings.groupTags
      .split(",").map((s) => s.trim().replace(/^#/, "")).filter((s) => s.length > 0);
    const groupBtn = toolbar.createEl("button", {
      cls: `eis-filter-mode-btn eis-group-btn${currentGroups.length > 0 ? " eis-group-btn-on" : ""}`,
      text: currentGroups.length > 0 ? `分组·${currentGroups.length}` : "分组",
      attr: { title: "按标签分组折叠（勾选作为分组维度的标签）" },
    });
    groupBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      for (const tag of allTagNames) {
        menu.addItem((item) => item
          .setTitle(`#${tag}`)
          .setChecked(currentGroups.includes(tag))
          .onClick(async () => {
            const next = currentGroups.includes(tag)
              ? currentGroups.filter((g) => g !== tag)
              : [...currentGroups, tag];
            this.plugin.settings.groupTags = next.join(",");
            await this.plugin.saveSettings();
          }));
      }
      if (currentGroups.length > 0) {
        menu.addSeparator();
        menu.addItem((item) => item
          .setTitle("清除分组")
          .onClick(async () => {
            this.plugin.settings.groupTags = "";
            await this.plugin.saveSettings();
          }));
      }
      menu.showAtMouseEvent(e);
    });
  }

  /** 象限内渲染：配置了分组标签时按首个命中的 tag 分小节（可折叠），否则平铺 */
  private renderQuadrantList(list: HTMLElement, q: Quadrant, qTasks: TaskItem[], groupTags: string[]) {
    if (groupTags.length === 0) {
      qTasks.forEach((t) => list.appendChild(this.renderTaskCard(t)));
      return;
    }
    const buckets = new Map<string, TaskItem[]>();
    for (const t of qTasks) {
      const cardTags = aggregateCard(t).tags;
      const g = groupTags.find((gt) => cardTags.includes(gt)) ?? "";
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g)!.push(t);
    }
    // 全部未命中分组标签时不渲染「其他」小节，直接平铺
    if (buckets.size === 1 && buckets.has("")) {
      qTasks.forEach((t) => list.appendChild(this.renderTaskCard(t)));
      return;
    }
    const order = [...groupTags.filter((g) => buckets.has(g)), ...(buckets.has("") ? [""] : [])];
    for (const g of order) {
      const groupTasks = buckets.get(g)!;
      const key = `${q}:${g}`;
      const collapsed = this.collapsedGroups.has(key);

      const header = list.createDiv({ cls: "eis-group-header" });
      header.createSpan({ cls: "eis-group-arrow", text: collapsed ? "▸" : "▾" });
      if (g) {
        const tagChip = header.createSpan({ cls: "chip chip-tag", text: `#${g}` });
        tagChip.setAttribute("data-tag-color", String(getTagColorIndex(g)));
      } else {
        header.createSpan({ cls: "eis-group-name", text: "其他" });
      }
      header.createSpan({ cls: "eis-group-count", text: String(groupTasks.length) });
      header.addEventListener("click", () => {
        if (collapsed) this.collapsedGroups.delete(key);
        else this.collapsedGroups.add(key);
        this.renderTasks();
      });

      if (!collapsed) groupTasks.forEach((t) => list.appendChild(this.renderTaskCard(t)));
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

  private async openTaskLocation(t: TaskItem) {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(t.file);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
      const editor = view.editor;
      editor.setCursor({ line: t.line, ch: 0 });
      editor.scrollIntoView({ from: { line: t.line, ch: 0 }, to: { line: t.line + 1, ch: 0 } }, true);
    }
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
    if (t.pinned) card.addClass("card-pinned");

    // 拖拽数据
    card.addEventListener("dragstart", (ev: DragEvent) => {
      ev.dataTransfer?.setData("application/json", JSON.stringify({ filePath: t.file.path, line: t.line, originalLine: t.originalLine }));
    });

    // 整个卡片点击跳转
    card.addEventListener("click", async (e) => {
      if (e.target === card || e.target instanceof HTMLElement && !e.target.closest('.icon-toggle') && !e.target.closest('input')) {
        await this.openTaskLocation(t);
      }
    });

    // 顶行：勾选 + 标题
    const top = card.createDiv({ cls: "card-topline" });

    const checkbox = top.createEl("input", { type: "checkbox" });
    checkbox.addClass("card-done-box");
    checkbox.addEventListener("change", async () => {
      if (!checkbox.checked) {
        await this.plugin.writeBackToggleDone(t, false);
        this.renderTasks(true);
        return;
      }
      // 完成撤销缓冲：立即写回，卡片保留 5 秒可撤销
      this.undoHoldCount++;
      await this.plugin.writeBackToggleDone(t, true);
      card.addClass("card-done-pending");
      const undoBtn = top.createEl("button", { cls: "card-undo-btn", text: "撤销" });
      const timer = window.setTimeout(() => {
        this.undoHoldCount--;
        if (this.undoHoldCount === 0) this.renderTasks(true);
      }, 5000);
      undoBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        window.clearTimeout(timer);
        await this.plugin.writeBackToggleDone(t, false);
        this.undoHoldCount--;
        card.removeClass("card-done-pending");
        undoBtn.remove();
        checkbox.checked = false;
        if (this.undoHoldCount === 0) this.renderTasks(true);
      });
    });

    const title = top.createDiv({ cls: "task-title" });
    title.setText(t.text);

    // 子任务完成进度
    const doneCount = t.childDone ?? 0;
    const totalChildren = (t.children?.length ?? 0) + doneCount;
    if (totalChildren > 0) {
      top.createSpan({ cls: "card-progress", text: `${doneCount}/${totalChildren}` });
    }

    // 聚焦按钮：常显（移动端无 hover），未 pin 时灰显
    const pinBtn = top.createEl("button", {
      cls: `card-pin-btn${t.pinned ? " is-pinned" : ""}`,
      text: PIN_MARK,
      attr: { title: t.pinned ? "取消聚焦" : "加入今日聚焦" }
    });
    pinBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.plugin.writeBackTogglePin(t, !t.pinned);
      this.renderTasks(true);
    });

    // 子任务紧凑行（递归，缩进展示）
    if (t.children && t.children.length > 0) {
      const childrenWrap = card.createDiv({ cls: "card-children" });
      const renderChildRow = (ct: TaskItem, depth: number) => {
        const row = childrenWrap.createDiv({ cls: "card-child-row" });
        if (depth > 0) row.style.paddingLeft = `${depth * 14}px`;
        const cb = row.createEl("input", { type: "checkbox" });
        cb.addClass("card-child-box");
        cb.addEventListener("change", async () => {
          await this.plugin.writeBackToggleDone(ct, cb.checked);
          this.renderTasks(true);
        });
        row.createSpan({ cls: "card-child-text", text: ct.text });
        if (ct.due) {
          const dayDiff = moment(ct.due).startOf("day").diff(moment().startOf("day"), "days");
          const cls = dayDiff < 0 ? "chip chip-danger" : dayDiff <= 3 ? "chip chip-warning" : "chip chip-neutral";
          row.createSpan({ cls, text: moment(ct.due).format("MM-DD") });
        }
        row.addEventListener("click", async (e) => {
          if (e.target instanceof HTMLElement && e.target.closest("input")) return;
          e.stopPropagation();
          await this.openTaskLocation(ct);
        });
        (ct.children ?? []).forEach((c) => renderChildRow(c, depth + 1));
      };
      t.children.forEach((c) => renderChildRow(c, 0));
    }

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

    new Setting(containerEl).setName("分组标签").setDesc("逗号分隔，如 abra,kadabra；象限内按首个命中的标签分组折叠，留空不分组")
      .addText((t)=>t.setValue(this.plugin.settings.groupTags).onChange(async (v)=>{ this.plugin.settings.groupTags=v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("显示密度")
      .addDropdown((d)=>{ d.addOption("comfortable","舒适"); d.addOption("compact","紧凑");
        d.setValue(this.plugin.settings.density);
        d.onChange(async (v: "comfortable"|"compact")=>{ this.plugin.settings.density=v; await this.plugin.saveSettings(); });
      });

  }
}

/** ========== 周滚动向导 ========== */
class WeekRolloverModal extends Modal {
  private plugin: EisenhowerTodosPlugin;
  private tasks: TaskItem[];
  private targetWeek: number;
  private onFinish: () => void;
  private idx = 0;
  private stats = { done: 0, carry: 0, defer: 0, cancel: 0, skip: 0 };

  constructor(app: App, plugin: EisenhowerTodosPlugin, tasks: TaskItem[], targetWeek: number, onFinish: () => void) {
    super(app);
    this.plugin = plugin;
    this.tasks = tasks;
    this.targetWeek = targetWeek;
    this.onFinish = onFinish;
  }

  onOpen() {
    this.modalEl.addClass("eis-rollover-modal");
    const keys: Array<[string, "done" | "carry" | "defer" | "cancel" | "skip"]> =
      [["1", "done"], ["2", "carry"], ["3", "defer"], ["4", "cancel"], ["5", "skip"]];
    for (const [key, action] of keys) {
      this.scope.register([], key, () => { this.act(action); return false; });
    }
    this.renderCurrent();
  }

  onClose() {
    this.contentEl.empty();
    this.onFinish();
  }

  private renderCurrent() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.idx >= this.tasks.length) { this.renderSummary(); return; }
    const t = this.tasks[this.idx];

    contentEl.createDiv({ cls: "eis-rollover-progress", text: `${this.idx + 1} / ${this.tasks.length}` });
    contentEl.createEl("h3", { cls: "eis-rollover-title", text: t.text });

    const meta = contentEl.createDiv({ cls: "eis-rollover-meta" });
    const quadrantNames: Record<Quadrant, string> = {
      IU: "重要 · 紧急", InU: "重要 · 不紧急", nIU: "不重要 · 紧急", nInU: "不重要 · 不紧急"
    };
    meta.createSpan({ cls: "meta-pill", text: quadrantNames[getQuadrant(t)] });
    if (t.due) {
      const dayDiff = moment(t.due).startOf("day").diff(moment().startOf("day"), "days");
      const dueText = moment(t.due).format("MM-DD") + (dayDiff < 0 ? `（逾期${Math.abs(dayDiff)}天）` : "");
      meta.createSpan({ cls: `meta-pill${dayDiff < 0 ? " eis-rollover-overdue" : ""}`, text: `截止 ${dueText}` });
    }
    (t.tags ?? []).forEach((tag) => {
      const chip = meta.createSpan({ cls: "chip chip-tag", text: `#${tag}` });
      chip.setAttribute("data-tag-color", String(getTagColorIndex(tag)));
    });
    (t.collaborators ?? []).forEach((c) => meta.createSpan({ cls: "chip chip-collaborator", text: `@${c}` }));
    meta.createSpan({ cls: "eis-rollover-file", text: t.file.basename });

    const actions = contentEl.createDiv({ cls: "eis-rollover-actions" });
    const mkBtn = (label: string, action: "done" | "carry" | "defer" | "cancel" | "skip", cls = "") => {
      const btn = actions.createEl("button", { cls: `eis-rollover-btn ${cls}`, text: label });
      btn.addEventListener("click", () => this.act(action));
    };
    mkBtn("✅ 完成 (1)", "done");
    mkBtn(`⏭ 结转到 #Week${this.targetWeek} (2)`, "carry", "eis-rollover-primary");
    mkBtn("⏰ 推迟一周 (3)", "defer");
    mkBtn("✖ 放弃 (4)", "cancel");
    mkBtn("跳过 (5)", "skip");
  }

  private async act(action: "done" | "carry" | "defer" | "cancel" | "skip") {
    const t = this.tasks[this.idx];
    if (!t) return;
    let ok = true;
    switch (action) {
      case "done": ok = await this.plugin.writeBackDoneSilent(t); break;
      case "carry": ok = await this.plugin.writeBackCarryWeek(t, this.targetWeek); break;
      case "defer": {
        const base = t.due ? moment(t.due) : moment();
        ok = await this.plugin.writeBackDeferDue(t, base.add(7, "days").format("YYYY-MM-DD"));
        break;
      }
      case "cancel": ok = await this.plugin.writeBackCancel(t); break;
      case "skip": break;
    }
    if (ok) {
      this.stats[action]++;
    } else {
      new Notice("该任务行已变化，写回失败，计为跳过");
      this.stats.skip++;
    }
    this.idx++;
    this.renderCurrent();
  }

  private renderSummary() {
    const { contentEl } = this;
    const s = this.stats;
    contentEl.createEl("h3", { text: "周滚动完成 🎉" });
    contentEl.createEl("p", {
      cls: "eis-rollover-summary",
      text: `完成 ${s.done} · 结转 ${s.carry} · 推迟 ${s.defer} · 放弃 ${s.cancel} · 跳过 ${s.skip}`
    });
    const closeBtn = contentEl.createEl("button", { cls: "eis-rollover-btn eis-rollover-primary", text: "关闭" });
    closeBtn.addEventListener("click", () => this.close());
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

const WEEK_TAG_RE = /^[Ww]eek(\d{1,2})$/;

/** 任务上的周数（#Week31 → 31），无周标签返回 null */
function extractWeekNum(tags?: string[]): number | null {
  for (const tag of tags ?? []) {
    const m = WEEK_TAG_RE.exec(tag);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/** 替换行内 due 日期（kv / :: / 📅 三种写法），都没有则行尾追加 */
function replaceDueDate(line: string, dueKey: string, newDate: string): string {
  const keys = Array.from(new Set([dueKey, "due"]));
  const patterns = [
    ...keys.map((k) => new RegExp(`(\\b${escapeReg(k)}::?\\s*(?:\\[\\[\\s*)?)${DATE_TIME_REGEX_FRAGMENT}`, "i")),
    new RegExp(`(📅\\uFE0F?\\s*(?:\\[\\[\\s*)?)${DATE_TIME_REGEX_FRAGMENT}`, "i")
  ];
  for (const re of patterns) {
    if (re.test(line)) return line.replace(re, `$1${newDate}`);
  }
  return `${line} ${dueKey}:${newDate}`;
}

function extractPriority(tags: string[]): number | undefined {
  let best: number | undefined;
  for (const tag of tags) {
    const m = /^p(\d+)$/i.exec(tag);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (best === undefined || n < best) best = n;
  }
  return best;
}

function extractTags(raw: string, importantTag: string, urgentTag: string): string[] {
  const re = /#([a-zA-Z0-9_\-\u4e00-\u9fff]+)/g;
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

  // 📌 聚焦标记（无附带日期）
  cleaned = cleaned.replace(new RegExp(`${PIN_MARK}\\uFE0F?\\s*`, "g"), "");

  cleaned = cleaned
    .replace(new RegExp(`${escapeReg(keys.importantTag)}\\b`, "g"), "")
    .replace(new RegExp(`${escapeReg(keys.urgentTag)}\\b`, "g"), "")
    .replace(/#([a-zA-Z0-9_\-\u4e00-\u9fff]+)/g, "")
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

/** 卡片级聚合：父任务 + 所有后代的文本/tag/协作人并集，用于筛选和分组 */
function aggregateCard(t: TaskItem): { text: string; tags: string[]; collabs: string[] } {
  const texts: string[] = [];
  const tags = new Set<string>();
  const collabs = new Set<string>();
  const walk = (n: TaskItem) => {
    texts.push(n.text.toLowerCase());
    (n.tags ?? []).forEach((tag) => tags.add(tag));
    (n.collaborators ?? []).forEach((c) => collabs.add(c));
    (n.children ?? []).forEach(walk);
  };
  walk(t);
  return { text: texts.join("\n"), tags: Array.from(tags), collabs: Array.from(collabs) };
}

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
