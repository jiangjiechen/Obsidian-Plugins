export interface CalDavRecurringOverrideSource {
  uid: string | null;
  recurrenceId: string | null;
  status: string | null;
  exdates: string[];
}

const MISSING_UID_KEY = '__missing_uid__';

export function createOccurrenceKey(uid: string | null, occurrenceStart: Date): string {
  return `${uid || MISSING_UID_KEY}|${occurrenceStart.toISOString()}`;
}

export function shouldRenderRecurringException(
  source: Pick<CalDavRecurringOverrideSource, 'recurrenceId' | 'status'>
): boolean {
  return Boolean(source.recurrenceId) && source.status?.toUpperCase() !== 'CANCELLED';
}

export function collectRecurringOverrideKeys(
  sources: CalDavRecurringOverrideSource[],
  parseDateTime: (value: string) => Date
): string[] {
  const keys = new Set<string>();

  for (const source of sources) {
    if (source.recurrenceId) {
      keys.add(createOccurrenceKey(source.uid, parseDateTime(source.recurrenceId)));
    }

    for (const exdate of source.exdates) {
      for (const value of exdate.split(',')) {
        const trimmedValue = value.trim();
        if (!trimmedValue) continue;
        keys.add(createOccurrenceKey(source.uid, parseDateTime(trimmedValue)));
      }
    }
  }

  return Array.from(keys);
}
