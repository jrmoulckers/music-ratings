import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadFile, downloadJson } from './download';

/**
 * The bug these exist for: a backup that reports success and delivers nothing.
 *
 * Revoking an object URL in the same tick as the click cancels the transfer
 * once the file is large enough to take any time at all — so it passes on a
 * handful of test rows and fails on the seven megabytes someone actually cared
 * about. Size is exactly what a test cannot feel, so these pin the mechanism
 * instead: the link is in the document when it is clicked, and the URL outlives
 * the click.
 */

let created: string[] = [];
let revoked: string[] = [];
let clicked: { inDocument: boolean; download: string; href: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
  revoked = [];
  clicked = [];

  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:test/${++n}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({
      inDocument: document.body.contains(this),
      download: this.download,
      href: this.href,
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handing a file to the browser', () => {
  it('does not revoke the url while the browser is still reading it', () => {
    downloadFile(new Blob(['x']), 'backup.json');

    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
  });

  it('releases the url once the transfer cannot still be in flight', () => {
    downloadFile(new Blob(['x']), 'backup.json');
    vi.advanceTimersByTime(60_000);

    expect(revoked).toEqual(created);
  });

  it('clicks a link that is actually in the document', () => {
    downloadFile(new Blob(['x']), 'backup.json');

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.inDocument).toBe(true);
    expect(clicked[0]?.download).toBe('backup.json');
  });

  it('leaves nothing behind in the page', () => {
    downloadFile(new Blob(['x']), 'backup.json');

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('names the file it was asked to name', () => {
    downloadJson({ a: 1 }, 'music-ratings-2026-09-03.json');

    expect(clicked[0]?.download).toBe('music-ratings-2026-09-03.json');
  });

  it('passes pre-serialised text through rather than quoting it again', async () => {
    const blobs: Blob[] = [];
    vi.mocked(URL.createObjectURL).mockImplementation((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return 'blob:test/1';
    });

    downloadJson('{"already":"json"}', 'a.json');
    expect(await blobs[0]?.text()).toBe('{"already":"json"}');

    downloadJson({ already: 'object' }, 'b.json');
    expect(await blobs[1]?.text()).toBe('{\n  "already": "object"\n}');
  });

  it('keeps separate downloads from sharing one url', () => {
    downloadFile(new Blob(['one']), 'one.json');
    downloadFile(new Blob(['two']), 'two.json');

    expect(new Set(created).size).toBe(2);
    expect(clicked.map((c) => c.download)).toEqual(['one.json', 'two.json']);
  });
});
