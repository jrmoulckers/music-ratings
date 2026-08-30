import type { AuthenticationResult, PublicClientApplication } from '@azure/msal-browser';

import {
  ConflictError,
  InteractionRequiredError,
  RemoteMissingError,
  type RemoteAdapter,
  type RemoteFile,
} from './sync';
import { SNAPSHOT_KIND, validateSnapshot, type Snapshot } from './snapshot';

/**
 * OneDrive, via a sandboxed app folder.
 *
 * The app can only ever see the folder Microsoft creates for it — `Files.
 * ReadWrite.AppFolder` grants no access to the rest of the drive. The file is
 * ordinary JSON, sitting in the user's own storage, readable without this app.
 *
 * MSAL is ~200KB, so this module is only ever imported dynamically, and only
 * when the user actually turns sync on.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read'];
const RETURN_KEY = 'ledger:auth-return';

let client: PublicClientApplication | null = null;
let initialised = false;

export interface OneDriveConfig {
  clientId: string;
  fileName: string;
}

export class OneDriveNotConfiguredError extends Error {
  constructor() {
    super('Add a Microsoft application ID in Settings before turning on sync.');
    this.name = 'OneDriveNotConfiguredError';
  }
}

async function msal(config: OneDriveConfig): Promise<PublicClientApplication> {
  if (!config.clientId) throw new OneDriveNotConfiguredError();
  if (client && initialised) return client;
  const { PublicClientApplication: App } = await import('@azure/msal-browser');
  client = new App({
    auth: {
      clientId: config.clientId,
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: `${location.origin}${location.pathname}`,
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await client.initialize();
  initialised = true;
  return client;
}

/**
 * Must run once on startup: a redirect back from Microsoft arrives as a plain
 * page load, and MSAL only learns about it if we ask.
 */
export async function completeRedirect(config: OneDriveConfig): Promise<string | null> {
  const app = await msal(config);
  const result = await app.handleRedirectPromise();
  if (result?.account) app.setActiveAccount(result.account);
  const back = sessionStorage.getItem(RETURN_KEY);
  if (back) sessionStorage.removeItem(RETURN_KEY);
  return result ? back : null;
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
  await app.loginRedirect({ scopes: SCOPES });
}

export async function signOut(config: OneDriveConfig): Promise<void> {
  const app = await msal(config);
  const account = app.getActiveAccount();
  await app.clearCache(account ? { account } : {});
}

/**
 * `interactive: false` is an invariant on every background path. A sync poll
 * must never hijack the page with a redirect while the user is mid-rating.
 */
async function token(config: OneDriveConfig, interactive = false): Promise<string> {
  const app = await msal(config);
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0];
  if (!account) throw new InteractionRequiredError('Connect OneDrive to sync.');
  app.setActiveAccount(account);
  try {
    const result: AuthenticationResult = await app.acquireTokenSilent({ scopes: SCOPES, account });
    return result.accessToken;
  } catch {
    if (!interactive) throw new InteractionRequiredError();
    sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
    await app.acquireTokenRedirect({ scopes: SCOPES, account });
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

export function createOneDriveAdapter(config: OneDriveConfig): RemoteAdapter {
  const file = encodeName(config.fileName || 'ledger.json');
  const contentPath = `/me/drive/special/approot:/${file}:/content`;
  const metaPath = `/me/drive/special/approot:/${file}`;

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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // No etag means "this must not exist yet" — a create, not a blind write.
      headers['If-Match'] = etag ?? '*';
      if (!etag) headers['If-None-Match'] = '*';

      const response = await graph(config, contentPath, {
        method: 'PUT',
        headers,
        body: JSON.stringify(snapshot, null, 2),
      });

      if (response.status === 412 || response.status === 409) {
        // Either someone else wrote, or the file vanished. Find out which.
        const meta = await graph(config, metaPath);
        if (meta.status === 404) {
          const retry = await graph(config, contentPath, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot, null, 2),
          });
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
    return `OneDrive refused the request. Check that the app registration allows Files.ReadWrite.AppFolder. ${detail}`.trim();
  }
  if (response.status === 507) return 'Your OneDrive is full, so the backup could not be saved.';
  return `Could not ${action} (HTTP ${response.status}). ${detail}`.trim();
}

/** For the diagnostics view: what is actually in the app folder. */
export async function listAppFolder(config: OneDriveConfig): Promise<GraphItem[]> {
  const response = await graph(
    config,
    '/me/drive/special/approot/children?$select=id,name,size,eTag,lastModifiedDateTime',
  );
  if (!response.ok) return [];
  return ((await response.json()) as { value: GraphItem[] }).value ?? [];
}
