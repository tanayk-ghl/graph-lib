import type { GraphReadStore, NodeId } from "../types.js";

/** Tarjan SCC output normalized into deterministic component ordering. */
export interface SccResult {
  components: NodeId[][];
  nodeToComponentId: ReadonlyMap<NodeId, number>;
}

/**
 * Computes strongly connected components using Tarjan's algorithm.
 *
 * Components and members are normalized to deterministic order so partitioning
 * output is stable across repeated runs.
 */
export function computeStronglyConnectedComponents<TAttributes>(
  store: GraphReadStore<TAttributes>,
): SccResult {
  const nodeIds = store.getNodeIds();
  const nodeOrder = new Map<NodeId, number>();
  for (let idx = 0; idx < nodeIds.length; idx += 1) {
    const nodeId = nodeIds[idx];
    if (nodeId !== undefined) {
      nodeOrder.set(nodeId, idx);
    }
  }

  const discoveryIndex = new Map<NodeId, number>();
  const lowLink = new Map<NodeId, number>();
  const stack: NodeId[] = [];
  const onStack = new Set<NodeId>();
  const discoveredComponents: NodeId[][] = [];
  let nextIndex = 0;

  const visit = (nodeId: NodeId): void => {
    discoveryIndex.set(nodeId, nextIndex);
    lowLink.set(nodeId, nextIndex);
    nextIndex += 1;

    stack.push(nodeId);
    onStack.add(nodeId);

    for (const neighborId of store.getOutgoing(nodeId)) {
      if (!discoveryIndex.has(neighborId)) {
        visit(neighborId);
        const currentLow = lowLink.get(nodeId);
        const neighborLow = lowLink.get(neighborId);
        if (currentLow !== undefined && neighborLow !== undefined) {
          lowLink.set(nodeId, Math.min(currentLow, neighborLow));
        }
      } else if (onStack.has(neighborId)) {
        const currentLow = lowLink.get(nodeId);
        const neighborIndex = discoveryIndex.get(neighborId);
        if (currentLow !== undefined && neighborIndex !== undefined) {
          lowLink.set(nodeId, Math.min(currentLow, neighborIndex));
        }
      }
    }

    // Root of an SCC found: pop until this root is reached.
    if (lowLink.get(nodeId) === discoveryIndex.get(nodeId)) {
      const component: NodeId[] = [];
      while (stack.length > 0) {
        const member = stack.pop();
        if (!member) {
          break;
        }
        onStack.delete(member);
        component.push(member);
        if (member === nodeId) {
          break;
        }
      }
      discoveredComponents.push(component);
    }
  };

  for (const nodeId of nodeIds) {
    if (!discoveryIndex.has(nodeId)) {
      visit(nodeId);
    }
  }

  const normalizedComponents = discoveredComponents
    .map((component) =>
      [...component].sort((left, right) =>
        (nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      )
    )
    .sort((left, right) =>
      (nodeOrder.get(left[0] ?? "") ?? Number.MAX_SAFE_INTEGER)
      - (nodeOrder.get(right[0] ?? "") ?? Number.MAX_SAFE_INTEGER)
    );

  const nodeToComponentId = new Map<NodeId, number>();
  for (let componentId = 0; componentId < normalizedComponents.length; componentId += 1) {
    const component = normalizedComponents[componentId];
    if (!component) {
      continue;
    }
    for (const nodeId of component) {
      nodeToComponentId.set(nodeId, componentId);
    }
  }

  return {
    components: normalizedComponents,
    nodeToComponentId,
  };
}
