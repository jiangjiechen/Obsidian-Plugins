import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectRecurringOverrideKeys,
  createOccurrenceKey,
  shouldRenderRecurringException,
} from '../tmp-tests/caldavRecurringOverrides.mjs';

const parseDateTime = (value) => new Date(value);

test('collectRecurringOverrideKeys blocks cancelled recurrence exceptions', () => {
  const keys = collectRecurringOverrideKeys([
    {
      uid: 'series-1',
      recurrenceId: '2026-03-20T09:00:00.000Z',
      status: 'CANCELLED',
      exdates: [],
    },
  ], parseDateTime);

  assert.deepEqual(keys, [
    createOccurrenceKey('series-1', new Date('2026-03-20T09:00:00.000Z')),
  ]);
  assert.equal(shouldRenderRecurringException({ recurrenceId: '2026-03-20T09:00:00.000Z', status: 'CANCELLED' }), false);
});

test('collectRecurringOverrideKeys blocks original occurrence for modified exceptions', () => {
  const keys = collectRecurringOverrideKeys([
    {
      uid: 'series-2',
      recurrenceId: '2026-03-20T09:00:00.000Z',
      status: null,
      exdates: [],
    },
  ], parseDateTime);

  assert.deepEqual(keys, [
    createOccurrenceKey('series-2', new Date('2026-03-20T09:00:00.000Z')),
  ]);
  assert.equal(shouldRenderRecurringException({ recurrenceId: '2026-03-20T09:00:00.000Z', status: null }), true);
});

test('collectRecurringOverrideKeys includes EXDATE exclusions', () => {
  const keys = collectRecurringOverrideKeys([
    {
      uid: 'series-3',
      recurrenceId: null,
      status: null,
      exdates: ['2026-03-20T09:00:00.000Z,2026-03-27T09:00:00.000Z', '2026-04-03T09:00:00.000Z'],
    },
  ], parseDateTime);

  assert.deepEqual(keys, [
    createOccurrenceKey('series-3', new Date('2026-03-20T09:00:00.000Z')),
    createOccurrenceKey('series-3', new Date('2026-03-27T09:00:00.000Z')),
    createOccurrenceKey('series-3', new Date('2026-04-03T09:00:00.000Z')),
  ]);
});
