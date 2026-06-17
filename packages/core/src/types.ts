export type RecurseNode<TData = unknown> = {
  id: string;
  data: TData;
  childrenIds: string[];
  parentId: string | null;

  // UI State
  isExpanded: boolean;

  // Fetch / Infinite Query State
  childrenFetchStatus: 'idle' | 'loading' | 'success' | 'error';
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  nextPageParam?: unknown;
};

export type RecurseNodeInput<TData = unknown> = {
  id: string;
  data: TData;
  parentId: string | null;
  childrenIds?: string[];
  isExpanded?: boolean;
  childrenFetchStatus?: 'idle' | 'loading' | 'success' | 'error';
  hasNextPage?: boolean;
  nextPageParam?: unknown;
};

export type FetchChildrenContext = {
  parentId: string;
  pageParam: unknown;
};

export type FetchChildrenResponse<TData = unknown> = {
  nodes: RecurseNodeInput<TData>[];
  nextPageParam?: unknown;
};

export type RecurseState<TData = unknown> = {
  items: Record<string, RecurseNode<TData>>;
  roots: string[];
};

export type RecurseStoreOptions<TData = unknown> = {
  initialData?: RecurseState<TData>;
  fetchChildrenFn?: (
    context: FetchChildrenContext,
  ) => Promise<FetchChildrenResponse<TData>>;
};
