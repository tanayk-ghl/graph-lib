import { collectReachableNodeIds } from "./subtree.js";
import type { GraphReadStore, NodeId } from "../types.js";

/** Returns terminal nodes (no induced outgoing edges) under the given root. */
export function getTerminalNodesFromRoot<TAttributes>(
  store: GraphReadStore<TAttributes>,
  rootId: NodeId,
): NodeId[] {
  const reachable = collectReachableNodeIds(store, rootId);
  const reachableSet = new Set(reachable);
  const terminals: NodeId[] = [];

  for (const nodeId of reachable) {
    const inducedChildren = store.getOutgoing(nodeId)
      .filter((target) => reachableSet.has(target));
    if (inducedChildren.length === 0) {
      terminals.push(nodeId);
    }
  }

  return terminals;
}

/** Returns the first terminal by deterministic traversal order. */
export function getLeftmostTerminalNode<TAttributes>(
  store: GraphReadStore<TAttributes>,
  rootId: NodeId,
): NodeId | undefined {
  const terminals = getTerminalNodesFromRoot(store, rootId);
  return terminals[0];
}

/** Returns the last terminal by deterministic traversal order. */
export function getRightmostTerminalNode<TAttributes>(
  store: GraphReadStore<TAttributes>,
  rootId: NodeId,
): NodeId | undefined {
  const terminals = getTerminalNodesFromRoot(store, rootId);
  return terminals.length > 0 ? terminals[terminals.length - 1] : undefined;
}

/** Random-access helper for terminal node retrieval. */
export function getTerminalNodeByIndex<TAttributes>(
  store: GraphReadStore<TAttributes>,
  rootId: NodeId,
  index: number,
): NodeId | undefined {
  if (index < 0) {
    return undefined;
  }
  const terminals = getTerminalNodesFromRoot(store, rootId);
  return terminals[index];
}
