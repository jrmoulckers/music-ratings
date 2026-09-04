<script lang="ts">
  import { notify } from '../lib/app/notices';
  import {
    clampStep,
    clearOnboardingDraft,
    onboardingResumePath,
    patchOnboardingDraft,
    readOnboardingDraft,
    saveOnboardingDraft,
  } from '../lib/app/onboarding';
  import { navigate, route } from '../lib/app/router';
  import { allScales, entityLabel, settings, updateSettings } from '../lib/app/state';
  import { describeScale } from '../lib/domain/scales';
  import { ENTITY_TYPES } from '../lib/domain/types';
  import type { EntityType } from '../lib/domain/types';
  import { ENTITY_SUPPORT } from '../lib/spotify/capabilities';
  import { connectSpotify, spotifySession } from '../lib/spotify/session';
  import { connectOneDrive } from '../lib/app/sync';
  import { HAS_BUILT_IN_ONEDRIVE, HAS_BUILT_IN_SPOTIFY } from '../lib/config';
  import Icon from '../lib/ui/Icon.svelte';

  /**
   * The front door.
   *
   * Three decisions, in the order they actually matter: where the catalogue
   * comes from, what you are willing to rate, and on what scale. Everything
   * else has a defensible default and lives in Settings.
   *
   * Connecting Spotify leaves the app entirely and comes back, so the answers
   * so far live in a draft rather than in component state, and the page you are
   * on lives in the address bar rather than in a variable. Between them, Back
   * and Refresh behave the way they look like they should — and setup is only
   * finished when someone finishes it.
   */

  const resumed = readOnboardingDraft();

  let chosenTypes = $state<EntityType[]>(
    resumed && resumed.types.length > 0 ? resumed.types : [...$settings.enabledTypes],
  );
  let scaleId = $state(resumed?.scaleId || $settings.defaultScaleId);
  let clientId = $state(resumed?.clientId || $settings.spotifyClientId);
  let working = $state(false);

  // Spotify has just come back if the draft says this run of setup connected it.
  let justConnected = $state(resumed?.spotifyConnected === true && $spotifySession.connected);

  // The page lives in the address bar, so Back and Refresh are the browser's
  // job rather than something this component has to reimplement.
  const step = $derived(clampStep($route.query.get('step') ?? resumed?.step ?? 0));

  const steps = ['Source', 'What you rate', 'Rating scale'];

  // Every answer is written down as it is given, because the next thing the
  // user does might be to leave for Spotify. Once setup has actually finished
  // the draft is gone for good, and this must not resurrect it.
  let finished = $state(false);
  $effect(() => {
    if (finished || $route.name !== 'onboarding') return;
    saveOnboardingDraft({
      step,
      types: chosenTypes,
      scaleId,
      clientId,
      connecting: false,
      spotifyConnected: justConnected,
      restoring: false,
    });
  });

  function goTo(next: number) {
    navigate(onboardingResumePath(next));
  }

  function toggleType(type: EntityType) {
    chosenTypes = chosenTypes.includes(type)
      ? chosenTypes.filter((t) => t !== type)
      : [...chosenTypes, type];
  }

  async function chooseSpotify() {
    const own = clientId.trim();
    if (!own && !HAS_BUILT_IN_SPOTIFY) {
      notify('Spotify needs a client ID from your developer dashboard first.', { tone: 'warn' });
      return;
    }
    working = true;
    try {
      // An empty client ID is not a missing answer — it means "ask as this
      // build", which is the path almost everyone takes. Either way the value
      // is saved before leaving, because the callback needs it to exchange the
      // code. What you rate and on what scale are still questions, so they go in
      // the draft — and `onboarded` stays false, because connecting an account
      // is not finishing setup.
      await updateSettings({ spotifyClientId: own });
      patchOnboardingDraft({
        step: 1,
        types: chosenTypes,
        scaleId,
        clientId: own,
        connecting: true,
        spotifyConnected: false,
        restoring: false,
      });
      await connectSpotify(onboardingResumePath(1));
    } catch (error) {
      working = false;
      patchOnboardingDraft({ connecting: false });
      notify(error instanceof Error ? error.message : 'Could not start the Spotify sign-in.', {
        tone: 'warn',
      });
    }
  }

  /**
   * The returning-user door: sign in to OneDrive and take the backup back.
   *
   * Setup is skipped entirely if a backup turns up, because someone who already
   * has ratings has already answered these questions — the answers travel in the
   * backup. That decision is made in the callback, once the file has actually
   * been read; all this does is leave a note saying which door was used.
   */
  async function chooseRestore() {
    working = true;
    try {
      patchOnboardingDraft({
        step: 0,
        types: chosenTypes,
        scaleId,
        clientId,
        connecting: true,
        spotifyConnected: justConnected,
        restoring: true,
      });
      await connectOneDrive(onboardingResumePath(0));
    } catch (error) {
      working = false;
      patchOnboardingDraft({ connecting: false, restoring: false });
      notify(error instanceof Error ? error.message : 'Could not start the OneDrive sign-in.', {
        tone: 'warn',
      });
    }
  }

  async function finish() {
    working = true;
    try {
      // The one place `onboarded` becomes true.
      await updateSettings({
        enabledTypes: chosenTypes.length > 0 ? chosenTypes : ['artist', 'album', 'track'],
        defaultScaleId: scaleId,
        onboarded: true,
      });
      finished = true;
      clearOnboardingDraft();
      navigate('/', { replace: true });
    } finally {
      working = false;
    }
  }
