# Collapsible Task Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a collapsible task panel that defaults to collapsed so the weekly calendar keeps more horizontal space.

**Architecture:** Keep collapse state inside `FocusPlannerView` instead of plugin settings. Introduce a small pure helper module for task-panel display state so the collapse behavior can be covered with a focused regression test, then wire the view and CSS to use that state.

**Tech Stack:** TypeScript, Obsidian view APIs, CSS, Node test runner, esbuild

---

### Task 1: Add regression test for task-panel state

**Files:**
- Create: `src/taskPanelState.ts`
- Create: `tests/task-panel-state.test.mjs`
- Create: `tmp-tests/.gitkeep`
- Test: `tests/task-panel-state.test.mjs`

**Step 1: Write the failing test**

Create a test that asserts collapsed state returns:

- `isExpanded === false`
- toggle label for expand
- hidden panel/content flags

Create a second test that asserts expanded state returns:

- `isExpanded === true`
- toggle label for collapse
- visible panel/content flags

**Step 2: Run test to verify it fails**

Run: `npx esbuild src/taskPanelState.ts --platform=node --format=esm --outfile=tmp-tests/taskPanelState.mjs && node --test tests/task-panel-state.test.mjs`

Expected: FAIL because `src/taskPanelState.ts` does not exist yet.

**Step 3: Write minimal implementation**

Add a small pure helper that maps `isExpanded` to labels, title text, aria state, and visibility booleans.

**Step 4: Run test to verify it passes**

Run: `npx esbuild src/taskPanelState.ts --platform=node --format=esm --outfile=tmp-tests/taskPanelState.mjs && node --test tests/task-panel-state.test.mjs`

Expected: PASS

### Task 2: Wire collapse behavior into the view

**Files:**
- Modify: `src/calendarView.ts`

**Step 1: Write the failing test**

Use the helper-based regression test from Task 1 as the failing behavior definition for default-collapsed UI metadata.

**Step 2: Run test to verify it fails**

Re-run the Task 1 command before the helper exists.

**Step 3: Write minimal implementation**

Update the view to:

- hold `isTaskPanelExpanded = false`
- render a separate toggle rail between calendar and task panel
- apply expanded/collapsed classes using the helper
- lazy-load tasks on first expand

**Step 4: Run test to verify it passes**

Run the Task 1 command again after wiring the helper and state.

Expected: PASS

### Task 3: Style the collapsed and expanded states

**Files:**
- Modify: `styles.css`

**Step 1: Write the failing test**

The helper-based test still defines the intended visibility semantics; CSS has no direct automated coverage in this repo.

**Step 2: Run test to verify it fails**

Not applicable beyond Task 1 regression test.

**Step 3: Write minimal implementation**

Add styles for:

- the toggle rail
- collapsed panel width/visibility
- expanded panel width
- hiding the rail on small screens together with the task panel

**Step 4: Run test to verify it passes**

Run the Task 1 command and then a full build:

`npx esbuild src/taskPanelState.ts --platform=node --format=esm --outfile=tmp-tests/taskPanelState.mjs && node --test tests/task-panel-state.test.mjs`

`npm run build`

Expected: regression test passes and build exits 0.
