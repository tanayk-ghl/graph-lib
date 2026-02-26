# Optimization Notes

## Data-Structure Choices
- Node registry uses `Map<NodeId, NodeRecord>` for O(1) node lookup.
- Adjacency uses two indexes:
  - `outgoing: Map<NodeId, Set<NodeId>>`
  - `incoming: Map<NodeId, Set<NodeId>>`

This keeps edge insert/remove and neighbor queries near O(1) average per operation.

## Mutation Efficiency
- `addEdge` and `removeEdge` update both indexes symmetrically.
- `removeNode` detaches all incident edges in one pass over incoming + outgoing sets.
- Optional `removeNode(..., { reconnect: true })` reconnects parent->child pairs directly, avoiding full-graph rebuilds.

## Deterministic Traversal
- Child order follows insertion order of `Set`.
- Terminal-node APIs rely on deterministic DFS ordering to remain reproducible in tests and production.

## Validation Strategy
- Structural validation uses snapshot maps and mirror checks (`outgoing` <-> `incoming`).
- Cycle checks are warning-only in v1 to support general directed graphs.

## Further Opportunities
- Add optional frozen snapshots to reduce copy allocations for read-heavy workloads.
- Add configurable operation batch mode to amortize telemetry overhead.
- Add benchmark suite for large sparse vs dense graph scenarios.

## Partition + Stitch Performance Notes
- SCC detection and condensation run once per partition operation and preserve deterministic ordering.
- Boundary edges are emitted only for cross-chunk links, keeping stitch input compact.
- Stitch rebuild is linear in emitted nodes and edges (`O(|V| + |E|)` over partition payload).
- For very large graphs, chunk size 4 generally reduces chunk-count overhead compared to 3 while preserving SCC atomicity constraints.
