import { computeStronglyConnectedComponents } from "./scc.js";
import type {
  BoundaryEdge,
  GraphNode,
  GraphReadStore,
  NodeId,
  PartitionChunk,
  PartitionOptions,
  PartitionResult,
} from "../types.js";
import {
  GraphNodeType,
  PartitionStrategy,
  ReachabilitySubgraphKind,
} from "../types.js";

/**
 * Partitions a directed graph into workflow-centric atomic units:
 * - transitive units: TRANSITIVE_PARENT + direct TRANSITION_BRANCH children
 * - linear units: contiguous one-in/one-out style chains
 *
 * Units are then packed into chunk-size budgets while preserving deterministic
 * traversal order and exact stitchability via boundary edges.
 */
export function partitionGraph<TAttributes>(
  store: GraphReadStore<TAttributes>,
  options: PartitionOptions,
): PartitionResult<TAttributes> {
  validatePartitionInput(store, options);

  const nodeIds = store.getNodeIds();
  const sccCount = computeStronglyConnectedComponents(store).components.length;
  const orderedNodeIds = orderNodesByRoots(store, options.rootIds);
  const units = buildAtomicUnits(store, orderedNodeIds, options.chunkSize);
  const chunkedUnits = packUnitsBySize(units, options.chunkSize);

  const nodeToChunk = new Map<NodeId, string>();
  const chunks: PartitionChunk<TAttributes>[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkedUnits.length; chunkIndex += 1) {
    const groupedUnits = chunkedUnits[chunkIndex];
    if (!groupedUnits) {
      continue;
    }
    const chunk = buildChunkFromUnits(
      store,
      groupedUnits,
      chunkIndex,
      nodeToChunk,
    );
    chunks.push(chunk);
  }

  const boundaryEdges: BoundaryEdge[] = [];
  let edgeCount = 0;
  for (const fromNodeId of nodeIds) {
    for (const toNodeId of store.getOutgoing(fromNodeId)) {
      edgeCount += 1;
      const fromChunkId = nodeToChunk.get(fromNodeId);
      const toChunkId = nodeToChunk.get(toNodeId);
      if (!fromChunkId || !toChunkId) {
        throw new Error(`Could not resolve chunk ownership for edge "${fromNodeId}" -> "${toNodeId}".`);
      }
      if (fromChunkId !== toChunkId) {
        boundaryEdges.push({
          from: fromNodeId,
          to: toNodeId,
          fromChunkId,
          toChunkId,
        });
      }
    }
  }

  return {
    chunkSize: options.chunkSize,
    strategy: PartitionStrategy.WORKFLOW_SUBTREES,
    chunks,
    boundaryEdges,
    metadata: {
      sccCount,
      chunkCount: chunks.length,
      nodeCount: nodeIds.length,
      edgeCount,
    },
  };
}

function validatePartitionInput<TAttributes>(
  store: GraphReadStore<TAttributes>,
  options: PartitionOptions,
): void {
  if (options.chunkSize !== 2 && options.chunkSize !== 3) {
    throw new Error(`Unsupported chunk size "${options.chunkSize}". Expected 2 or 3.`);
  }
  for (const rootId of options.rootIds ?? []) {
    if (!store.hasNode(rootId)) {
      throw new Error(`Partition root "${rootId}" does not exist.`);
    }
  }
}

interface AtomicUnit {
  kind: ReachabilitySubgraphKind;
  nodeIds: NodeId[];
}

const MIN_CHUNK_SIZE = 2;

function orderNodesByRoots<TAttributes>(
  store: GraphReadStore<TAttributes>,
  rootIds: NodeId[] | undefined,
): NodeId[] {
  const insertionOrder = store.getNodeIds();
  if (!rootIds || rootIds.length === 0) {
    return insertionOrder;
  }

  const visited = new Set<NodeId>();
  const ordered: NodeId[] = [];
  const walk = (startId: NodeId): void => {
    if (!store.hasNode(startId)) {
      return;
    }
    const stack: NodeId[] = [startId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);
      ordered.push(current);
      const targets = store.getOutgoing(current);
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        const nextId = targets[index];
        if (nextId && !visited.has(nextId)) {
          stack.push(nextId);
        }
      }
    }
  };

  for (const rootId of rootIds) {
    walk(rootId);
  }

  for (const nodeId of insertionOrder) {
    if (!visited.has(nodeId)) {
      ordered.push(nodeId);
    }
  }
  return ordered;
}

