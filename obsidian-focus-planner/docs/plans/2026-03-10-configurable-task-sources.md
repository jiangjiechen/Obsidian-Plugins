# Configurable Task Sources Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make task source folders/files configurable in plugin settings and show the configured sources in the empty task panel instead of hard-coded paths.

**Architecture:** Introduce a small task-source config helper to centralize defaults, normalization, and display formatting. Thread the configured task sources through plugin settings, `TaskParser`, and the task panel render path so parsing and empty-state text use the same source of truth.

**Tech Stack:** TypeScript, Obsidian plugin API, Node built-in test runner, esbuild

---

### Task 1: Add a failing test for task source config helpers

**Files:**
- Create: `tests/task-source-config.test.mjs`
- Test: `src/taskSourceConfig.ts`

**Step 1: Write the failing test**
- Assert default sources are preserved.
- Assert blank lines are trimmed out during normalization.
- Assert the source summary reflects configured sources.

**Step 2: Run test to verify it fails**
Run: `npx esbuild src/taskSourceConfig.ts --platform=node --format=esm --outfile=tmp-tests/taskSourceConfig.mjs && node --test tests/task-source-config.test.mjs`
Expected: FAIL because `src/taskSourceConfig.ts` does not exist yet.

### Task 2: Implement task source config helper

**Files:**
- Create: `src/taskSourceConfig.ts`

**Step 1: Write minimal implementation**
- Export default task sources.
- Export normalization helper for settings input.
- Export summary formatter for panel display.

**Step 2: Run targeted test to verify it passes**
Run: `npx esbuild src/taskSourceConfig.ts --platform=node --format=esm --outfile=tmp-tests/taskSourceConfig.mjs && node --test tests/task-source-config.test.mjs`
Expected: PASS

### Task 3: Wire settings, parser, and panel UI

**Files:**
- Modify: `src/types.ts`
- Modify: `src/main.ts`
- Modify: `src/taskParser.ts`
- Modify: `src/settingsTab.ts`
- Modify: `src/calendarView.ts`
- Modify: `README.md`

**Step 1: Add task source settings model and defaults**
- Add `taskSources` to settings and default it to the helper defaults.

**Step 2: Pass settings into parser and update on save**
- Construct `TaskParser` with configured sources.
- Refresh parser sources when settings are saved.

**Step 3: Add settings UI**
- Add a multiline setting where each line is one source.
- Explain folder-vs-file syntax.

**Step 4: Use configured summary in empty state**
- Return source summary from parser panel data.
- Render dynamic summary instead of hard-coded text.

### Task 4: Verify build and generated bundle

**Files:**
- Modify: `main.js`

**Step 1: Run build**
Run: `npm run build`
Expected: PASS

**Step 2: Confirm bundled output updated**
- Ensure `main.js` reflects the TypeScript source changes.
