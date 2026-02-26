# Graph Library Usage Guide

This guide explains how to use the graph library in day-to-day code, what behavior to expect, and how partition/stitch works.

## What this library models
- Directed, unweighted graphs.
- Node shape: `{ id: string, attributes: TAttributes }`.
- Cycles are valid and supported.
- Deterministic traversal/order behavior is preserved where possible.

## Quickstart
```ts
import { Graph } from "graph-lib";

type NodeAttributes = { label: string; score: number };
const graph = new Graph<NodeAttributes>();

graph.addNode("A", { label: "alpha", score: 1 });
graph.addNode("B", { label: "beta", score: 2 });
graph.addEdge("A", "B");
```

## Mental model
- Think of `Graph` as the high-level API surface.
- Nodes are stored by ID.
- Edges are directed (`from -> to`).
- Most write operations fail fast when node IDs are invalid.
- Validation is explicit (`validate()`), not automatic on every call.

## Common operation flows

### 1) Build and evolve a graph
- Use `addNode(id, attributes)` to create nodes.
- Use `addEdge(from, to)` to connect nodes.
- Use `updateNodeAttributes(id, next)` to replace or derive attributes.
- Use `removeEdge(from, to)` to disconnect specific relationships.
- Use `removeNode(id, { reconnect? })` to delete nodes:
  - default: detach incident edges
  - reconnect mode: connect each old parent to each old child

### 2) Re-parent a region
- Use `moveSubtree(rootId, newParentId, options?)` to attach a node to a new parent.
- `detachFromAllParents: true` removes all existing incoming parent edges first.
- `fromParentId` detaches only one specific parent edge.
- Returns `{ rootId, attachedToParentId, detachedParentIds }`.

### 3) Analyze shape and endpoints
- `classifyReachabilitySubgraph(rootId)` returns:
  - `linear`: no branching in reachable induced subgraph
  - `transitive`: branching exists
- `getTerminalNodes(rootId)` returns deterministic terminal nodes.
- `getLeftmostTerminal`, `getRightmostTerminal`, and `getTerminalByIndex` are convenience accessors over the same deterministic order.

## Partition and merge (stitch)

### When to use this
Use partition/stitch when you need to split a graph into stable chunks, process chunks independently, then merge back to a valid equivalent graph.

### Partition behavior
- Call `partitionGraph({ chunkSize: 3 | 4, rootIds? })`.
- Strategy used: SCC-condense then chunk.
- SCCs are atomic (never split across chunks).
- Result includes:
  - ordered `chunks`,
  - `boundaryEdges` (cross-chunk edges),
  - `metadata` (`sccCount`, `chunkCount`, `nodeCount`, `edgeCount`).
- Chunk shape:
  - `chunkId`
  - `kind` (`linear` | `transitive`)
  - `nodes`
  - `intraChunkEdges`

### Merge behavior
- Call `Graph.stitchGraph({ chunks, boundaryEdges, order? })`.
- This is the library merge operation.
- Stitch rebuilds:
  - all nodes with original attributes,
  - all intra-chunk edges,
  - all boundary edges.
- Returns `{ graph, validation, edgeCount }`.

### Round-trip example
```ts
const partition = graph.partitionGraph({ chunkSize: 3 });

const merged = Graph.stitchGraph({
  chunks: partition.chunks,
  boundaryEdges: partition.boundaryEdges,
  order: partition.chunks.map((chunk) => chunk.chunkId),
});

console.log(merged.validation.isValid);
```

## Return-value and error semantics
- `addEdge` returns `true` if inserted, `false` if already present.
- `removeEdge` returns `true` if removed, `false` if absent.
- Operations that reference missing nodes throw errors.
- Stitch throws on invalid `order` (unknown or duplicate chunk IDs).
- Stitch throws if chunk content is structurally inconsistent (such as duplicated node IDs across chunks).

## Validation and integrity
- `validate()` returns:
  - `isValid`
  - `issues`
  - `errorCount`
  - `warningCount`
- Referential integrity issues are errors.
- Cycle detection is surfaced as a warning in v1.

## Telemetry hooks
Pass telemetry through `new Graph({ telemetry })`:
- `onOperationStart`
- `onOperationSuccess`
- `onOperationFailure`

Telemetry is optional and no-op by default.

## Notes
- If an SCC exceeds `chunkSize`, that chunk can exceed the target size.
- Providing `order` to stitch gives deterministic chunk processing order.

## Driver pipeline (`src/run.ts`)
- The repository includes a main driver at `src/run.ts` that:
  - builds multiple complex scenarios,
  - runs validate -> partition -> stitch -> validate,
  - prints analysis summaries to console,
  - emits Mermaid files for original/partition/stitched views.
- Run it with:
  - `npm run build`
  - `node dist/run.js`
- Mermaid output is written under:
  - `docs/generated/run-driver/`
