import { loadBrowserEphemeraEngine } from '../engine/browser';
import { searchEvents } from './events';
import type { SearchWorkerMessage, SearchWorkerRequest } from './protocol';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<SearchWorkerRequest>) => void) | null;
  postMessage(message: SearchWorkerMessage): void;
};

worker.onmessage = async ({ data }) => {
  try {
    const engine = await loadBrowserEphemeraEngine();
    const result = searchEvents(engine, data.request, progress => worker.postMessage({ type: 'progress', progress }));
    worker.postMessage({ type: 'complete', result });
  } catch (error) {
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Event search failed.' });
  }
};
