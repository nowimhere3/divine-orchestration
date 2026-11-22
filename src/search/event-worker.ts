import { loadBrowserEphemeraEngine } from '../engine/browser';
import { computeTransitEnrichment } from '../interpret/transit-enrichment';
import { searchEvents } from './events';
import { searchEventRange } from './range';
import type { SearchWorkerMessage, SearchWorkerRequest } from './protocol';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<SearchWorkerRequest>) => void) | null;
  postMessage(message: SearchWorkerMessage): void;
};

worker.onmessage = async ({ data }) => {
  try {
    const engine = await loadBrowserEphemeraEngine();
    if (data.kind === 'transit-enrichment') {
      const result = computeTransitEnrichment(engine, data.request);
      worker.postMessage({ type: 'enrichment-complete', result });
      return;
    }
    if (data.kind === 'range-search') {
      const result = searchEventRange(engine, data.request, progress => worker.postMessage({ type: 'range-progress', progress }));
      worker.postMessage({ type: 'range-complete', result });
      return;
    }
    const result = searchEvents(engine, data.request, progress => worker.postMessage({ type: 'progress', progress }));
    worker.postMessage({ type: 'complete', result });
  } catch (error) {
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Event search failed.' });
  }
};
