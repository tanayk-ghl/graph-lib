import { describe, expect, it } from "vitest";
import {
  Graph,
  GraphNodeType,
  ReachabilitySubgraphKind,
} from "../src/index.js";

// Terminal APIs rely on deterministic traversal order for stable UX.
describe("Terminal node APIs", () => {
  it("returns deterministic terminal order and indexed lookup", () => {
    const graph = new Graph();
    graph.addNode("S", {});
    graph.addNode("A", {}, GraphNodeType.GOTO_NODE);
    graph.addNode("B", {});
    graph.addNode("C", {});
    graph.addNode("D", {});
    graph.addNode("E", {});

    graph.addEdge("S", "A");
    graph.addEdge("A", "B");
    graph.addEdge("A", "C");
    graph.addEdge("B", "D");
    graph.addEdge("C", "E");

    const terminals = graph.getTerminalNodes("A");
    expect(terminals).toEqual(["D", "E"]);
    expect(graph.getLeftmostTerminal("A")).toBe("D");
    expect(graph.getRightmostTerminal("A")).toBe("E");
    expect(graph.getTerminalByIndex("A", 1)).toBe("E");
    expect(graph.getTerminalByIndex("A", 2)).toBeUndefined();
  });

  it("classifies linear and transitive reachability subgraphs", () => {
    const graph = new Graph();
    graph.addNode("S", {});
    graph.addNode("A", {}, GraphNodeType.GOTO_NODE);
    graph.addNode("B", {});
    graph.addNode("C", {});
    graph.addNode("D", {});

    graph.addEdge("S", "A");
    graph.addEdge("A", "B");
    graph.addEdge("B", "C");
    expect(graph.classifyReachabilitySubgraph("A").kind).toBe(
      ReachabilitySubgraphKind.LINEAR,
    );

    graph.addEdge("A", "D");
    expect(graph.classifyReachabilitySubgraph("A").kind).toBe(
      ReachabilitySubgraphKind.TRANSITIVE,
    );
  });

  it("returns no terminal nodes for closed cycle region", () => {
    const graph = new Graph();
    graph.addNode("A", {});
    graph.addNode("B", {});
    graph.addNode("C", {}, GraphNodeType.GOTO_NODE);
    graph.addEdge("A", "B");
    graph.addEdge("B", "C");
    graph.addEdge("C", "A");

    expect(graph.getTerminalNodes("A")).toEqual([]);
    expect(graph.getLeftmostTerminal("A")).toBeUndefined();
  });
});
