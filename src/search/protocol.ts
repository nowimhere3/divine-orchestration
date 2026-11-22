import type { TransitEnrichmentData, TransitEnrichmentRequest } from '../interpret/transit-types';
import type { EventSearchRequest, EventSearchResult, SearchProgress } from './events';
import type { EventRangeSearchRequest, EventRangeSearchResult, RangeSearchProgress } from './range';

export type SearchWorkerRequest =
  | { readonly kind?: 'event-search'; readonly request: EventSearchRequest }
  | { readonly kind: 'transit-enrichment'; readonly request: TransitEnrichmentRequest }
  | { readonly kind: 'range-search'; readonly request: EventRangeSearchRequest };

export type SearchWorkerMessage =
  | { readonly type: 'progress'; readonly progress: SearchProgress }
  | { readonly type: 'complete'; readonly result: EventSearchResult }
  | { readonly type: 'enrichment-complete'; readonly result: TransitEnrichmentData }
  | { readonly type: 'range-progress'; readonly progress: RangeSearchProgress }
  | { readonly type: 'range-complete'; readonly result: EventRangeSearchResult }
  | { readonly type: 'error'; readonly message: string };
