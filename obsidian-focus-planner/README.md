# Focus Planner - Obsidian Plugin

A calendar-centric task planner for Obsidian with Feishu/Lark calendar sync, pomodoro tracking, and time analytics.

一个以日历为核心的 Obsidian 任务规划插件，支持飞书日历同步、番茄钟追踪和时间分析。

![Focus Planner Screenshot](screenshots/calendar-view.png)

## Features / 功能

### Calendar View / 日历视图
- **Weekly calendar view** with hour-by-hour time slots (8:00-22:00)
- **Drag and drop** events to reschedule
- **Double-click** to create new events
- **Right-click context menu** for quick actions (delete, start pomodoro, open file)
- **Current time indicator** with red line

### Feishu/Lark Calendar Sync / 飞书日历同步
- **CalDAV sync** - Sync events from Feishu calendar via CalDAV protocol
- **Open API sync** - Alternative sync method using Feishu Open API
- **Auto-sync** at configurable intervals
- **Smart category detection** based on event keywords

### Pomodoro Tracking / 番茄钟追踪
- **Pie chart progress** in day headers showing planned vs completed pomodoros
- **Integration with Pomodoro Timer plugin** - Start pomodoro directly from events
- **Automatic tracking** of completed pomodoros from daily notes

### Event Categories / 事件分类
Events are automatically categorized by keywords:

| Color | Category | Keywords |
|:------|:---------|:---------|
| 🟢 Green | Focus/Study | 专注, 学习, 阅读, 代码, demo, 论文, RL, blog |
| 🔵 Blue | Meeting | 会议, 讨论, 周会, Seminar, oneone, sync |
| 🟠 Orange | Personal/Family | 家庭, 个人, 晚间, gym |
| ⚫ Gray | Rest | 午休, 休息, break |
| 🟡 Yellow | Admin | 报销, 行政, Review |

### Daily Note Integration / 日报集成
- Events are stored in daily notes using Dataview inline fields
- Format: `- Task Name [startTime:: HH:MM] [endTime:: HH:MM]`
- Compatible with Full Calendar plugin
- Preserves locally created events during sync

## Installation / 安装

### From GitHub Release

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`)
2. Create folder: `<vault>/.obsidian/plugins/focus-planner/`
3. Copy the downloaded files into the folder
4. Reload Obsidian
5. Enable "Focus Planner" in Settings → Community plugins

### From Source

```bash
git clone https://github.com/zhouh/obsidian-focus-planner.git
cd obsidian-focus-planner
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder.

## Configuration / 配置

### Feishu CalDAV Setup / 飞书 CalDAV 配置

1. Get your CalDAV credentials from Feishu calendar settings
2. In plugin settings, enable "Use CalDAV"
3. Enter your CalDAV username and password (app-specific password)
4. Click "Sync" to test

### Daily Note Path / 日报路径

Default: `0. PeriodicNotes/YYYY/Daily/MM/YYYY-MM-DD.md`

Customize in settings to match your vault structure.

### Task Sources / 待办任务来源

Configure task source folders or files in settings.

- One source per line
- Folder sources should end with `/`
- File sources should use the full Markdown path

### Category Keywords / 分类关键词

Customize which keywords trigger each category in settings.

## Daily Note Format / 日报格式

The plugin reads and writes events in this format:

```markdown
# Day planner

### 🎯 专注时间
- RL学习 6🍅 [startTime:: 09:00] [endTime:: 11:30]

### 📅 会议
- Team Sync [startTime:: 14:00] [endTime:: 15:00]

### 🏠 家庭/个人
- Gym [startTime:: 18:00] [endTime:: 19:00]

### 😴 休息
- Lunch [startTime:: 12:00] [endTime:: 13:00]
```

## Usage Tips / 使用技巧

1. **Create events**: Double-click on any time slot
2. **Move events**: Drag and drop (within same day or across days)
3. **Delete events**: Right-click → Delete
4. **Start pomodoro**: Right-click → Start Pomodoro (requires Pomodoro Timer plugin)
5. **View source**: Right-click → Open in File

## Compatibility / 兼容性

- Obsidian v1.0.0+
- Works with Pomodoro Timer plugin
- Compatible with Full Calendar plugin's event format
- Works with Dataview plugin

## Development / 开发

```bash
npm run dev   # Watch mode
npm run build # Production build
```

## License / 许可

MIT License

## Author / 作者

[zhouh](https://github.com/zhouh)

## Acknowledgments / 致谢

- Obsidian team for the amazing platform
- Feishu/Lark for calendar API
