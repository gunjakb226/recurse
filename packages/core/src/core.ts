import type {
  RecurseNode,
  RecurseNodeInput,
  RecurseState,
  RecurseStoreOptions,
  FetchChildrenContext,
  FetchChildrenResponse,
} from './types.js';

export class RecurseCore<TData = unknown> {
  private state: RecurseState<TData>;
  private listeners: Set<() => void> = new Set();
  private nodeListeners: Map<
    string,
    Set<(node: RecurseNode<TData> | undefined) => void>
  > = new Map();
  private fetchChildrenFn?: (
    context: FetchChildrenContext,
  ) => Promise<FetchChildrenResponse<TData>>;

  constructor(options?: RecurseStoreOptions<TData>) {
    this.state = options?.initialData ?? {
      items: {},
      roots: [],
    };
    this.fetchChildrenFn = options?.fetchChildrenFn;
  }

  // Read Operations

  getState(): RecurseState<TData> {
    return this.state;
  }

  getNode(id: string): RecurseNode<TData> | undefined {
    return this.state.items[id];
  }

  getChildren(id: string): RecurseNode<TData>[] {
    const node = this.getNode(id);
    if (!node) return [];
    return node.childrenIds
      .map((childId) => this.getNode(childId))
      .filter((n): n is RecurseNode<TData> => n !== undefined);
  }

  getTree(): RecurseNode<TData>[] {
    return this.state.roots
      .map((rootId) => this.getNode(rootId))
      .filter((n): n is RecurseNode<TData> => n !== undefined);
  }

