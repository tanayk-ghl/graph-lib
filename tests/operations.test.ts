import { describe, expect, it } from "vitest";
import {
  Graph,
  GraphNodeType,
  PartitionStrategy,
} from "../src/index.js";

// This suite serves as broad regression coverage for end-user graph operations.
describe("Graph operations - comprehensive coverage", () => {
  describe("add / modify", () => {
    it("adds nodes and edges, and prevents duplicate node IDs", () => {
      const graph = new Graph<{ label: string; version: number }>();
      graph.addNode("A", { label: "alpha", version: 1 });
      graph.addNode("B", { label: "beta", version: 1 });
      expect(graph.addEdge("A", "B")).toBe(true);
      expect(graph.addEdge("A", "B")).toBe(false);
      expect(graph.hasEdge("A", "B")).toBe(true);

      expect(() =>
        graph.addNode("A", { label: "duplicate", version: 2 })
      ).toThrowError(/already exists/i);
    });

    it("updates attributes using both direct assignment and updater functions", () => {
      const graph = new Graph<{ count: number; tags: string[] }>();
      graph.addNode("A", { count: 0, tags: [] });

      graph.updateNodeAttributes("A", { count: 1, tags: ["seed"] });
      graph.updateNodeAttributes("A", (current) => ({
        count: current.count + 4,
        tags: [...current.tags, "next"],
      }));

      expect(graph.getNode("A")?.attributes).toEqual({
        count: 5,
        tags: ["seed", "next"],
      });
    });

    it("throws for updates on non-existent nodes", () => {
      const graph = new Graph<{ count: number }>();
      expect(() => graph.updateNodeAttributes("missing", { count: 1 })).toThrowError(
        /does not exist/i
      );
    });
  });

  describe("remove / delete", () => {
    it("removes edge and returns false when edge is absent", () => {
      const graph = createChainGraph();
      expect(graph.removeEdge("A", "B")).toBe(true);
      expect(graph.removeEdge("A", "B")).toBe(false);
      expect(graph.hasEdge("A", "B")).toBe(false);
    });

    it("deletes a node and detaches incident edges when reconnect is false", () => {
      const graph = new Graph();
      graph.addNode("A", {});
      graph.addNode("B", {}, GraphNodeType.GOTO_NODE);
      graph.addNode("C", {});
      graph.addNode("D", {});
      graph.addEdge("A", "B");
      graph.addEdge("B", "C");
      graph.addEdge("D", "B");

      const removed = graph.removeNode("B", { reconnect: false });
      expect(removed.id).toBe("B");
      expect(graph.hasNode("B")).toBe(false);
      expect(graph.hasEdge("A", "C")).toBe(false);
      expect(graph.getIncoming("C")).toEqual([]);
    });

    it("deletes a node and reconnects all parents to all children when requested", () => {
      const graph = new Graph();
      graph.addNode("S", {});
      graph.addNode("P1", {}, GraphNodeType.GOTO_NODE);
      graph.addNode("X", {}, GraphNodeType.GOTO_NODE);
      graph.addNode("C1", {}, GraphNodeType.TRANSITIVE_PARENT);
      graph.addNode("C2", {}, GraphNodeType.TRANSITIVE_PARENT);
      graph.addEdge("S", "P1");
      graph.addEdge("P1", "X");
      graph.addEdge("X", "C1");
      graph.addEdge("X", "C2");

      graph.removeNode("X", { reconnect: true });

      expect(graph.hasNode("X")).toBe(false);
      expect(graph.hasEdge("P1", "C1")).toBe(true);
      expect(graph.hasEdge("P1", "C2")).toBe(true);
    });
  });

  describe("move", () => {
    it("moves subtree by removing only selected parent when fromParentId is set", () => {
      const graph = new Graph();
      for (const id of ["P1", "P2", "Root", "NewParent"]) {
        graph.addNode(
          id,
          {},
          id === "Root" ? GraphNodeType.GOTO_NODE : GraphNodeType.LINEAR_NODE,
        );
      }
      graph.addEdge("P1", "Root");
      graph.addEdge("P2", "Root");

      const moved = graph.moveSubtree("Root", "NewParent", { fromParentId: "P1" });
      expect(moved.detachedParentIds).toEqual(["P1"]);
      expect(graph.hasEdge("P1", "Root")).toBe(false);
      expect(graph.hasEdge("P2", "Root")).toBe(true);
      expect(graph.hasEdge("NewParent", "Root")).toBe(true);
    });

    it("rejects self-parent moves", () => {
      const graph = new Graph();
      graph.addNode("A", {});
      expect(() => graph.moveSubtree("A", "A")).toThrowError(/same node/i);
    });
  });

  describe("partition", () => {
    it("partitions graph into deterministic chunks with consistent ownership", () => {
      const graph = buildPartitionGraph();
      const result = graph.partitionGraph({ chunkSize: 3, rootIds: ["A"] });

      expect(result.chunkSize).toBe(3);
      expect(result.strategy).toBe(PartitionStrategy.WORKFLOW_SUBTREES);
      expect(result.metadata.nodeCount).toBe(graph.getNodes().length);
      expect(result.metadata.edgeCount).toBe(collectEdges(graph).length);

      const chunkIds = result.chunks.map((chunk) => chunk.chunkId);
      expect(new Set(chunkIds).size).toBe(result.chunks.length);

      const nodeIds = result.chunks.flatMap((chunk) => chunk.nodes.map((node) => node.id));
      expect(new Set(nodeIds).size).toBe(graph.getNodes().length);
    });

    it("rejects unknown root IDs", () => {
      const graph = buildPartitionGraph();
      expect(() =>
        graph.partitionGraph({ chunkSize: 3, rootIds: ["missing"] })
      ).toThrowError(/does not exist/i);
    });
  });

  describe("merge (stitch)", () => {
    it("stitches partition output back to an equivalent graph with attributes preserved", () => {
      const original = buildPartitionGraph();
      const partition = original.partitionGraph({ chunkSize: 3 });

      const stitched = Graph.stitchGraph({
        chunks: partition.chunks,
        boundaryEdges: partition.boundaryEdges,
        order: partition.chunks.map((chunk) => chunk.chunkId),
      });

      expect(stitched.validation.isValid).toBe(true);
      expect(collectEdges(stitched.graph)).toEqual(collectEdges(original));
      expect(collectNodeAttributes(stitched.graph)).toEqual(collectNodeAttributes(original));
    });

    it("rejects stitch input when node IDs are duplicated across chunks", () => {
      const graph = buildPartitionGraph();
      const partition = graph.partitionGraph({ chunkSize: 3 });
      const firstChunk = partition.chunks[0];
      const secondChunk = partition.chunks[1];
      if (!firstChunk || !secondChunk || secondChunk.nodes.length === 0) {
        throw new Error("Expected partition test fixture to produce at least two chunks.");
      }

      const duplicatedChunks = [
        firstChunk,
        {
          ...secondChunk,
          nodes: [secondChunk.nodes[0], ...secondChunk.nodes],
        },
      ];

      expect(() =>
        Graph.stitchGraph({
          chunks: duplicatedChunks,
          boundaryEdges: [],
        })
      ).toThrowError(/appears in multiple chunks/i);
    });
  });

  describe("specialized node types", () => {
    it("marks first inserted node as START_NODE and rejects adding another START_NODE", () => {
      const graph = new Graph();
      const first = graph.addNode("S", {});
      expect(first.type).toBe(GraphNodeType.START_NODE);

      graph.addNode("A", {});
      expect(() => graph.addNode("S2", {}, GraphNodeType.START_NODE)).toThrowError(
        /already contains a START_NODE/i
      );
    });

    it("enforces TRANSITION_BRANCH to be child of TRANSITIVE_PARENT", () => {
      const graph = new Graph();
      graph.addNode("S", {});
      graph.addNode("T", {}, GraphNodeType.TRANSITIVE_PARENT);
      graph.addNode("B", {}, GraphNodeType.TRANSITION_BRANCH);
      graph.addNode("C", {}, GraphNodeType.TRANSITION_BRANCH);
      graph.addNode("L", {}, GraphNodeType.LINEAR_NODE);

      expect(graph.addEdge("T", "B")).toBe(true);
      expect(graph.addEdge("T", "C")).toBe(true);
      expect(() => graph.addEdge("L", "B")).toThrowError(
        /direct children of TRANSITIVE_PARENT/i
      );
    });

    it("enforces TRANSITIVE_PARENT to have at most one parent", () => {
      const graph = new Graph();
      graph.addNode("S", {});
      graph.addNode("A", {}, GraphNodeType.GOTO_NODE);
      graph.addNode("B", {}, GraphNodeType.GOTO_NODE);
      graph.addNode("T", {}, GraphNodeType.TRANSITIVE_PARENT);

      graph.addEdge("S", "A");
      graph.addEdge("A", "T");
      expect(() => graph.addEdge("B", "T")).toThrowError(
        /TRANSITIVE_PARENT can only have one parent/i
      );
    });
  });
});

