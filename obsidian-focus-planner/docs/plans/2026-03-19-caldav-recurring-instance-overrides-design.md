# CalDAV Recurring Instance Overrides Design

**Date:** 2026-03-19

**Goal:** Fix Focus Planner's CalDAV sync so deleted recurring instances do not reappear, while modified recurring instances still replace the original parent occurrence.

## Context

The current CalDAV parser expands parent `RRULE` events and tries to suppress overridden instances using a `title + date` key. That covers some modified-instance cases, but it does not correctly handle deleted occurrences. If Feishu emits a cancelled exception (`RECURRENCE-ID` with `STATUS:CANCELLED`) or `EXDATE`, the code currently skips the exception record entirely and still expands the parent occurrence for that day.

## Root Cause

There are two gaps in the current parser:

- Cancelled recurrence exceptions are ignored instead of being treated as "do not render the parent instance".
- Parent recurring events do not parse `EXDATE`, so explicit exclusions are not respected.

There is also a robustness issue:

- The current override key uses `title + date`, which can break when an exception changes the title or when multiple recurring events share a title on the same day.

## Decision

Move the CalDAV override logic to an occurrence-based model keyed by:

- `UID`
- original occurrence start time

This design applies these rules:

- `RECURRENCE-ID` always blocks the original parent occurrence for that exact original start time.
- `RECURRENCE-ID + STATUS:CANCELLED` blocks the parent occurrence and does not render an exception event.
- `RECURRENCE-ID` without cancellation blocks the parent occurrence and renders the modified exception event.
- `EXDATE` blocks the parent occurrence even when there is no separate exception VEVENT.

## Scope

- Only the CalDAV path is changed.
- Open API behavior stays as-is for this fix.
- The change remains local to recurrence parsing and does not alter view rendering or calendar categorization.

## Implementation Shape

- Add a small helper module for CalDAV recurrence override logic so it can be regression-tested without instantiating the full client.
- Parse all `EXDATE` values, including comma-separated values and repeated `EXDATE` lines.
- Build a skip set of `UID + original occurrence start`.
- Filter parent `RRULE` expansions against that skip set.

## Verification

- A recurring event with a deleted Friday instance should not render that Friday.
- A recurring event with a modified Friday instance should render only the modified Friday event.
- Other unmodified recurring instances should still render normally.