  // Subscriptions

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToNode(
    id: string,
    listener: (node: RecurseNode<TData> | undefined) => void,
  ): () => void {
    if (!this.nodeListeners.has(id)) {
      this.nodeListeners.set(id, new Set());
    }
    this.nodeListeners.get(id)!.add(listener);
    return () => {
      this.nodeListeners.get(id)?.delete(listener);
      if (this.nodeListeners.get(id)?.size === 0) {
        this.nodeListeners.delete(id);
      }
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private notifyNode(id: string) {
    const node = this.state.items[id];
    this.nodeListeners.get(id)?.forEach((listener) => listener(node));
  }

  // --- Core Mutations ---

  private updateNodeInternal(
    id: string,
    partialNode: Partial<RecurseNode<TData>>,
  ) {
    const node = this.state.items[id];
    if (!node) return;
    this.state = {
      ...this.state,
      items: { ...this.state.items, [id]: { ...node, ...partialNode } },
    };
    this.notify();
    this.notifyNode(id);
  }

  add(input: RecurseNodeInput<TData>) {
    const node: RecurseNode<TData> = {
      id: input.id,
      data: input.data,
      parentId: input.parentId,
      childrenIds: input.childrenIds ?? [],
      isExpanded: input.isExpanded ?? false,
      childrenFetchStatus: input.childrenFetchStatus ?? 'idle',
      isFetchingNextPage: false,
      hasNextPage: input.hasNextPage ?? false,
      nextPageParam: input.nextPageParam,
    };
    const nextItems = { ...this.state.items, [node.id]: node };
    let nextRoots = this.state.roots;

    if (node.parentId === null) {
      if (!nextRoots.includes(node.id)) {
        nextRoots = [...nextRoots, node.id];
      }
    } else {
      const parent = nextItems[node.parentId];
      if (parent && !parent.childrenIds.includes(node.id)) {
        nextItems[node.parentId] = {
          ...parent,
          childrenIds: [...parent.childrenIds, node.id],
        };
      }
    }

    this.state = { items: nextItems, roots: nextRoots };
    this.notify();
    this.notifyNode(node.id);
    if (node.parentId) {
      this.notifyNode(node.parentId);
    }
  }

  update(id: string, data: Partial<TData>) {
    const node = this.state.items[id];
    if (!node) return;

    this.state = {
      ...this.state,
      items: {
        ...this.state.items,
        [id]: {
          ...node,
          data: { ...node.data, ...data },
        },
      },
    };

    this.notify();
    this.notifyNode(id);
  }

  updateNodeCache(id: string, updater: (oldData: TData) => TData) {
    const node = this.state.items[id];
    if (!node) return;

    this.state = {
      ...this.state,
      items: {
        ...this.state.items,
        [id]: {
          ...node,
          data: updater(node.data),
        },
      },
    };

    this.notify();
    this.notifyNode(id);
  }

  setChildrenCache(
    parentId: string,
    nodes: RecurseNodeInput<TData>[],
    options?: { hasNextPage?: boolean; nextPageParam?: unknown },
  ) {
    const parent = this.state.items[parentId];
    if (!parent) return;

    const oldChildrenIds = [...parent.childrenIds];
    oldChildrenIds.forEach((childId) => this.remove(childId));

    nodes.forEach((node) => this.add({ ...node, parentId }));

    this.updateNodeInternal(parentId, {
      childrenFetchStatus: 'success',
      hasNextPage: options?.hasNextPage ?? false,
      nextPageParam: options?.nextPageParam,
    });
  }

  remove(id: string) {
    const node = this.state.items[id];
    if (!node) return;

    const nextItems = { ...this.state.items };
    let nextRoots = this.state.roots;

    if (node.parentId === null) {
      nextRoots = nextRoots.filter((rootId) => rootId !== id);
    } else {
      const parent = nextItems[node.parentId];
      if (parent) {
        nextItems[node.parentId] = {
          ...parent,
          childrenIds: parent.childrenIds.filter((childId) => childId !== id),
        };
      }
    }

    const queue = [id];
    const removedIds: string[] = [];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = nextItems[currentId];
      if (current) {
        queue.push(...current.childrenIds);
        delete nextItems[currentId];
        removedIds.push(currentId);
      }
    }

    this.state = { items: nextItems, roots: nextRoots };
    this.notify();

    removedIds.forEach((removedId) => this.notifyNode(removedId));
    if (node.parentId) {
      this.notifyNode(node.parentId);
    }
  }

  move(id: string, newParentId: string | null) {
    const node = this.state.items[id];
    if (!node) return;

    const nextItems = { ...this.state.items };
    let nextRoots = this.state.roots;
    const oldParentId = node.parentId;

    if (oldParentId === null) {
      nextRoots = nextRoots.filter((rootId) => rootId !== id);
    } else {
      const oldParent = nextItems[oldParentId];
      if (oldParent) {
        nextItems[oldParentId] = {
          ...oldParent,
          childrenIds: oldParent.childrenIds.filter(
            (childId) => childId !== id,
          ),
        };
      }
    }

    nextItems[id] = { ...node, parentId: newParentId };

    if (newParentId === null) {
      nextRoots = [...nextRoots, id];
    } else {
      const newParent = nextItems[newParentId];
      if (newParent) {
        nextItems[newParentId] = {
          ...newParent,
          childrenIds: [...newParent.childrenIds, id],
        };
      }
    }

    this.state = { items: nextItems, roots: nextRoots };
    this.notify();

    this.notifyNode(id);
    if (oldParentId) this.notifyNode(oldParentId);
    if (newParentId) this.notifyNode(newParentId);
  }

  // Async & Lazy Loading Operations

  async toggleExpand(id: string) {
    const node = this.state.items[id];
    if (!node) return;

    if (node.isExpanded) {
      this.updateNodeInternal(id, { isExpanded: false });
      return;
    }

    if (node.childrenFetchStatus === 'success') {
      this.updateNodeInternal(id, { isExpanded: true });
      return;
    }

    if (!this.fetchChildrenFn) {
      this.updateNodeInternal(id, { isExpanded: true });
      return;
    }

    this.updateNodeInternal(id, {
      isExpanded: true,
      childrenFetchStatus: 'loading',
    });

    try {
      const response = await this.fetchChildrenFn({
        parentId: id,
        pageParam: undefined,
      });

      response.nodes.forEach((n) => this.add({ ...n, parentId: id }));

      this.updateNodeInternal(id, {
        childrenFetchStatus: 'success',
        hasNextPage:
          response.nextPageParam !== undefined &&
          response.nextPageParam !== null,
        nextPageParam: response.nextPageParam,
      });
    } catch (e) {
      this.updateNodeInternal(id, { childrenFetchStatus: 'error' });
    }
  }

  async fetchNextPage(id: string) {
    const node = this.state.items[id];
    if (!node || !this.fetchChildrenFn) return;
    if (!node.hasNextPage || node.isFetchingNextPage) return;

    this.updateNodeInternal(id, { isFetchingNextPage: true });

    try {
      const response = await this.fetchChildrenFn({
        parentId: id,
        pageParam: node.nextPageParam,
      });

      response.nodes.forEach((n) => this.add({ ...n, parentId: id }));

      this.updateNodeInternal(id, {
        isFetchingNextPage: false,
        hasNextPage:
          response.nextPageParam !== undefined &&
          response.nextPageParam !== null,
        nextPageParam: response.nextPageParam,
      });
    } catch (e) {
      this.updateNodeInternal(id, { isFetchingNextPage: false });
    }
  }

  async refetchChildren(id: string) {
    const node = this.state.items[id];
    if (!node || !this.fetchChildrenFn) return;

    this.updateNodeInternal(id, { childrenFetchStatus: 'loading' });

    const childrenIds = [...node.childrenIds];
    childrenIds.forEach((childId) => this.remove(childId));

    try {
      const response = await this.fetchChildrenFn({
        parentId: id,
        pageParam: undefined,
      });

      response.nodes.forEach((n) => this.add({ ...n, parentId: id }));

      this.updateNodeInternal(id, {
        childrenFetchStatus: 'success',
        hasNextPage:
          response.nextPageParam !== undefined &&
          response.nextPageParam !== null,
        nextPageParam: response.nextPageParam,
      });
    } catch (e) {
      this.updateNodeInternal(id, { childrenFetchStatus: 'error' });
    }
  }
}
