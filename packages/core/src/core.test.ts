import { describe, it, expect, vi } from 'vitest';
import { RecurseCore } from './core.js';
import type { FetchChildrenContext } from './types.js';

type MyData = { name: string };

describe('RecurseCore', () => {
  it('initializes with empty state by default', () => {
    const core = new RecurseCore<MyData>();
    const state = core.getState();
    expect(state.items).toEqual({});
    expect(state.roots).toEqual([]);
  });

  it('adds root nodes correctly', () => {
    const core = new RecurseCore<MyData>();
    core.add({
      id: '1',
      data: { name: 'Root 1' },
      childrenIds: [],
      parentId: null,
    });

    const state = core.getState();
    expect(state.roots).toContain('1');
    expect(state.items['1']).toBeDefined();
    expect(core.getTree().length).toBe(1);
    expect(core.getTree()[0].id).toBe('1');
  });

  it('adds child nodes correctly', () => {
    const core = new RecurseCore<MyData>();
    core.add({
      id: '1',
      data: { name: 'Root 1' },
      childrenIds: [],
      parentId: null,
    });
    core.add({
      id: '2',
      data: { name: 'Child 1' },
      childrenIds: [],
      parentId: '1',
    });

    const state = core.getState();
    expect(state.roots).toEqual(['1']);
    expect(state.items['2'].parentId).toBe('1');
    expect(state.items['1'].childrenIds).toContain('2');

    const children = core.getChildren('1');
    expect(children.length).toBe(1);
    expect(children[0].id).toBe('2');
  });

  it('updates node data correctly', () => {
    const core = new RecurseCore<MyData>();
    core.add({
      id: '1',
      data: { name: 'Root 1' },
      childrenIds: [],
      parentId: null,
    });
    core.update('1', { name: 'Updated Root 1' });

    const node = core.getNode('1');
    expect(node?.data.name).toBe('Updated Root 1');
  });

  it('removes a node and its children', () => {
    const core = new RecurseCore<MyData>();
    core.add({
      id: '1',
      data: { name: 'Root 1' },
      parentId: null,
    });
    core.add({
      id: '2',
      data: { name: 'Child 1' },
      parentId: '1',
    });
    core.add({
      id: '3',
      data: { name: 'Grandchild 1' },
      parentId: '2',
    });

    core.remove('2');

    const state = core.getState();
    expect(state.items['2']).toBeUndefined();
    expect(state.items['3']).toBeUndefined();
    expect(state.items['1'].childrenIds).not.toContain('2');
  });

  it('moves a node to a new parent', () => {
    const core = new RecurseCore<MyData>();
    core.add({ id: '1', data: { name: 'Root 1' }, parentId: null });
    core.add({ id: '2', data: { name: 'Root 2' }, parentId: null });
    core.add({ id: '3', data: { name: 'Child 1' }, parentId: '1' });

    core.move('3', '2');

    const state = core.getState();
    expect(state.items['1'].childrenIds).not.toContain('3');
    expect(state.items['2'].childrenIds).toContain('3');
    expect(state.items['3'].parentId).toBe('2');
  });

  it('notifies granular subscribers correctly', () => {
    const core = new RecurseCore<MyData>();
    const rootListener = vi.fn();
    const childListener = vi.fn();

    core.add({ id: '1', data: { name: 'Root 1' }, parentId: null });
    core.add({ id: '2', data: { name: 'Child 1' }, parentId: '1' });

    core.subscribeToNode('1', rootListener);
    core.subscribeToNode('2', childListener);

    core.update('2', { name: 'Updated Child' });
    expect(childListener).toHaveBeenCalledTimes(1);
    expect(rootListener).toHaveBeenCalledTimes(0);

    core.add({ id: '3', data: { name: 'Child 2' }, parentId: '1' });
    expect(rootListener).toHaveBeenCalledTimes(1);
    expect(childListener).toHaveBeenCalledTimes(1);

    core.remove('2');
    expect(childListener).toHaveBeenCalledTimes(2);
    expect(rootListener).toHaveBeenCalledTimes(2);
  });

  // --- Async & Cache Feature Tests ---

  it('toggleExpand fetches children if not fetched before', async () => {
    const fetchChildrenFn = vi.fn().mockResolvedValue({
      nodes: [
        { id: 'child-1', data: { name: 'Fetched Child' }, parentId: 'root-1' },
      ],
      nextPageParam: 2,
    });

    const core = new RecurseCore<MyData>({ fetchChildrenFn });
    core.add({ id: 'root-1', data: { name: 'Root' }, parentId: null });

    expect(core.getNode('root-1')!.isExpanded).toBe(false);

    await core.toggleExpand('root-1');

    const root = core.getNode('root-1')!;
    expect(root.isExpanded).toBe(true);
    expect(root.childrenFetchStatus).toBe('success');
    expect(root.hasNextPage).toBe(true);
    expect(root.nextPageParam).toBe(2);

    const children = core.getChildren('root-1');
    expect(children.length).toBe(1);
    expect(children[0].id).toBe('child-1');

    // Toggle again should just collapse without fetch
    await core.toggleExpand('root-1');
    expect(core.getNode('root-1')!.isExpanded).toBe(false);
    expect(fetchChildrenFn).toHaveBeenCalledTimes(1);
  });

  it('fetchNextPage correctly fetches and appends next page', async () => {
    let callCount = 0;
    const fetchChildrenFn = vi
      .fn()
      .mockImplementation(async (ctx: FetchChildrenContext) => {
        callCount++;
        return {
          nodes: [
            {
              id: `child-${callCount}`,
              data: { name: `Child ${callCount}` },
              parentId: ctx.parentId,
            },
          ],
          nextPageParam: ctx.pageParam === 1 ? null : 1, // First call returns next page param 1, second returns null
        };
      });

    const core = new RecurseCore<MyData>({ fetchChildrenFn });
    core.add({ id: 'root-1', data: { name: 'Root' }, parentId: null });

    await core.toggleExpand('root-1'); // Gets page 0
    expect(core.getNode('root-1')!.nextPageParam).toBe(1);

    await core.fetchNextPage('root-1'); // Gets page 1

    const root = core.getNode('root-1')!;
    expect(root.nextPageParam).toBe(null);
    expect(root.hasNextPage).toBe(false);

    const children = core.getChildren('root-1');
    expect(children.length).toBe(2);
    expect(children[0].id).toBe('child-1');
    expect(children[1].id).toBe('child-2');
  });

  it('setChildrenCache manually updates the children and pagination', () => {
    const core = new RecurseCore<MyData>();
    core.add({ id: 'root-1', data: { name: 'Root' }, parentId: null });

    core.setChildrenCache(
      'root-1',
      [{ id: 'injected-1', data: { name: 'Injected' }, parentId: 'root-1' }],
      { hasNextPage: true, nextPageParam: 99 },
    );

    const root = core.getNode('root-1')!;
    expect(root.childrenFetchStatus).toBe('success');
    expect(root.hasNextPage).toBe(true);
    expect(root.nextPageParam).toBe(99);

    const children = core.getChildren('root-1');
    expect(children.length).toBe(1);
    expect(children[0].id).toBe('injected-1');
  });

  it('updateNodeCache safely updates node data with a callback', () => {
    const core = new RecurseCore<{ count: number }>();
    core.add({ id: 'node-1', data: { count: 1 }, parentId: null });

    core.updateNodeCache('node-1', (old) => ({ count: old.count + 1 }));

    const node = core.getNode('node-1')!;
    expect(node.data.count).toBe(2);
  });
});
