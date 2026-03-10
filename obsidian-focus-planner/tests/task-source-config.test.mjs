import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TASK_SOURCES,
  normalizeTaskSources,
  formatTaskSourceSummary,
} from '../tmp-tests/taskSourceConfig.mjs';

test('normalizeTaskSources falls back to defaults for empty input', () => {
  assert.deepEqual(normalizeTaskSources([]), DEFAULT_TASK_SOURCES);
});

test('normalizeTaskSources trims whitespace and removes blank lines', () => {
  assert.deepEqual(
    normalizeTaskSources(['  Projects/  ', '', ' Meetings/ ', '   ']),
    ['Projects/', 'Meetings/']
  );
});

test('formatTaskSourceSummary reflects configured sources', () => {
  assert.equal(
    formatTaskSourceSummary(['Projects/', 'Meetings/team.md']),
    '任务来源: Projects/, Meetings/team.md'
  );
});
