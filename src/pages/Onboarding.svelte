<script lang="ts">
  import { installDemo } from '../lib/app/demo';
  import { notify } from '../lib/app/notices';
  import { navigate } from '../lib/app/router';
  import { allScales, entityLabel, settings, updateSettings } from '../lib/app/state';
  import { describeScale } from '../lib/domain/scales';
  import { ENTITY_TYPES } from '../lib/domain/types';
  import type { EntityType } from '../lib/domain/types';
  import { ENTITY_SUPPORT } from '../lib/spotify/capabilities';
  import { connectSpotify } from '../lib/spotify/session';
  import Icon from '../lib/ui/Icon.svelte';
  import RegisterMark from '../components/RegisterMark.svelte';

  /**
   * The front door.
   *
   * Three decisions, in the order they actually matter: where the catalogue
   * comes from, what you are willing to rate, and on what scale. Everything
   * else has a defensible default and lives in Settings.
   */

  let step = $state(0);
  let chosenTypes = $state<EntityType[]>([...$settings.enabledTypes]);
  let scaleId = $state($settings.defaultScaleId);
  let working = $state(false);
  let clientId = $state($settings.spotifyClientId);

  const steps = ['Source', 'What you rate', 'The scale'];

  function toggleType(type: EntityType) {
    chosenTypes = chosenTypes.includes(type)
      ? chosenTypes.filter((t) => t !== type)
      : [...chosenTypes, type];
  }

  async function chooseDemo() {
    working = true;
    try {
      await installDemo();
      step = 1;
    } finally {
      working = false;
    }
  }

  async function chooseSpotify() {
    if (!clientId.trim()) {
      notify('Spotify needs a client ID from your developer dashboard first.', { tone: 'warn' });
      return;
    }
    working = true;
    try {
      // Types and scale are saved first so they survive the round trip to Spotify.
      await updateSettings({
        spotifyClientId: clientId.trim(),
        enabledTypes: chosenTypes,
        defaultScaleId: scaleId,
        onboarded: true,
      });
      await connectSpotify('/');
    } catch (error) {
      working = false;
      notify(error instanceof Error ? error.message : 'Could not start the Spotify sign-in.', {
        tone: 'warn',
      });
    }
  }

  async function finish() {
    working = true;
    try {
      await updateSettings({
        enabledTypes: chosenTypes.length > 0 ? chosenTypes : ['artist', 'album', 'track'],
        defaultScaleId: scaleId,
        onboarded: true,
      });
      navigate('/', { replace: true });
    } finally {
      working = false;
    }
  }
</script>

<div class="door">
  <header class="door__mast">
    <RegisterMark size={15} />
    <h1 class="door__wordmark">Ledger</h1>
    <p class="door__strap note">
      A private record of what you actually think of the music you listen to. Your ratings stay on
      this device unless you tell them otherwise.
    </p>
  </header>

  <ol class="door__steps" aria-label="Setup progress">
    {#each steps as label, index (label)}
      <li class:is-done={index < step} class:is-here={index === step}>
        <span class="figure">{index + 1}</span>
        <span class="apparatus">{label}</span>
      </li>
    {/each}
  </ol>

  {#if step === 0}
    <section class="door__panel">
      <h2 class="title">Where does the catalogue come from?</h2>

      <div class="choices">
        <button type="button" class="choice" disabled={working} onclick={() => void chooseDemo()}>
          <span class="choice__name">Try it with a made-up catalogue</span>
          <span class="note">
            Eleven invented artists, their releases, a few playlists, and a plausible history of
            ratings already in place. No accounts, nothing sent anywhere. You can clear it later.
          </span>
        </button>

        <div class="choice choice--form">
          <span class="choice__name">Connect Spotify</span>
          <span class="note">
            Reads your library, top items and recent plays so the queue knows what to put in front
            of you. Ratings are yours and never leave this device.
          </span>
          <label class="field">
            <span class="apparatus">Spotify client ID</span>
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
            <code class="machine">{$settings.spotifyRedirectUri}</code>
            as a redirect URI, and your account must be added to it. Spotify allows five accounts per
            app in development mode.
          </p>
          <button
            type="button"
            class="btn btn--primary"
            disabled={working}
            onclick={() => void chooseSpotify()}
          >
            <Icon name="link" size={14} /> Connect and authorise
          </button>
        </div>

        <button
          type="button"
          class="choice choice--quiet"
          disabled={working}
          onclick={() => (step = 1)}
        >
          <span class="choice__name">Start empty</span>
          <span class="note">
            Nothing in the ledger. Add a source later, or restore a backup from Settings.
          </span>
        </button>
      </div>
    </section>
  {:else if step === 1}
    <section class="door__panel">
      <h2 class="title">What do you want to keep an opinion on?</h2>
      <p class="note">
        Only these appear in the queue, the lists and the standings. You can change this whenever
        you like; turning a type off hides it without deleting anything.
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
        <button type="button" class="btn btn--quiet" onclick={() => (step = 0)}>Back</button>
        <button type="button" class="btn btn--primary" onclick={() => (step = 2)}>Continue</button>
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
        <button type="button" class="btn btn--quiet" onclick={() => (step = 1)}>Back</button>
        <button
          type="button"
          class="btn btn--primary btn--wide"
          disabled={working}
          onclick={() => void finish()}
        >
          Open the ledger
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
    font-family: var(--serif);
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
    border-bottom: var(--rule-weight) solid var(--rule-faint);
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
    color: var(--rubric-ink);
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
    background: var(--paper-raised);
    border: var(--rule-weight) solid var(--rule);
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
    font-family: var(--serif);
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

  .types,
  .scales {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .types li,
  .scales li {
    border-bottom: var(--rule-weight) solid var(--rule-faint);
  }
  .types li:first-child,
  .scales li:first-child {
    border-top: var(--rule-weight) solid var(--rule-faint);
  }
  .types__name {
    display: block;
    font-size: 0.9375rem;
  }

  code.machine {
    word-break: break-all;
  }
</style>
