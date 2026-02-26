import { describe, expect, it } from "vitest";
import {
  Graph,
  GraphNodeType,
  ReachabilitySubgraphKind,
  PartitionStrategy,
} from "../src/index.js";

// Partition tests validate deterministic workflow-subtree chunking behavior.
describe("Graph partition (workflow subtree chunking)", () => {
  it("keeps SCCs atomic while chunking by size", () => {
    const graph = buildSampleGraph();
    const result = graph.partitionGraph({ chunkSize: 3 });

    expect(result.strategy).toBe(PartitionStrategy.WORKFLOW_SUBTREES);
    expect(result.metadata.sccCount).toBeGreaterThanOrEqual(1);
    expect(result.chunks.length).toBeGreaterThan(0);

    const chunkWithA = result.chunks.find((chunk) => chunk.nodes.some((node) => node.id === "A"));
    expect(chunkWithA?.nodes.some((node) => node.id === "B")).toBe(true);

    const hasOversizedChunk = result.chunks.some((chunk) => chunk.nodes.length > 3);
    expect(hasOversizedChunk).toBe(false);
  });

  it("captures boundary edges for cross-chunk links", () => {
    const graph = buildSampleGraph();
    const result = graph.partitionGraph({ chunkSize: 3 });

    const boundarySet = new Set(result.boundaryEdges.map((edge) => `${edge.from}->${edge.to}`));
    expect(boundarySet.has("C->D")).toBe(true);
    expect(boundarySet.has("C->E")).toBe(true);
  });

  it("is deterministic for repeated calls on same graph", () => {
    const graph = buildSampleGraph();
    const first = graph.partitionGraph({ chunkSize: 3 });
    const second = graph.partitionGraph({ chunkSize: 3 });

    expect(serializePartition(first)).toEqual(serializePartition(second));
  });

  it("forms transitive chunks as parent + direct transition children", () => {
    const graph = new Graph<{ label: string }>();
    graph.addNode("S", { label: "start" });
    graph.addNode("A", { label: "linear_pre_route" }, GraphNodeType.LINEAR_NODE);
    graph.addNode("T1", { label: "route_1" }, GraphNodeType.TRANSITIVE_PARENT);
    graph.addNode("B1", { label: "branch_1" }, GraphNodeType.TRANSITION_BRANCH);
    graph.addNode("B2", { label: "branch_2" }, GraphNodeType.TRANSITION_BRANCH);
    graph.addNode("L1", { label: "linear_after_branch" }, GraphNodeType.LINEAR_NODE);
    graph.addNode("L2", { label: "linear_bridge" }, GraphNodeType.LINEAR_NODE);
    graph.addNode("T2", { label: "route_2" }, GraphNodeType.TRANSITIVE_PARENT);
    graph.addNode("C1", { label: "child_1" }, GraphNodeType.TRANSITION_BRANCH);
    graph.addNode("C2", { label: "child_2" }, GraphNodeType.TRANSITION_BRANCH);

    graph.addEdge("S", "A");
    graph.addEdge("A", "T1");
    graph.addEdge("T1", "B1");
    graph.addEdge("T1", "B2");
    graph.addEdge("B1", "L1");
    graph.addEdge("L1", "L2");
    graph.addEdge("L2", "T2");
    graph.addEdge("T2", "C1");
    graph.addEdge("T2", "C2");

    const result = graph.partitionGraph({ chunkSize: 3 });
    const chunkWithT1 = result.chunks.find((chunk) =>
      chunk.nodes.some((node) => node.id === "T1")
    );

    expect(chunkWithT1?.nodes.map((node) => node.id).sort()).toEqual(["B1", "B2", "T1"]);
    expect(chunkWithT1?.kind).toBe(ReachabilitySubgraphKind.TRANSITIVE);
    expect(chunkWithT1?.nodes.some((node) => node.id === "T2")).toBe(false);
  });

  it("falls back to singleton chunks only when unavoidable", () => {
    const graph = new Graph<{ label: string }>();
    graph.addNode("A", { label: "a" });
    graph.addNode("B", { label: "b" });
    graph.addNode("C", { label: "c" });
    graph.addEdge("A", "B");
    graph.addEdge("B", "C");

    const result = graph.partitionGraph({ chunkSize: 2 });
    const chunkSizes = result.chunks.map((chunk) => chunk.nodes.length);
    expect(chunkSizes).toContain(1);
    expect(chunkSizes.filter((size) => size === 1)).toHaveLength(1);
  });
});

function buildSampleGraph(): Graph<{ label: string }> {
  const graph = new Graph<{ label: string }>();
  graph.addNode("A", { label: "a" });
  graph.addNode("B", { label: "b" }, GraphNodeType.GOTO_NODE);
  graph.addNode("C", { label: "c" }, GraphNodeType.GOTO_NODE);
  graph.addNode("D", { label: "d" });
  graph.addNode("E", { label: "e" });
  graph.addNode("F", { label: "f" });

  graph.addEdge("A", "B");
  graph.addEdge("B", "A");
  graph.addEdge("B", "C");
  graph.addEdge("C", "D");
  graph.addEdge("C", "E");
  graph.addEdge("E", "F");
  return graph;
}

// Serializer strips object identity to compare partition structure only.
function serializePartition(
  partition: ReturnType<Graph["partitionGraph"]>,
): {
  chunks: Array<{ chunkId: string; kind: ReachabilitySubgraphKind; nodes: string[]; edges: string[] }>;
  boundaryEdges: string[];
} {
  return {
    chunks: partition.chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      kind: chunk.kind,
      nodes: chunk.nodes.map((node) => node.id),
      edges: chunk.intraChunkEdges.map((edge) => `${edge.from}->${edge.to}`),
    })),
    boundaryEdges: partition.boundaryEdges.map((edge) => `${edge.from}->${edge.to}`),
  };
}
