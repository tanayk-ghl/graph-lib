import { describe, expect, it } from "vitest";
import {
  Graph,
  GraphNodeType,
  ValidationIssueCode,
} from "../src/index.js";

// Validation tests cover both strict errors and optional warning diagnostics.
describe("Graph validation", () => {
  it("returns valid report for healthy graph", () => {
    const graph = new Graph();
    graph.addNode("A", {});
    graph.addNode("B", {});
    graph.addEdge("A", "B");

    const report = graph.validate();
    expect(report.isValid).toBe(true);
    expect(report.errorCount).toBe(0);
  });

  it("reports cycles as warning and preserves validity", () => {
    const graph = new Graph();
    graph.addNode("A", {});
    graph.addNode("B", {}, GraphNodeType.GOTO_NODE);
    graph.addEdge("A", "B");
    graph.addEdge("B", "A");

    const report = graph.validate();
    expect(report.isValid).toBe(true);
    expect(report.warningCount).toBeGreaterThanOrEqual(1);
    expect(
      report.issues.some((issue) => issue.code === ValidationIssueCode.CYCLE_DETECTED),
    ).toBe(true);
  });

  it("holds structural invariants under random mutation sequence", () => {
    const graph = new Graph<{ v: number }>();
    const rng = createSeededRng(1337);
    const allNodeIds = Array.from({ length: 40 }, (_, i) => `N${i}`);

    for (const nodeId of allNodeIds) {
      graph.addNode(nodeId, { v: 0 });
    }

    for (let step = 0; step < 500; step += 1) {
      const action = Math.floor(rng() * 6);
      const from = allNodeIds[Math.floor(rng() * allNodeIds.length)];
      const to = allNodeIds[Math.floor(rng() * allNodeIds.length)];

      if (!from || !to) {
        continue;
      }

      if (action === 0 || action === 1) {
        try {
          graph.addEdge(from, to);
        } catch {
          // Some random edges are intentionally rejected by node-type constraints.
        }
      } else if (action === 2) {
        graph.removeEdge(from, to);
      } else if (action === 3) {
        const target = allNodeIds[Math.floor(rng() * allNodeIds.length)];
        if (target && graph.hasNode(target)) {
          graph.updateNodeAttributes(target, (current) => ({ v: current.v + 1 }));
        }
      } else if (action === 4) {
        const root = allNodeIds[Math.floor(rng() * allNodeIds.length)];
        const parent = allNodeIds[Math.floor(rng() * allNodeIds.length)];
        if (
          root &&
          parent &&
          root !== parent &&
          graph.hasNode(root) &&
          graph.hasNode(parent)
        ) {
          try {
            graph.moveSubtree(root, parent, {
              detachFromAllParents: rng() > 0.5,
            });
          } catch {
            // Some moves are rejected when they would create non-GOTO loops.
          }
        }
      } else {
        // Keep nodes present for invariants and stress edge operations.
        graph.getNodes();
      }

      const report = graph.validate();
      expect(report.isValid).toBe(true);
    }
  });
});

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
