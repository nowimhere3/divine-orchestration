import type { TransitEnrichmentData, TransitEnrichmentRequest } from '../interpret/transit-types';
import type { EventSearchRequest, EventSearchResult, SearchProgress } from './events';
import type { SearchWorkerMessage } from './protocol';

export interface EventSearchJob {
  readonly result: Promise<EventSearchResult>;
  cancel(): void;
}

export interface TransitEnrichmentJob {
  readonly result: Promise<TransitEnrichmentData>;
  cancel(): void;
}

export function startEventSearch(request: EventSearchRequest, progress: (value: SearchProgress) => void): EventSearchJob {
  const worker = new Worker(new URL('./event-worker.ts', import.meta.url), { type: 'module' });
  let active = true;
  let cancel = () => {};
  const result = new Promise<EventSearchResult>((resolve, reject) => {
    const settle = (finish: () => void) => {
      if (!active) return;
      active = false;
      worker.terminate();
      finish();
    };
    cancel = () => settle(() => reject(new DOMException('Event search canceled.', 'AbortError')));
    worker.onmessage = ({ data }: MessageEvent<SearchWorkerMessage>) => {
      if (!active) return;
      switch (data.type) {
        case 'progress': progress(data.progress); break;
        case 'complete': settle(() => resolve(data.result)); break;
        case 'error': settle(() => reject(new Error(data.message))); break;
      }
    };
    worker.onerror = () => settle(() => reject(new Error('The event search worker could not run.')));
    worker.onmessageerror = () => settle(() => reject(new Error('The event search worker returned unreadable data.')));
    try {
      worker.postMessage({ request });
    } catch (error) {
      settle(() => reject(error));
    }
  });
  return { result, cancel };
}

export function startTransitEnrichment(request: TransitEnrichmentRequest): TransitEnrichmentJob {
  const worker = new Worker(new URL('./event-worker.ts', import.meta.url), { type: 'module' });
  let active = true;
  let cancel = () => {};
  const result = new Promise<TransitEnrichmentData>((resolve, reject) => {
    const settle = (finish: () => void) => {
      if (!active) return;
      active = false;
      worker.terminate();
      finish();
    };
    cancel = () => settle(() => reject(new DOMException('Transit enrichment canceled.', 'AbortError')));
    worker.onmessage = ({ data }: MessageEvent<SearchWorkerMessage>) => {
      if (!active) return;
      switch (data.type) {
        case 'enrichment-complete': settle(() => resolve(data.result)); break;
        case 'error': settle(() => reject(new Error(data.message))); break;
      }
    };
    worker.onerror = () => settle(() => reject(new Error('The transit enrichment worker could not run.')));
    worker.onmessageerror = () => settle(() => reject(new Error('The transit enrichment worker returned unreadable data.')));
    try {
      worker.postMessage({ kind: 'transit-enrichment', request });
    } catch (error) {
      settle(() => reject(error));
    }
  });
  return { result, cancel };
}
