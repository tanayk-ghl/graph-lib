import type {
  GraphReadStore,
  NodeId,
  ReachabilitySubgraphClassification,
} from "../types.js";
import { ReachabilitySubgraphKind } from "../types.js";

/** Depth-first traversal (deterministic child order) from a root node. */
export function collectReachableNodeIds<TAttributes>(
  store: GraphReadStore<TAttributes>,
  rootId: NodeId,
): NodeId[] {
  if (!store.hasNode(rootId)) {
    throw new Error(`Node "${rootId}" does not exist.`);
  }

  const ordered: NodeId[] = [];
  const visited = new Set<NodeId>();
  const stack: NodeId[] = [rootId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    ordered.push(current);

    const children = store.getOutgoing(current);
    for (let idx = children.length - 1; idx >= 0; idx -= 1) {
      const childId = children[idx];
      if (childId && !visited.has(childId)) {
        stack.push(childId);
      }
    }
  }

  return ordered;
}

/**
 * Classifies a root-induced subgraph as linear vs transitive by checking whether
 * any reachable node branches to multiple reachable children.
 */
export function classifyReachabilitySubgraph<TAttributes>(
  store: GraphReadStore<TAttributes>,
  rootId: NodeId,
): ReachabilitySubgraphClassification {
  const reachable = collectReachableNodeIds(store, rootId);
  const reachableSet = new Set(reachable);

  let hasBranching = false;
  let terminalNodeCount = 0;

  for (const nodeId of reachable) {
    const inducedOutDegree = store.getOutgoing(nodeId)
      .filter((target) => reachableSet.has(target))
      .length;

    if (inducedOutDegree > 1) {
      hasBranching = true;
    }
    if (inducedOutDegree === 0) {
      terminalNodeCount += 1;
    }
  }

  return {
    kind: hasBranching
      ? ReachabilitySubgraphKind.TRANSITIVE
      : ReachabilitySubgraphKind.LINEAR,
    reachableNodeCount: reachable.length,
    terminalNodeCount,
  };
}
