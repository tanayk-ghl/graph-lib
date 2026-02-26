import { describe, expect, it } from "vitest";
import { Graph, GraphNodeType } from "../src/index.js";

// Stitch tests ensure partition output is sufficient for lossless reconstruction.
describe("Graph stitch", () => {
  it("round-trips partition -> stitch with exact topology", () => {
    const original = buildGraphForRoundTrip();
    const partition = original.partitionGraph({ chunkSize: 3 });
    const stitched = Graph.stitchGraph({
      chunks: partition.chunks,
      boundaryEdges: partition.boundaryEdges,
      order: partition.chunks.map((chunk) => chunk.chunkId),
    });

    expect(stitched.validation.isValid).toBe(true);
    expect(collectNodeIds(stitched.graph)).toEqual(collectNodeIds(original));
    expect(collectEdges(stitched.graph)).toEqual(collectEdges(original));
  });

  it("stitches disconnected graphs and preserves all components", () => {
    const graph = new Graph<{ value: number }>();
    graph.addNode("A", { value: "A".charCodeAt(0) });
    graph.addNode("B", { value: "B".charCodeAt(0) });
    graph.addNode("C", { value: "C".charCodeAt(0) });
    graph.addNode("D", { value: "D".charCodeAt(0) });
    graph.addNode("E", { value: "E".charCodeAt(0) }, GraphNodeType.GOTO_NODE);
    graph.addNode("F", { value: "F".charCodeAt(0) });
    graph.addNode("G", { value: "G".charCodeAt(0) });

    graph.addEdge("A", "B");
    graph.addEdge("B", "C");
    graph.addEdge("D", "E");
    graph.addEdge("E", "D");
    graph.addEdge("F", "G");

    const partition = graph.partitionGraph({ chunkSize: 3 });
    const stitched = Graph.stitchGraph({
      chunks: partition.chunks,
      boundaryEdges: partition.boundaryEdges,
    });

    expect(stitched.validation.isValid).toBe(true);
    expect(collectNodeIds(stitched.graph)).toEqual(collectNodeIds(graph));
    expect(collectEdges(stitched.graph)).toEqual(collectEdges(graph));
  });

  it("rejects invalid stitch order", () => {
    const graph = buildGraphForRoundTrip();
    const partition = graph.partitionGraph({ chunkSize: 3 });

    expect(() =>
      Graph.stitchGraph({
        chunks: partition.chunks,
        boundaryEdges: partition.boundaryEdges,
        order: ["does-not-exist"],
      })
    ).toThrowError();
  });
});

function buildGraphForRoundTrip(): Graph<{ label: string }> {
  const graph = new Graph<{ label: string }>();
  graph.addNode("A", { label: "a" });
  graph.addNode("B", { label: "b" }, GraphNodeType.GOTO_NODE);
  graph.addNode("C", { label: "c" }, GraphNodeType.GOTO_NODE);
  graph.addNode("D", { label: "d" });
  graph.addNode("E", { label: "e" });
  graph.addNode("F", { label: "f" });
  graph.addNode("G", { label: "g" });

  graph.addEdge("A", "B");
  graph.addEdge("B", "A");
  graph.addEdge("B", "C");
  graph.addEdge("C", "D");
  graph.addEdge("C", "E");
  graph.addEdge("E", "F");
  graph.addEdge("G", "C");

  return graph;
}

// Deterministic node projection for topology comparison assertions.
function collectNodeIds(graph: Graph<unknown>): string[] {
  return graph.getNodes().map((node) => node.id).sort();
}

// Deterministic edge projection for topology comparison assertions.
function collectEdges(graph: Graph<unknown>): string[] {
  const edges: string[] = [];
  for (const node of graph.getNodes()) {
    for (const target of graph.getOutgoing(node.id)) {
      edges.push(`${node.id}->${target}`);
    }
  }
  return edges.sort();
}
