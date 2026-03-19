import test from 'node:test';
import assert from 'node:assert/strict';
import { getTaskPanelDisplayState } from '../tmp-tests/taskPanelState.mjs';

test('getTaskPanelDisplayState returns collapsed metadata by default', () => {
  assert.deepEqual(getTaskPanelDisplayState(false), {
    isExpanded: false,
    isCollapsed: true,
    shouldShowContent: false,
    toggleIcon: '‹',
    toggleLabel: '展开任务',
    toggleTitle: '展开待办任务面板',
    ariaExpanded: 'false',
  });
});

test('getTaskPanelDisplayState returns expanded metadata when panel is open', () => {
  assert.deepEqual(getTaskPanelDisplayState(true), {
    isExpanded: true,
    isCollapsed: false,
    shouldShowContent: true,
    toggleIcon: '›',
    toggleLabel: '收起任务',
    toggleTitle: '收起待办任务面板',
    ariaExpanded: 'true',
  });
});