/**
 * Builds workflow-aligned atomic units:
 * - TRANSITIVE_PARENT anchors a transitive unit with direct transition children.
 * - remaining nodes are grouped into maximal linear chains.
 */
function buildAtomicUnits<TAttributes>(
  store: GraphReadStore<TAttributes>,
  orderedNodeIds: NodeId[],
  chunkSize: 2 | 3,
): AtomicUnit[] {
  const assigned = new Set<NodeId>();
  const units: AtomicUnit[] = [];

  for (const nodeId of orderedNodeIds) {
    if (assigned.has(nodeId)) {
      continue;
    }
    const node = store.getNode(nodeId);
    if (!node) {
      throw new Error(`Node "${nodeId}" does not exist during partitioning.`);
    }

    if (
      node.type === GraphNodeType.TRANSITION_BRANCH
      && hasUnassignedTransitiveParent(store, nodeId, assigned)
    ) {
      continue;
    }

    if (node.type === GraphNodeType.TRANSITIVE_PARENT) {
      const unitNodeIds: NodeId[] = [nodeId];
      assigned.add(nodeId);
      for (const childId of store.getOutgoing(nodeId)) {
        if (unitNodeIds.length >= chunkSize) {
          break;
        }
        const child = store.getNode(childId);
        if (!child || assigned.has(childId)) {
          continue;
        }
        if (child.type === GraphNodeType.TRANSITION_BRANCH) {
          unitNodeIds.push(childId);
          assigned.add(childId);
        }
      }
      units.push({
        kind: ReachabilitySubgraphKind.TRANSITIVE,
        nodeIds: unitNodeIds,
      });
      continue;
    }

    const linearNodeIds = growLinearChain(store, nodeId, assigned, chunkSize);
    units.push({
      kind: ReachabilitySubgraphKind.LINEAR,
      nodeIds: linearNodeIds,
    });
  }

  // Safety sweep: every node must be chunk-owned even in unexpected graph states.
  for (const nodeId of orderedNodeIds) {
    if (!assigned.has(nodeId)) {
      assigned.add(nodeId);
      units.push({
        kind: ReachabilitySubgraphKind.LINEAR,
        nodeIds: [nodeId],
      });
    }
  }
  return units;
}

function hasUnassignedTransitiveParent<TAttributes>(
  store: GraphReadStore<TAttributes>,
  nodeId: NodeId,
  assigned: ReadonlySet<NodeId>,
): boolean {
  for (const parentId of store.getIncoming(nodeId)) {
    const parent = store.getNode(parentId);
    if (
      parent?.type === GraphNodeType.TRANSITIVE_PARENT
      && !assigned.has(parentId)
    ) {
      return true;
    }
  }
  return false;
}

function growLinearChain<TAttributes>(
  store: GraphReadStore<TAttributes>,
  startId: NodeId,
  assigned: Set<NodeId>,
  chunkSize: 2 | 3,
): NodeId[] {
  const chain: NodeId[] = [startId];
  assigned.add(startId);
  let currentId = startId;

  while (true) {
    if (chain.length >= chunkSize) {
      return chain;
    }
    const nextCandidates = store.getOutgoing(currentId).filter((targetId) => !assigned.has(targetId));
    if (nextCandidates.length !== 1) {
      return chain;
    }
    const nextId = nextCandidates[0];
    if (!nextId) {
      return chain;
    }
    const nextNode = store.getNode(nextId);
    if (!nextNode) {
      return chain;
    }

    // Linear units stop before branch roots or branch children.
    if (
      nextNode.type === GraphNodeType.TRANSITIVE_PARENT
      || nextNode.type === GraphNodeType.TRANSITION_BRANCH
    ) {
      return chain;
    }

    const nextIncoming = store.getIncoming(nextId);
    if (nextIncoming.length !== 1 || nextIncoming[0] !== currentId) {
      return chain;
    }

    chain.push(nextId);
    assigned.add(nextId);
    currentId = nextId;
  }
}

