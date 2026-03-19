# Collapsible Task Panel Design

**Date:** 2026-03-19

**Goal:** Prevent the task panel from permanently squeezing the weekly calendar by making the task area collapsed by default and expandable on demand.

## Context

The current Focus Planner view renders the calendar and task panel side by side. The task panel has a fixed width, which reduces usable space for the calendar even when tasks are not actively being reviewed.

## Decision

Implement a view-local collapsible task panel with these constraints:

- Default state is collapsed.
- The expand/collapse affordance remains visible even when the panel is collapsed.
- The task panel remains on the right side when expanded.
- The panel state is not stored in plugin settings for this first iteration.
- Task data loads lazily on first expand to avoid unnecessary work when the panel remains collapsed.

## UI Behavior

- Desktop layout shows `calendar + narrow toggle rail` by default.
- Clicking the rail expands the task panel.
- Clicking again collapses the task panel and returns width to the calendar.
- Existing refresh button, grouped task sections, and drag/drop behavior remain unchanged while expanded.
- Small-screen behavior continues to hide the task panel affordance under the existing responsive rule.

## Non-Goals

- Persisting the expand/collapse preference across sessions.
- Redesigning task grouping, filtering, or drag/drop behavior.
- Reworking the current responsive breakpoint behavior.

## Risks And Mitigations

- If the toggle is placed inside the panel, it disappears when collapsed.
  Mitigation: render a separate rail element between calendar and task panel.
- If collapse state is stored in plugin settings, every toggle goes through the full settings refresh path.
  Mitigation: keep the state inside the view instance.
- If tasks always load on open, default collapse does not improve startup cost.
  Mitigation: fetch tasks on first expand.

## Verification

- Open Focus Planner and confirm the task panel starts collapsed.
- Expand the panel and confirm tasks load and render.
- Collapse the panel and confirm the calendar regains space.
- Re-expand and confirm existing task interactions still work.
