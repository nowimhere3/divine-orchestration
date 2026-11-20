import { loadBrowserEphemeraEngine } from '../../../src/engine/browser';

const engine = await loadBrowserEphemeraEngine();
const result = engine.position('Sun', {
  jdTt: 2451545,
  jdUt: 2451545 - 63.8285 / 86400,
  deltaTYear: 2000,
});
document.body.dataset.engineResult = JSON.stringify(result);