</script>

<div class="door">
  <header class="door__mast">
    <h1 class="door__wordmark">Music Ratings</h1>
    <p class="door__strap note">
      A private record of what you actually think of the music you listen to. Your ratings stay on
      this device unless you tell them otherwise.
    </p>
  </header>

  <ol class="door__steps" aria-label="Setup progress">
    {#each steps as label, index (label)}
      <li class:is-done={index < step} class:is-here={index === step}>
        <span class="figure">{index + 1}</span>
        <span class="label">{label}</span>
      </li>
    {/each}
  </ol>

  {#if step === 0}
    <section class="door__panel">
      <h2 class="title">Connect your music</h2>

      <div class="choices">
        <div class="choice choice--form">
          <span class="choice__name">Connect Spotify</span>
          <span class="note">
            Reads your library, top items and recent plays so the queue knows what to put in front
            of you. Ratings are yours and never leave this device.
          </span>
          <button
            type="button"
            class="btn btn--primary"
            disabled={working}
            onclick={() => void chooseSpotify()}
          >
            <Icon name="link" size={14} />
            {$spotifySession.connected ? 'Reconnect Spotify' : 'Sign in with Spotify'}
          </button>

          {#if HAS_BUILT_IN_SPOTIFY}
            <details class="advanced">
              <summary class="note note--small">Use my own Spotify app instead</summary>
              <label class="field">
                <span class="label">Spotify client ID</span>
                <input
                  class="input"
                  bind:value={clientId}
                  placeholder="Leave blank to use this app's"
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>
              <p class="note note--small">
                Only needed if this app's Spotify sign-in turns you away. Register an app in the
                Spotify developer dashboard, list
                <code class="mono">{$settings.spotifyRedirectUri}</code>
                as a redirect URI, and add your account to it.
              </p>
            </details>
          {:else}
            <label class="field">
              <span class="label">Spotify client ID</span>
              <input
                class="input"
                bind:value={clientId}
                placeholder="From your Spotify developer dashboard"
                autocomplete="off"
                spellcheck="false"
              />
            </label>
            <p class="note note--small">
              The app in your dashboard must list
              <code class="mono">{$settings.spotifyRedirectUri}</code>
              as a redirect URI, and your account must be added to it.
            </p>
          {/if}
        </div>

        <button
          type="button"
          class="choice choice--quiet"
          disabled={working}
          onclick={() => goTo(1)}
        >
          <span class="choice__name">
            {$spotifySession.connected ? 'Carry on with setup' : 'Set up without Spotify'}
          </span>
          <span class="note">
            {#if $spotifySession.connected}
              Spotify is connected. Next, choose what you want to rate.
            {:else}
              Start with nothing and add music by hand. You can connect Spotify later.
            {/if}
          </span>
        </button>
      </div>

      {#if HAS_BUILT_IN_ONEDRIVE}
        <div class="returning">
          <p class="note note--small">Used this before?</p>
          <button
            type="button"
            class="btn btn--quiet"
            disabled={working}
            onclick={() => void chooseRestore()}
          >
            <Icon name="cloud" size={14} />
            Restore my ratings from OneDrive
          </button>
          <p class="note note--small">
            Signs in to your Microsoft account and brings back the backup this app saved there.
            Nothing on this device is overwritten if no backup is found.
          </p>
        </div>
      {/if}
    </section>
  {:else if step === 1}
    <section class="door__panel">
      <h2 class="title">What do you want to rate?</h2>
      {#if justConnected}
        <p class="note linked">
          <Icon name="check" size={14} /> Spotify connected as {$spotifySession.profileName ??
            'your account'}. Your library is loading in the background.
        </p>
      {/if}
      <p class="note">
        Only these appear in the rating queue, the rankings and the library. You can change this
        whenever you like; turning a type off hides it without deleting anything.
      </p>

      <ul class="types">
        {#each ENTITY_TYPES as type (type)}
          {@const caveat = ENTITY_SUPPORT[type].note}
          <li>
            <label class="check">
              <input
                type="checkbox"
                checked={chosenTypes.includes(type)}
                onchange={() => toggleType(type)}
              />
              <span>
                <span class="types__name">{entityLabel(type, true)}</span>
                {#if caveat}
                  <span class="note note--small">{caveat}</span>
                {/if}
              </span>
            </label>
          </li>
        {/each}
      </ul>

      <div class="row">
        <button type="button" class="btn btn--quiet" onclick={() => goTo(0)}>Back</button>
        <button type="button" class="btn btn--primary" onclick={() => goTo(2)}>Continue</button>
      </div>
    </section>
  {:else}
    <section class="door__panel">
      <h2 class="title">Pick a scale you will actually use</h2>
      <p class="note">
        Every rating is stored on a common 0–100 basis underneath, so changing your mind about the
        scale later re-labels your history rather than rewriting it.
      </p>

      <ul class="scales">
        {#each $allScales as scale (scale.id)}
          <li>
            <label class="check">
              <input type="radio" name="scale" value={scale.id} bind:group={scaleId} />
              <span>
                <span class="types__name">{scale.label}</span>
                <span class="note note--small">{describeScale(scale)}</span>
              </span>
            </label>
          </li>
        {/each}
      </ul>

      <div class="row">
        <button type="button" class="btn btn--quiet" onclick={() => goTo(1)}>Back</button>
        <button
          type="button"
          class="btn btn--primary btn--wide"
          disabled={working}
          onclick={() => void finish()}
        >
          Start rating
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  .door {
    max-width: 46rem;
    margin-inline: auto;
    padding: var(--s7) var(--s5) var(--s8);
    display: flex;
    flex-direction: column;
    gap: var(--s6);
  }

  .door__mast {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    align-items: flex-start;
    padding-bottom: var(--s5);
    border-bottom: var(--rule-weight) solid var(--ink);
  }
  .door__wordmark {
    font-family: var(--display);
    font-size: clamp(2rem, 1.4rem + 2.6vw, 3rem);
    line-height: 1;
    letter-spacing: -0.015em;
  }
  .door__strap {
    max-width: 44ch;
  }

  .door__steps {
    display: flex;
    gap: var(--s5);
    border-bottom: var(--rule-weight) solid var(--border-faint);
    padding-bottom: var(--s3);
  }
  .door__steps li {
    display: flex;
    align-items: baseline;
    gap: var(--s2);
    color: var(--ink-faint);
  }
  .door__steps li.is-here {
    color: var(--ink);
  }
  .door__steps li.is-here .figure {
    color: var(--accent-ink);
  }
  .door__steps li.is-done {
    color: var(--ink-quiet);
  }

  .door__panel {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }

  .choice {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    align-items: flex-start;
    text-align: left;
    padding: var(--s4);
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--border);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: border-color var(--dur-1) var(--ease);
  }
  .choice:hover:not(:disabled) {
    border-color: var(--ink);
  }
  .choice--form {
    cursor: default;
    border-color: var(--ink);
  }
  .choice--form:hover {
    border-color: var(--ink);
  }
  .choice--quiet {
    background: transparent;
  }
  .choice__name {
    font-family: var(--display);
    font-size: 1.125rem;
  }
  .choice .note {
    max-width: 54ch;
  }
  .choice .field,
  .choice .btn {
    margin-top: var(--s1);
  }
  .choice .field {
    width: 100%;
    max-width: 26rem;
  }

  .linked {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--accent);
  }

  .types,
  .scales {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .types li,
  .scales li {
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .types li:first-child,
  .scales li:first-child {
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .types__name {
    display: block;
    font-size: 0.9375rem;
  }

  code.mono {
    word-break: break-all;
  }

  .advanced {
    width: 100%;
    margin-top: var(--s2);
    border-top: var(--rule-weight) solid var(--border-faint);
    padding-top: var(--s3);
  }
  .advanced summary {
    cursor: pointer;
  }
  .advanced .field {
    margin-top: var(--s3);
  }

  /* The way back in, for someone who has been here before. Quiet on purpose:
     it is the rarer door, and it must not compete with connecting Spotify. */
  .returning {
    margin-top: var(--s4);
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--border-faint);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s2);
  }
</style>
