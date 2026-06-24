import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

// Both regexes below are anchored with fixed-length numeric groups —
// linear-time, no backtracking possible regardless of input.
function toCalendarDisplayDate(date: string | Date): Date {
  if (typeof date === 'string') {
    // eslint-disable-next-line security/detect-unsafe-regex
    const dateOnlyMatch = date.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/);
    if (dateOnlyMatch) {
      return parseISO(dateOnlyMatch[1]);
    }
  }

  return typeof date === 'string' ? parseISO(date) : date;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = toCalendarDisplayDate(date);
  return isValid(d) ? format(d, 'MMM d, yyyy') : '—';
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return isValid(d) ? format(d, 'MMM d, yyyy h:mm a') : '—';
}

export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return isValid(d) ? formatDistanceToNow(d, { addSuffix: true }) : '—';
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural || singular + 's'}`;
}

export function isOverdue(dueDate: string | Date | null | undefined): boolean {
  if (!dueDate) return false;
  const due = toCalendarDisplayDate(dueDate);
  if (!isValid(due)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  return dueDay < today;
}

export function toLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toDateInputValue(date: string | Date | null | undefined): string {
  if (!date) return '';

  if (typeof date === 'string') {
    // Same anchored fixed-length pattern as toCalendarDisplayDate above.
    // eslint-disable-next-line security/detect-unsafe-regex
    const dateOnlyMatch = date.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/);
    if (dateOnlyMatch) return dateOnlyMatch[1];
  }

  const d = toCalendarDisplayDate(date);
  return isValid(d) ? toLocalDateString(d) : '';
}
