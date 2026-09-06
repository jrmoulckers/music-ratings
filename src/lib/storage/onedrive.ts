import type { AuthenticationResult, PublicClientApplication } from '@azure/msal-browser';

import { appUrl } from '../app/router';
import { normalizeFolderPath, type OneDriveFolderMode } from './settings';
import {
  ConflictError,
  InteractionRequiredError,
  RemoteMissingError,
  type RemoteAdapter,
  type RemoteFile,
} from './sync';
import { SNAPSHOT_KIND, validateSnapshot, type Snapshot } from './snapshot';

/**
 * OneDrive, via the user's own account.
 *
 * Two places the backup can live, and the choice decides the permission asked
 * for at sign-in:
 *
 * - `app` (the default) is a folder Microsoft creates and sandboxes for this
 *   app. `Files.ReadWrite.AppFolder` grants no sight of the rest of the drive,
 *   so the app genuinely cannot read your documents even by mistake.
 * - `custom` is any folder you name. Graph has no way to scope a delegated
 *   grant to a single folder, so this necessarily asks for `Files.ReadWrite`
 *   over the drive. It is offered because a backup you can find and open
 *   alongside your own files is worth something, but it is never the default and
 *   the consent screen says plainly what it covers.
 *
 * Either way the file is ordinary JSON, sitting in the user's own storage,
 * readable without this app.
 *
 * MSAL is ~200KB, so this module is only ever imported dynamically, and only
 * when the user actually turns sync on.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const APP_FOLDER_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read'];
const CUSTOM_FOLDER_SCOPES = ['Files.ReadWrite', 'User.Read'];
const RETURN_KEY = 'music-ratings:auth-return';

let client: PublicClientApplication | null = null;
/** The client ID the cached instance was built for; MSAL cannot be re-pointed. */
let initialisedFor = '';

export interface OneDriveConfig {
  clientId: string;
  fileName: string;
  /** Sandboxed app folder, or a folder the user named. Defaults to the sandbox. */
  folderMode?: OneDriveFolderMode;
  /** Slash-separated path from the drive root. Only read in `custom` mode. */
  customPath?: string;
}

function isCustom(config: OneDriveConfig): boolean {
  return config.folderMode === 'custom';
}

/**
 * Permissions are requested at sign-in, not baked into the registration, so
 * switching to a custom folder simply asks for more the next time it needs a
 * token. Nothing has to change in Azure.
 */
export function scopesFor(config: OneDriveConfig): string[] {
  return isCustom(config) ? [...CUSTOM_FOLDER_SCOPES] : [...APP_FOLDER_SCOPES];
}

export class OneDriveNotConfiguredError extends Error {
  constructor() {
    super('Add a Microsoft application ID in Settings before turning on sync.');
    this.name = 'OneDriveNotConfiguredError';
  }
}

