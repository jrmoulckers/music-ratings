/**
 * Hands a file to the browser and lives long enough for it to arrive.
 *
 * The obvious version of this — create an object URL, click a link, revoke the
 * URL — loses the file. Revoking is synchronous, the download is not, and a
 * browser part-way through reading a seven megabyte blob simply stops when the
 * URL it is reading disappears. Small files usually survive the race, which is
 * the worst possible failure: it works on the test data and silently produces
 * nothing on the backup that mattered.
 *
 * So the URL is kept alive well past the handover. A blob URL that outlives its
 * usefulness costs some memory until the page closes; a backup that never
 * reached the disk costs someone every rating they ever made.
 */

/** Long enough for any plausible write to disk, short enough to be tidy. */
const REVOKE_AFTER_MS = 60_000;

export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  // Some browsers ignore a click on an element that is not in the document.
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export function downloadJson(value: unknown, filename: string): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  downloadFile(new Blob([text], { type: 'application/json' }), filename);
}
