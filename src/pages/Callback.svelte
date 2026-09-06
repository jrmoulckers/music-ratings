<script lang="ts">
  import { onMount } from 'svelte';

  import {
    clearOnboardingDraft,
    isOnboardingReturn,
    onboardingResumePath,
    patchOnboardingDraft,
    readOnboardingDraft,
  } from '../lib/app/onboarding';
  import { navigate, safeInAppPath } from '../lib/app/router';
  import { loadAll, settings, updateSettings } from '../lib/app/state';
  import { completeSignIn, describeAuthError } from '../lib/spotify/auth';
  import { refreshSpotifySession, runImport, spotifyConfig } from '../lib/spotify/session';
  import { completeRedirect } from '../lib/storage/onedrive';
  import { oneDriveConfig, restoreFromOneDrive, startSyncIfEnabled } from '../lib/app/sync';

  /**
   * The landing strip after an OAuth round trip.
   *
   * Both providers come back here. Whichever one it was, the user should end up
   * where they started with something useful having happened.
   *
   * Two things this page deliberately does not do. It does not decide that
   * setup is complete — connecting an account is one answer out of three, and
   * only the end of the flow can say the flow ended. And it does not trust the
   * destination it was handed: that value survived a trip through another
   * origin, so it is reduced to a path this app actually routes before anyone
   * is sent there.
   */

  let message = $state('Finishing the connection…');
  let failed = $state(false);
  // Whether the trip that failed was started by setup, which changes what the
  // useful way out of the failure is.
  let fromOnboarding = $state(readOnboardingDraft()?.connecting === true);
  // …and whether it was the restore door rather than the Spotify one, so the
  // way out does not offer to retry the wrong provider.
  let wasRestore = $state(readOnboardingDraft()?.restoring === true);

  onMount(() => {
    void (async () => {
      try {
        const spotify = await completeSignIn(spotifyConfig());
        if (spotify) {
          refreshSpotifySession();
          const onboarding = isOnboardingReturn(spotify.returnTo);
          fromOnboarding = onboarding;
          const fallback = onboarding ? onboardingResumePath(1) : '/settings';
          const target = safeInAppPath(spotify.returnTo, fallback);
          if (onboarding) {
            // Setup resumes where it left off, now with an account attached.
            patchOnboardingDraft({ connecting: false, spotifyConnected: true, step: 1 });
          } else {
            // A reconnect from Settings or Now Playing; nothing to resume.
            clearOnboardingDraft();
          }
          message = 'Connected. Reading your library…';
          navigate(target, { replace: true });
          // The import runs on behind whatever page they landed on; it never
          // navigates, so it cannot pull anyone out of the middle of setup.
          void runImport();
          return;
        }

        const onedrive = await completeRedirect(oneDriveConfig());
        if (onedrive) {
          await updateSettings({ syncEnabled: true });
          const draft = readOnboardingDraft();
          const restoring = draft?.restoring === true && !$settings.onboarded;

          if (restoring) {
            // A returning user, so wait for the file to actually be read before
            // deciding where they belong. Finding ratings means setup has
            // already been done once, on another device, and its answers came
            // back with them — so it is not asked again.
            message = 'Looking for your backup…';
            const restored = await restoreFromOneDrive();
            if (restored) {
              await updateSettings({ onboarded: true });
              clearOnboardingDraft();
              message = 'Your ratings are back.';
              navigate('/', { replace: true });
              return;
            }
            // Nothing there: a first device, or the wrong account. Sync is on
            // and will keep this device backed up, but setup still has to
            // happen, so it resumes rather than dropping them into an empty
            // library that looks like something went missing.
            patchOnboardingDraft({ connecting: false, restoring: false });
            message = 'No backup in that account yet. Carrying on with setup…';
            navigate(onboardingResumePath(0), { replace: true });
            return;
          }

          await startSyncIfEnabled();
          message = 'OneDrive connected.';
          navigate(safeInAppPath(onedrive.returnTo, '/settings'), { replace: true });
          return;
        }

        // Neither provider left anything to finish: a refresh, or a stale tab.
        await loadAll();
        const draft = readOnboardingDraft();
        if (!$settings.onboarded) {
          navigate(onboardingResumePath(draft?.step ?? 0), { replace: true });
          return;
        }
        clearOnboardingDraft();
        navigate('/', { replace: true });
      } catch (error) {
        failed = true;
        // The return target was already consumed by the failed exchange, so the
        // draft is the only thing left that knows setup started this.
        fromOnboarding = readOnboardingDraft()?.connecting === true || fromOnboarding;
        wasRestore = readOnboardingDraft()?.restoring === true || wasRestore;
        if (fromOnboarding) patchOnboardingDraft({ connecting: false, restoring: false });
        message = describeAuthError(error);
      }
    })();
  });

  function resumeSetup(step: number) {
    patchOnboardingDraft({ connecting: false, restoring: false });
    navigate(onboardingResumePath(step), { replace: true });
  }
</script>

<div class="landing">
  <p class="landing__text" class:is-failed={failed}>{message}</p>
  {#if failed}
    <div class="row">
      {#if fromOnboarding}
        <button
          type="button"
          class="btn btn--primary"
          onclick={() => resumeSetup(wasRestore ? 0 : 1)}
        >
          {wasRestore ? 'Set up this device instead' : 'Carry on without Spotify'}
        </button>
        <button type="button" class="btn btn--quiet" onclick={() => resumeSetup(0)}>
          {wasRestore ? 'Try OneDrive again' : 'Try Spotify again'}
        </button>
      {:else}
        <button type="button" class="btn btn--primary" onclick={() => navigate('/settings')}>
          Back to settings
        </button>
        <button type="button" class="btn btn--quiet" onclick={() => navigate('/')}>
          Carry on without it
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .landing {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s4);
    padding: var(--s5);
    text-align: center;
  }
  .landing__text {
    font-family: var(--display);
    font-size: 1.125rem;
    max-width: 44ch;
    line-height: 1.5;
  }
  .landing__text.is-failed {
    color: var(--accent-ink);
  }
</style>
