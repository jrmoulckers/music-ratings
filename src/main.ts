import '@fontsource-variable/libre-franklin';
import './app.css';

import { mount } from 'svelte';
import { get } from 'svelte/store';

import App from './App.svelte';
import { startPwa } from './lib/app/pwa';
import { loadAll, settings } from './lib/app/state';
import { applyTheme, watchSystemTheme } from './lib/ui/theme';

/**
 * Boot order matters: paint the right theme before the first frame, then load
 * saved data, then mount. The app never flashes the wrong palette.
 */

applyTheme(get(settings));
settings.subscribe(applyTheme);
watchSystemTheme(() => get(settings));

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app mount point');

void loadAll();
mount(App, { target });
void startPwa();