/** Packs atomic units into chunk-size budgets while preserving order. */
function packUnitsBySize(
  units: AtomicUnit[],
  chunkSize: 2 | 3,
): AtomicUnit[][] {
  if (units.length === 0) {
    return [];
  }

  const chunked: AtomicUnit[][] = [];
  let current: AtomicUnit[] = [];
  let currentNodeCount = 0;

  for (const unit of units) {
    const unitSize = unit.nodeIds.length;

    if (current.length === 0) {
      current.push(unit);
      currentNodeCount = unitSize;
      continue;
    }

    if (currentNodeCount + unitSize <= chunkSize) {
      current.push(unit);
      currentNodeCount += unitSize;
      continue;
    }

    chunked.push(current);
    current = [unit];
    currentNodeCount = unitSize;
  }

  if (current.length > 0) {
    chunked.push(current);
  }

  rebalanceForMinChunkSize(chunked, chunkSize);
  mergeSmallAdjacentChunksWhenPossible(chunked, chunkSize);
  dropEmptyChunks(chunked);
  return chunked;
}

function countChunkNodes(units: AtomicUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.nodeIds.length, 0);
}

function rebalanceForMinChunkSize(
  chunks: AtomicUnit[][],
  chunkSize: 2 | 3,
): void {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (!chunk || countChunkNodes(chunk) >= MIN_CHUNK_SIZE) {
      continue;
    }

    let fixed = false;
    for (let donorIndex = index - 1; donorIndex >= 0 && !fixed; donorIndex -= 1) {
      const donor = chunks[donorIndex];
      if (!donor) {
        continue;
      }
      for (let unitIndex = donor.length - 1; unitIndex >= 0; unitIndex -= 1) {
        const candidate = donor[unitIndex];
        if (!candidate) {
          continue;
        }
        const candidateSize = candidate.nodeIds.length;
        const donorAfter = countChunkNodes(donor) - candidateSize;
        const receiverAfter = countChunkNodes(chunk) + candidateSize;
        if (donorAfter <= 0 || receiverAfter > chunkSize) {
          continue;
        }
        donor.splice(unitIndex, 1);
        chunk.unshift(candidate);
        fixed = true;
        break;
      }
    }
  }
}

function mergeSmallAdjacentChunksWhenPossible(
  chunks: AtomicUnit[][],
  chunkSize: 2 | 3,
): void {
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk || countChunkNodes(chunk) >= MIN_CHUNK_SIZE) {
      continue;
    }

    const prev = index > 0 ? chunks[index - 1] : undefined;
    if (prev && countChunkNodes(prev) + countChunkNodes(chunk) <= chunkSize) {
      prev.push(...chunk);
      chunk.length = 0;
      continue;
    }

    const next = index + 1 < chunks.length ? chunks[index + 1] : undefined;
    if (next && countChunkNodes(next) + countChunkNodes(chunk) <= chunkSize) {
      next.unshift(...chunk);
      chunk.length = 0;
      continue;
    }
    // If we get here, a singleton chunk is unavoidable under max-size and unit constraints.
  }
}

function dropEmptyChunks(chunks: AtomicUnit[][]): void {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (chunk && chunk.length === 0) {
      chunks.splice(index, 1);
    }
  }
}

/** Materializes one chunk from packed atomic units. */
function buildChunkFromUnits<TAttributes>(
  store: GraphReadStore<TAttributes>,
  units: AtomicUnit[],
  chunkIndex: number,
  nodeToChunk: Map<NodeId, string>,
): PartitionChunk<TAttributes> {
  const chunkId = `chunk-${chunkIndex}`;
  const nodes: GraphNode<TAttributes>[] = [];
  const nodeSet = new Set<NodeId>();
  const chunkKind = units.some((unit) => unit.kind === ReachabilitySubgraphKind.TRANSITIVE)
    ? ReachabilitySubgraphKind.TRANSITIVE
    : ReachabilitySubgraphKind.LINEAR;

  for (const unit of units) {
    for (const nodeId of unit.nodeIds) {
      const node = store.getNode(nodeId);
      if (!node) {
        throw new Error(`Node "${nodeId}" was not found while creating chunk "${chunkId}".`);
      }
      nodes.push(node);
      nodeSet.add(node.id);
      nodeToChunk.set(node.id, chunkId);
    }
  }

  const intraChunkEdges: Array<{ from: NodeId; to: NodeId }> = [];
  for (const node of nodes) {
    for (const targetId of store.getOutgoing(node.id)) {
      if (!nodeSet.has(targetId)) {
        continue;
      }
      intraChunkEdges.push({ from: node.id, to: targetId });
    }
  }

  return {
    chunkId,
    kind: chunkKind,
    nodes,
    intraChunkEdges,
  };
}
