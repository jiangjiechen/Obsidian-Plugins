# CalDAV Recurring Instance Overrides Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix CalDAV recurring-event sync so deleted instances disappear and modified instances replace the original recurring occurrence.

**Architecture:** Extract the recurrence override rules into a small pure helper module. The helper will compute occurrence keys from `UID + original occurrence start`, collect skip keys from `RECURRENCE-ID` and `EXDATE`, and let the CalDAV parser render modified exceptions while suppressing parent expansions for deleted or overridden occurrences.

**Tech Stack:** TypeScript, Obsidian plugin code, Node test runner, esbuild

---

### Task 1: Add failing regression tests for recurring overrides

**Files:**
- Create: `src/caldavRecurringOverrides.ts`
- Create: `tests/caldav-recurring-overrides.test.mjs`
- Test: `tests/caldav-recurring-overrides.test.mjs`

**Step 1: Write the failing test**

Create one test for a deleted instance:

- parent recurring event has `UID` and `RRULE`
- a cancelled exception supplies the same `UID` with `RECURRENCE-ID`
- expected behavior: the original occurrence key is skipped

Create one test for a modified instance:

- parent recurring event has `UID` and `RRULE`
- a non-cancelled exception supplies the same `UID` with `RECURRENCE-ID`
- expected behavior: the original occurrence key is skipped and the exception event is renderable

Create one test for `EXDATE`:

- parent recurring event has one or more `EXDATE` values
- expected behavior: those original occurrence keys are skipped

**Step 2: Run test to verify it fails**

Run: `npx esbuild src/caldavRecurringOverrides.ts --platform=node --format=esm --outfile=tmp-tests/caldavRecurringOverrides.mjs && node --test tests/caldav-recurring-overrides.test.mjs`

Expected: FAIL because `src/caldavRecurringOverrides.ts` does not exist yet.

**Step 3: Write minimal implementation**

Implement the helper functions needed by the tests:

- occurrence key generation
- skip-key collection from `RECURRENCE-ID`
- skip-key collection from `EXDATE`

**Step 4: Run test to verify it passes**

Run: `npx esbuild src/caldavRecurringOverrides.ts --platform=node --format=esm --outfile=tmp-tests/caldavRecurringOverrides.mjs && node --test tests/caldav-recurring-overrides.test.mjs`

Expected: PASS

### Task 2: Wire the helper into the CalDAV parser

**Files:**
- Modify: `src/caldavClient.ts`

**Step 1: Write the failing test**

Use the helper regression tests as the formal failing behavior definition for override-key logic.

**Step 2: Run test to verify it fails**

Re-run the Task 1 command before the helper exists.

**Step 3: Write minimal implementation**

Update `parseICalendar()` to:

- collect `EXDATE` values from VEVENT blocks
- add occurrence skip keys for cancelled and modified exceptions
- render modified exceptions only when not cancelled
- suppress parent recurring expansions using `UID + original occurrence start`

**Step 4: Run test to verify it passes**

Run the Task 1 command again.

Expected: PASS

### Task 3: Verify the integrated parser and build

**Files:**
- Modify: `src/caldavClient.ts`
- Test: `tests/caldav-recurring-overrides.test.mjs`

**Step 1: Write the failing test**

No new test file is required beyond the regression coverage from Task 1.

**Step 2: Run test to verify it fails**

Not applicable beyond the Task 1 red-green cycle.

**Step 3: Write minimal implementation**

Keep the parser changes scoped to CalDAV recurrence handling only.

**Step 4: Run test to verify it passes**

Run:

`npx esbuild src/caldavRecurringOverrides.ts --platform=node --format=esm --outfile=tmp-tests/caldavRecurringOverrides.mjs && node --test tests/caldav-recurring-overrides.test.mjs`

`npm run build`

Expected: regression tests pass and build exits 0.