async function msal(config: OneDriveConfig): Promise<PublicClientApplication> {
  if (!config.clientId) throw new OneDriveNotConfiguredError();
  if (client && initialisedFor === config.clientId) return client;
  const { PublicClientApplication: App } = await import('@azure/msal-browser');
  client = new App({
    auth: {
      clientId: config.clientId,
      authority: 'https://login.microsoftonline.com/common',
      // One fixed address, whatever page you started from. Microsoft matches
      // this against a list registered by hand, so deriving it from the current
      // pathname meant every route needed registering — and the one route that
      // finishes the exchange is `/callback`, which is where both providers
      // already come back to.
      redirectUri: appUrl('/callback'),
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await client.initialize();
  initialisedFor = config.clientId;
  return client;
}

/** What a completed round trip left behind: the account, and where to go back to. */
export interface OneDriveReturn {
  account: string | null;
  returnTo: string | null;
}

/**
 * Must run once on the page Microsoft returns to: a redirect back arrives as a
 * plain page load, and MSAL only learns about it if we ask.
 *
 * Returns null when there was nothing to finish. Success is decided by the
 * exchange itself and never by whether the return path survived, so a cleared
 * session cannot turn a connected account into a silent no-op.
 */
export async function completeRedirect(config: OneDriveConfig): Promise<OneDriveReturn | null> {
  const app = await msal(config);
  // Finish here. MSAL would otherwise navigate back to the page sign-in started
  // on before resolving, and that page has no reason to know an account round
  // trip is in flight — so nobody would ever complete it.
  const result = await app.handleRedirectPromise({ navigateToLoginRequestUrl: false });
  const back = sessionStorage.getItem(RETURN_KEY);
  if (back !== null) sessionStorage.removeItem(RETURN_KEY);
  if (!result) return null;
  if (result.account) app.setActiveAccount(result.account);
  return { account: result.account?.username ?? null, returnTo: back };
}

export async function signedInAccount(config: OneDriveConfig): Promise<string | null> {
  const app = await msal(config);
  const active = app.getActiveAccount() ?? app.getAllAccounts()[0];
  if (!active) return null;
  app.setActiveAccount(active);
  return active.username ?? null;
}

export async function signIn(config: OneDriveConfig, returnTo: string): Promise<void> {
  const app = await msal(config);
  sessionStorage.setItem(RETURN_KEY, returnTo);
  // Redirect, not popup: popups are blocked on iOS standalone PWAs.
  await app.loginRedirect({ scopes: scopesFor(config) });
}

export async function signOut(config: OneDriveConfig): Promise<void> {
  const app = await msal(config);
  const account = app.getActiveAccount();
  await app.clearCache(account ? { account } : {});
}

/**
 * `interactive: false` is an invariant on every background path. A sync poll
 * must never hijack the page with a redirect while the user is mid-rating.
 *
 * Switching to a custom folder widens the scopes, so the first silent attempt
 * after that change fails and surfaces as `InteractionRequiredError` — which is
 * exactly right: a broader permission has to be granted by the user, in front of
 * Microsoft's consent screen, not inherited quietly from an older sign-in.
 */
async function token(config: OneDriveConfig, interactive = false): Promise<string> {
  const app = await msal(config);
  const scopes = scopesFor(config);
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0];
  if (!account) throw new InteractionRequiredError('Connect OneDrive to sync.');
  app.setActiveAccount(account);
  try {
    const result: AuthenticationResult = await app.acquireTokenSilent({ scopes, account });
    return result.accessToken;
  } catch {
    if (!interactive) throw new InteractionRequiredError();
    sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
    await app.acquireTokenRedirect({ scopes, account });
    throw new InteractionRequiredError();
  }
}

/* -------------------------------------------------------------------------- */

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  lastModifiedDateTime?: string;
}

async function graph(
  config: OneDriveConfig,
  path: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<Response> {
  const accessToken = await token(config);
  const response = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  // Microsoft asks us to back off explicitly; honour it rather than hammering.
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 800;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return graph(config, path, init, attempt + 1);
  }
  if (response.status === 401) throw new InteractionRequiredError();
  return response;
}

function encodeName(name: string): string {
  return encodeURIComponent(name.replace(/[\\/:*?"<>|]/g, '-'));
}

/** Each folder segment percent-encoded, joined back with the slashes Graph wants. */
function encodePath(path: string): string {
  return normalizeFolderPath(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/**
 * Where the backup lives, as the three Graph addresses that need saying.
 *
 * App-folder mode leans on `special/approot`, which Microsoft provisions on
 * first write. Custom mode addresses the drive root by path, and an empty path
 * means the root itself — a legitimate, if untidy, choice.
 */
export interface OneDrivePaths {
  content: string;
  meta: string;
  children: string;
}

export function oneDrivePaths(config: OneDriveConfig): OneDrivePaths {
  const file = encodeName(config.fileName || 'music-ratings.json');
  if (!isCustom(config)) {
    return {
      content: `/me/drive/special/approot:/${file}:/content`,
      meta: `/me/drive/special/approot:/${file}`,
      children: '/me/drive/special/approot/children',
    };
  }
  const folder = encodePath(config.customPath ?? '');
  const meta = folder ? `/me/drive/root:/${folder}/${file}` : `/me/drive/root:/${file}`;
  return {
    content: `${meta}:/content`,
    meta,
    children: folder ? `/me/drive/root:/${folder}:/children` : '/me/drive/root/children',
  };
}

/**
 * Create the custom folder if it is missing, so a backup survives the user
 * tidying up their OneDrive and deleting it.
 *
 * Each segment is created with `conflictBehavior: fail`, so a folder that
 * already exists is left exactly as it is — a 409 here means "already there",
 * which is success. App-folder mode never needs this: writing to approot
 * re-provisions the sandbox on its own.
 */
async function ensureCustomFolder(config: OneDriveConfig): Promise<void> {
  let parent = '';
  for (const name of normalizeFolderPath(config.customPath ?? '')
    .split('/')
    .filter(Boolean)) {
    const children = parent
      ? `/me/drive/root:/${encodePath(parent)}:/children`
      : '/me/drive/root/children';
    const response = await graph(config, children, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(`Could not create the OneDrive folder "${name}" (HTTP ${response.status}).`);
    }
    parent = parent ? `${parent}/${name}` : name;
  }
}

export function createOneDriveAdapter(config: OneDriveConfig): RemoteAdapter {
  const { content: contentPath, meta: metaPath } = oneDrivePaths(config);
  const custom = isCustom(config);

  return {
    async read(): Promise<RemoteFile | null> {
      const response = await graph(config, contentPath);
      if (response.status === 404) throw new RemoteMissingError();
      if (!response.ok) throw new Error(await describe(response, 'read the backup'));
      const etag = response.headers.get('ETag');
      const text = await response.text();
      if (!text.trim()) throw new RemoteMissingError();
      let snapshot: Snapshot;
      try {
        snapshot = validateSnapshot(JSON.parse(text));
      } catch {
        throw new ConflictError(
          `The file in OneDrive is not a ${SNAPSHOT_KIND} backup. Rename it or choose a different file name in Settings.`,
        );
      }
      return { snapshot, etag: etag ?? (await peekEtag(config, metaPath)) };
    },

    async write(snapshot: Snapshot, etag: string | null): Promise<string | null> {
      const body = JSON.stringify(snapshot, null, 2);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // No etag means "this must not exist yet" — a create, not a blind write.
      headers['If-Match'] = etag ?? '*';
      if (!etag) headers['If-None-Match'] = '*';

      const put = (extra: Record<string, string> = {}) =>
        graph(config, contentPath, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...extra },
          body,
        });

      let response = await put(headers);

      // A chosen folder can be deleted from under us. Rebuild it and try again,
      // rather than reporting a conflict the user cannot act on.
      if (response.status === 404 && custom) {
        await ensureCustomFolder(config);
        response = await put();
      }

      if (response.status === 412 || response.status === 409) {
        // Either someone else wrote, or the file vanished. Find out which.
        const meta = await graph(config, metaPath);
        if (meta.status === 404) {
          if (custom) await ensureCustomFolder(config);
          const retry = await put();
          if (!retry.ok) throw new Error(await describe(retry, 'save the backup'));
          return ((await retry.json()) as GraphItem).eTag ?? null;
        }
        throw new ConflictError('The backup changed in OneDrive while this device was saving.');
      }
      if (!response.ok) throw new Error(await describe(response, 'save the backup'));
      return ((await response.json()) as GraphItem).eTag ?? null;
    },

    async peek(): Promise<string | null> {
      return peekEtag(config, metaPath);
    },
  };
}

async function peekEtag(config: OneDriveConfig, metaPath: string): Promise<string | null> {
  const response = await graph(config, `${metaPath}?$select=eTag`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await describe(response, 'check the backup'));
  return ((await response.json()) as GraphItem).eTag ?? null;
}

async function describe(response: Response, action: string): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    detail = '';
  }
  if (response.status === 403) {
    return `OneDrive refused the request. Check that you granted the permission it asked for when signing in. ${detail}`.trim();
  }
  if (response.status === 507) return 'Your OneDrive is full, so the backup could not be saved.';
  return `Could not ${action} (HTTP ${response.status}). ${detail}`.trim();
}

/** For the diagnostics view: what is actually in the folder being synced to. */
export async function listAppFolder(config: OneDriveConfig): Promise<GraphItem[]> {
  const { children } = oneDrivePaths(config);
  const response = await graph(
    config,
    `${children}?$select=id,name,size,eTag,lastModifiedDateTime`,
  );
  if (!response.ok) return [];
  return ((await response.json()) as { value: GraphItem[] }).value ?? [];
}
