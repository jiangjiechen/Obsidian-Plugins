export const DEFAULT_TASK_SOURCES = [
  'PeriodicNotes/',
  'Meetings/',
  'Personal/',
  'Clippings/',
];

export function normalizeTaskSources(taskSources?: string[]): string[] {
  const normalized = (taskSources ?? [])
    .map((source) => source.trim())
    .filter((source) => source.length > 0);

  return normalized.length > 0 ? normalized : [...DEFAULT_TASK_SOURCES];
}

export function formatTaskSourceSummary(taskSources?: string[]): string {
  const normalized = normalizeTaskSources(taskSources);
  return `任务来源: ${normalized.join(', ')}`;
}
