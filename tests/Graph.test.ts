import { describe, expect, it } from "vitest";
import { Graph, GraphNodeType } from "../src/index.js";

// Core mutation tests focus on behavioral guarantees of the public Graph facade.
describe("Graph core mutations", () => {
  it("adds and updates node attributes", () => {
    const graph = new Graph<{ name: string; visits: number }>();
    graph.addNode("A", { name: "alpha", visits: 0 });

    const updated = graph.updateNodeAttributes("A", (current) => ({
      ...current,
      visits: current.visits + 1,
    }));

    expect(updated.attributes.visits).toBe(1);
    expect(graph.getNode("A")?.attributes.name).toBe("alpha");
  });

  it("removes node and reconnects parents to children", () => {
    const graph = new Graph();
    graph.addNode("A", {});
    graph.addNode("B", {});
    graph.addNode("C", {});
    graph.addEdge("A", "B");
    graph.addEdge("B", "C");

    graph.removeNode("B", { reconnect: true });

    expect(graph.hasNode("B")).toBe(false);
    expect(graph.hasEdge("A", "C")).toBe(true);
  });

  it("moves subtree by detaching all current parents", () => {
    const graph = new Graph();
    graph.addNode("P1", {});
    graph.addNode("P2", {});
    graph.addNode("R", {}, GraphNodeType.GOTO_NODE);
    graph.addNode("N", {});

    graph.addEdge("P1", "R");
    graph.addEdge("P2", "R");

    const moved = graph.moveSubtree("R", "N", { detachFromAllParents: true });
    expect(moved.detachedParentIds.sort()).toEqual(["P1", "P2"]);
    expect(graph.hasEdge("N", "R")).toBe(true);
    expect(graph.hasEdge("P1", "R")).toBe(false);
    expect(graph.hasEdge("P2", "R")).toBe(false);
  });
});
