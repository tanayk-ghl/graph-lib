import { Graph } from "../index.js";

/** Stable sorted node list helper used by output/comparison code paths. */
export function collectNodeIds<TAttributes>(graph: Graph<TAttributes>): string[] {
  return graph.getNodes().map((node) => node.id).sort();
}

/** Stable sorted edge list helper (`from->to`) for deterministic diffs. */
export function collectEdges<TAttributes>(graph: Graph<TAttributes>): string[] {
  const edges: string[] = [];
  const sortedNodeIds = collectNodeIds(graph);
  for (const from of sortedNodeIds) {
    for (const to of graph.getOutgoing(from).sort()) {
      edges.push(`${from}->${to}`);
    }
  }
  return edges.sort();
}
