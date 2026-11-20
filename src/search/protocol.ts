import type { EventSearchRequest, EventSearchResult, SearchProgress } from './events';

export type SearchWorkerRequest = { readonly request: EventSearchRequest };
export type SearchWorkerMessage =
  | { readonly type: 'progress'; readonly progress: SearchProgress }
  | { readonly type: 'complete'; readonly result: EventSearchResult }
  | { readonly type: 'error'; readonly message: string };