function createChainGraph(): Graph {
  const graph = new Graph();
  for (const id of ["A", "B", "C"]) {
    graph.addNode(id, {});
  }
  graph.addEdge("A", "B");
  graph.addEdge("B", "C");
  return graph;
}

// Fixture intentionally mixes cycle-capable and linear nodes for partition/stitch tests.
function buildPartitionGraph(): Graph<{ label: string; score: number }> {
  const graph = new Graph<{ label: string; score: number }>();
  graph.addNode("A", { label: "a", score: 0 });
  graph.addNode("B", { label: "b", score: 1 }, GraphNodeType.GOTO_NODE);
  graph.addNode("C", { label: "c", score: 2 }, GraphNodeType.GOTO_NODE);
  graph.addNode("D", { label: "d", score: 3 });
  graph.addNode("E", { label: "e", score: 4 });
  graph.addNode("F", { label: "f", score: 5 }, GraphNodeType.GOTO_NODE);
  graph.addNode("G", { label: "g", score: 6 });
  graph.addNode("H", { label: "h", score: 7 });

  graph.addEdge("A", "B");
  graph.addEdge("B", "A");
  graph.addEdge("B", "C");
  graph.addEdge("C", "D");
  graph.addEdge("D", "E");
  graph.addEdge("C", "F");
  graph.addEdge("F", "G");
  graph.addEdge("H", "C");
  return graph;
}

// Stable edge projection keeps equality assertions deterministic.
function collectEdges(graph: Graph<unknown>): string[] {
  const edges: string[] = [];
  for (const node of graph.getNodes()) {
    for (const to of graph.getOutgoing(node.id)) {
      edges.push(`${node.id}->${to}`);
    }
  }
  return edges.sort();
}

// Attribute projection validates stitch keeps payload fidelity.
function collectNodeAttributes<TAttributes>(
  graph: Graph<TAttributes>,
): Array<{ id: string; attributes: TAttributes }> {
  return graph.getNodes()
    .map((node) => ({ id: node.id, attributes: node.attributes }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
