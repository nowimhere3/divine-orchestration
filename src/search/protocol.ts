import type { TransitEnrichmentData, TransitEnrichmentRequest } from '../interpret/transit-types';
import type { EventSearchRequest, EventSearchResult, SearchProgress } from './events';

export type SearchWorkerRequest =
  | { readonly kind?: 'event-search'; readonly request: EventSearchRequest }
  | { readonly kind: 'transit-enrichment'; readonly request: TransitEnrichmentRequest };

export type SearchWorkerMessage =
  | { readonly type: 'progress'; readonly progress: SearchProgress }
  | { readonly type: 'complete'; readonly result: EventSearchResult }
  | { readonly type: 'enrichment-complete'; readonly result: TransitEnrichmentData }
  | { readonly type: 'error'; readonly message: string };
