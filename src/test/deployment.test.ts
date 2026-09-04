import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { manifestForBase, navigationFallbackForBase } from '../../vite.config';

describe('custom-domain Pages deployment', () => {
  it('persists the domain in every uploaded artifact and builds for the origin root', () => {
    expect(readFileSync(join(process.cwd(), 'public', 'CNAME'), 'utf8').trim()).toBe(
      'rank.jrmoulckers.com',
    );

    const workflow = readFileSync(
      join(process.cwd(), '.github', 'workflows', 'deploy.yml'),
      'utf8',
    );
    expect(workflow).toMatch(/VITE_BASE_PATH:\s*\/\s*$/m);
    expect(workflow).toContain('path: dist');
    expect(workflow).not.toContain('github.event.repository.name');
  });

  it('uses root URLs for the install identity, launch scope, shortcuts, and SPA fallback', () => {
    const manifest = manifestForBase('/');

    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.shortcuts).toEqual([
      { name: 'Rate', url: '/rate' },
      { name: 'Compare', url: '/compare' },
    ]);
    expect(navigationFallbackForBase('/')).toBe('/index.html');
  });
});
