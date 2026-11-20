import { applicationName } from './app';
import { loadBrowserEphemeraEngine } from './engine/browser';
import { mountObservatory } from './view/observatory';
import { mountBirthDialog, mountShell } from './view/shell';
import { byId } from './view/timeline';
import './view/observatory.css';

byId('app-title').textContent = applicationName;
const shell = new AbortController();
mountShell(shell.signal);
mountBirthDialog(shell.signal);
loadBrowserEphemeraEngine().then(mountObservatory).catch(error => {
  const message = 'The calculation engine did not load. Refresh the page to try again.';
  byId('birth-status').textContent = message;
  byId('chart-notice').textContent = message;
  byId('wheel-caption').textContent = 'Calculation engine unavailable';
  console.error(error);
});
