import { writable, type Readable } from 'svelte/store';

/**
 * A small history router.
 *
 * Routes are matched in order against the pathname beneath the deployment base,
 * so the whole app can be served from a subdirectory on static hosting without
 * any of the screens knowing about it.
 */

export type RouteName =
  | 'home'
  | 'rate'
  | 'compare'
  | 'library'
  | 'entity'
  | 'rankings'
  | 'history'
  | 'insights'
  | 'settings'
  | 'diagnostics'
  | 'onboarding'
  | 'callback'
  | 'notfound';

export interface Route {
  name: RouteName;
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
}

const PATTERNS: { name: RouteName; pattern: RegExp; keys: string[] }[] = [
  { name: 'home', pattern: /^\/$/, keys: [] },
  { name: 'rate', pattern: /^\/rate\/?$/, keys: [] },
  { name: 'compare', pattern: /^\/compare\/?$/, keys: [] },
  { name: 'library', pattern: /^\/library\/?$/, keys: [] },
  {
    name: 'entity',
    pattern: /^\/e\/([^/]+)\/([^/]+)\/([^/]+)\/?$/,
    keys: ['type', 'provider', 'id'],
  },
  { name: 'rankings', pattern: /^\/rankings\/?$/, keys: [] },
  { name: 'history', pattern: /^\/history\/?$/, keys: [] },
  { name: 'insights', pattern: /^\/insights\/?$/, keys: [] },
  { name: 'settings', pattern: /^\/settings\/?$/, keys: [] },
  { name: 'diagnostics', pattern: /^\/diagnostics\/?$/, keys: [] },
  { name: 'onboarding', pattern: /^\/start\/?$/, keys: [] },
  { name: 'callback', pattern: /^\/callback\/?$/, keys: [] },
];

export const BASE = normaliseBase(import.meta.env?.BASE_URL ?? '/');

function normaliseBase(value: string): string {
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  return trimmed === '/' ? '' : trimmed;
}

/** Turns an in-app path into a real href, honouring the deployment base. */
export function href(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${clean}` || '/';
}

export function entityHref(id: string): string {
  const [type, provider, ...rest] = id.split(':');
  return href(
    `/e/${encodeURIComponent(type ?? '')}/${encodeURIComponent(provider ?? '')}/${encodeURIComponent(
      rest.join(':'),
    )}`,
  );
}

function parse(url: URL): Route {
  let path = url.pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
  if (!path.startsWith('/')) path = `/${path}`;

  for (const route of PATTERNS) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] ?? '');
    });
    return { name: route.name, params, query: url.searchParams, path };
  }
  return { name: 'notfound', params: {}, query: url.searchParams, path };
}

function current(): Route {
  if (typeof location === 'undefined') {
    return { name: 'home', params: {}, query: new URLSearchParams(), path: '/' };
  }
  return parse(new URL(location.href));
}

const store = writable<Route>(current());

export const route: Readable<Route> = { subscribe: store.subscribe };

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const target = href(path);
  if (options.replace) history.replaceState({}, '', target);
  else history.pushState({}, '', target);
  store.set(current());
  // A pushed navigation should land at the top; a replace usually should not.
  if (!options.replace) window.scrollTo({ top: 0 });
}

export function startRouter(): () => void {
  const onPop = () => store.set(current());
  window.addEventListener('popstate', onPop);

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest?.('a');
    if (!anchor) return;
    const url = anchor.getAttribute('href');
    if (!url || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    if (anchor.hasAttribute('data-external') || /^([a-z]+:)?\/\//i.test(url)) return;
    if (url.startsWith('#') || url.startsWith('mailto:')) return;
    event.preventDefault();
    const stripped = BASE && url.startsWith(BASE) ? url.slice(BASE.length) : url;
    navigate(stripped || '/');
  };
  document.addEventListener('click', onClick);

  return () => {
    window.removeEventListener('popstate', onPop);
    document.removeEventListener('click', onClick);
  };
}

export function isActive(route_: Route, path: string): boolean {
  if (path === '/') return route_.path === '/';
  return route_.path === path || route_.path.startsWith(`${path}/`);
}
