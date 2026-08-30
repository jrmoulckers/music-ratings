/** Presentation helpers. Nothing here decides anything; it only phrases it. */

const DAY = 86_400_000;

export function duration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function relative(at: number, now = Date.now()): string {
  const diff = now - at;
  if (diff < 0) return 'just now';
  const days = Math.floor(diff / DAY);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (days === 0) {
    const hours = Math.floor(diff / 3_600_000);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function fullDate(at: number): string {
  return DATE_FORMAT.format(at);
}

export function dateAndTime(at: number): string {
  return `${DATE_FORMAT.format(at)}, ${TIME_FORMAT.format(at)}`;
}

/** The year alone, when a full release date would be more precision than we have. */
export function releaseYear(value: string | undefined): string {
  if (!value) return '';
  return value.slice(0, 4);
}

export function percent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Sentence-safe join: a, b and c. */
export function list(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}
