import type {
  GraphEdge,
  GraphNode,
  NodeId,
  PartitionChunk,
  StitchInput,
} from "../types.js";

/** Internal stitched graph materialization before loading into Graph class. */
export interface StitchBuildResult<TAttributes = unknown> {
  orderedChunks: PartitionChunk<TAttributes>[];
  nodes: GraphNode<TAttributes>[];
  edges: GraphEdge[];
  boundaryEdgeCount: number;
}

/**
 * Reconstructs node/edge data from ordered chunks + boundary edges while
 * enforcing ownership, uniqueness, and referential integrity checks.
 */
export function buildStitchedGraphData<TAttributes>(
  input: StitchInput<TAttributes>,
): StitchBuildResult<TAttributes> {
  const chunkById = new Map<string, PartitionChunk<TAttributes>>();
  for (const chunk of input.chunks) {
    if (chunkById.has(chunk.chunkId)) {
      throw new Error(`Duplicate chunk id "${chunk.chunkId}" in stitch input.`);
    }
    chunkById.set(chunk.chunkId, chunk);
  }

  const orderedChunks = resolveChunkOrder(input, chunkById);
  const nodeIds = new Set<NodeId>();
  const nodes: GraphNode<TAttributes>[] = [];
  for (const chunk of orderedChunks) {
    for (const node of chunk.nodes) {
      if (nodeIds.has(node.id)) {
        throw new Error(`Node "${node.id}" appears in multiple chunks.`);
      }
      nodeIds.add(node.id);
      nodes.push({ ...node });
    }
  }

  // De-duplicate edges across chunk-local and boundary streams.
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  const pushUniqueEdge = (from: NodeId, to: NodeId): void => {
    if (!nodeIds.has(from) || !nodeIds.has(to)) {
      throw new Error(`Edge "${from}" -> "${to}" references unknown node(s).`);
    }
    const key = `${from}\u0000${to}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ from, to });
    }
  };

  for (const chunk of orderedChunks) {
    for (const edge of chunk.intraChunkEdges) {
      pushUniqueEdge(edge.from, edge.to);
    }
  }

  for (const edge of input.boundaryEdges) {
    if (!chunkById.has(edge.fromChunkId) || !chunkById.has(edge.toChunkId)) {
      throw new Error(
        `Boundary edge "${edge.from}" -> "${edge.to}" references unknown chunk ids.`,
      );
    }
    pushUniqueEdge(edge.from, edge.to);
  }

  return {
    orderedChunks,
    nodes,
    edges,
    boundaryEdgeCount: input.boundaryEdges.length,
  };
}

function resolveChunkOrder<TAttributes>(
  input: StitchInput<TAttributes>,
  chunkById: ReadonlyMap<string, PartitionChunk<TAttributes>>,
): PartitionChunk<TAttributes>[] {
  if (!input.order) {
    return [...input.chunks];
  }

  if (input.order.length !== input.chunks.length) {
    throw new Error("Stitch order length must match chunk count.");
  }

  const seen = new Set<string>();
  const orderedChunks: PartitionChunk<TAttributes>[] = [];
  for (const chunkId of input.order) {
    if (seen.has(chunkId)) {
      throw new Error(`Chunk "${chunkId}" appears multiple times in stitch order.`);
    }
    seen.add(chunkId);
    const chunk = chunkById.get(chunkId);
    if (!chunk) {
      throw new Error(`Chunk "${chunkId}" from stitch order does not exist.`);
    }
    orderedChunks.push(chunk);
  }

  return orderedChunks;
}
