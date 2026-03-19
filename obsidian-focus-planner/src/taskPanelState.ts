export interface TaskPanelDisplayState {
  isExpanded: boolean;
  isCollapsed: boolean;
  shouldShowContent: boolean;
  toggleIcon: string;
  toggleLabel: string;
  toggleTitle: string;
  ariaExpanded: 'true' | 'false';
}

export function getTaskPanelDisplayState(isExpanded: boolean): TaskPanelDisplayState {
  if (isExpanded) {
    return {
      isExpanded: true,
      isCollapsed: false,
      shouldShowContent: true,
      toggleIcon: '›',
      toggleLabel: '收起任务',
      toggleTitle: '收起待办任务面板',
      ariaExpanded: 'true',
    };
  }

  return {
    isExpanded: false,
    isCollapsed: true,
    shouldShowContent: false,
    toggleIcon: '‹',
    toggleLabel: '展开任务',
    toggleTitle: '展开待办任务面板',
    ariaExpanded: 'false',
  };
}
