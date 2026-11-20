import wasmUrl from '@astrologer/ephemera/wasm/ephemeris-1as.wasm?url';
import { createEphemeraEngine } from './ephemera';

/** Let Vite emit the WASM URL with the configured base for static subpath hosting. */
export async function loadBrowserEphemeraEngine() {
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`Ephemera WASM request failed (HTTP ${response.status}).`);
  }
  return createEphemeraEngine(await response.arrayBuffer());
}
