import type {
  GraphNode,
  GraphNodeType,
  GraphReadStore,
  GraphStoreSnapshot,
  NodeAttributeUpdater,
  NodeId,
} from "../types.js";
import { GraphNodeType as GraphNodeKinds } from "../types.js";

export class GraphStore<TAttributes = unknown>
  implements GraphReadStore<TAttributes>
{
  private readonly nodes = new Map<NodeId, GraphNode<TAttributes>>();
  private readonly outgoing = new Map<NodeId, Set<NodeId>>();
  private readonly incoming = new Map<NodeId, Set<NodeId>>();

  hasNode(id: NodeId): boolean {
    return this.nodes.has(id);
  }

  /** Returns a cloned node to prevent external mutation of internal storage. */
  getNode(id: NodeId): GraphNode<TAttributes> | undefined {
    const node = this.nodes.get(id);
    return node ? { ...node } : undefined;
  }

  getNodeIds(): NodeId[] {
    return [...this.nodes.keys()];
  }

  getNodes(): GraphNode<TAttributes>[] {
    return [...this.nodes.values()].map((node) => ({ ...node }));
  }

  /** Inserts a node and initializes both adjacency indexes for it. */
  addNode(
    id: NodeId,
    attributes: TAttributes,
    nodeType: GraphNodeType = GraphNodeKinds.LINEAR_NODE,
  ): void {
    if (this.nodes.has(id)) {
      throw new Error(`Node "${id}" already exists.`);
    }

    // The first inserted node is always normalized to START_NODE.
    const resolvedNodeType = this.nodes.size === 0 ? GraphNodeKinds.START_NODE : nodeType;
    if (resolvedNodeType === GraphNodeKinds.START_NODE && this.hasExplicitStartNode()) {
      throw new Error("Graph already contains a START_NODE.");
    }

    this.nodes.set(id, { id, type: resolvedNodeType, attributes });
    this.outgoing.set(id, new Set<NodeId>());
    this.incoming.set(id, new Set<NodeId>());
  }

  updateNodeAttributes(
    id: NodeId,
    next: TAttributes | NodeAttributeUpdater<TAttributes>,
  ): GraphNode<TAttributes> {
    const current = this.nodes.get(id);
    if (!current) {
      throw new Error(`Node "${id}" does not exist.`);
    }

    const attributes = typeof next === "function"
      ? (next as NodeAttributeUpdater<TAttributes>)(current.attributes)
      : next;

    const updated = { ...current, attributes };
    this.nodes.set(id, updated);
    return { ...updated };
  }

  addEdge(from: NodeId, to: NodeId): boolean {
    this.assertNodeExists(from);
    this.assertNodeExists(to);

    const outgoing = this.outgoing.get(from);
    const incoming = this.incoming.get(to);
    if (!outgoing || !incoming) {
      throw new Error("Graph adjacency indexes are not initialized.");
    }

    if (outgoing.has(to)) {
      return false;
    }

    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);
    if (!fromNode || !toNode) {
      throw new Error("Node registry is out of sync with adjacency indexes.");
    }

    // Validate fan-out/fan-in semantics before mutating adjacency.
    this.assertEdgeTypeConstraints(fromNode.type, toNode.type, outgoing.size);
    if (toNode.type === GraphNodeKinds.LINEAR_NODE && incoming.size >= 1) {
      throw new Error("LINEAR_NODE can only have one parent.");
    }
    if (toNode.type === GraphNodeKinds.TRANSITIVE_PARENT && incoming.size >= 1) {
      throw new Error("TRANSITIVE_PARENT can only have one parent.");
    }
    // Cycles are only legal when the edge originates from a GOTO_NODE.
    if (this.wouldIntroduceCycle(from, to) && fromNode.type !== GraphNodeKinds.GOTO_NODE) {
      throw new Error("Only GOTO_NODE can create loops.");
    }

    const sizeBefore = outgoing.size;
    outgoing.add(to);
    incoming.add(from);
    return outgoing.size !== sizeBefore;
  }

  removeEdge(from: NodeId, to: NodeId): boolean {
    this.assertNodeExists(from);
    this.assertNodeExists(to);

    const outgoing = this.outgoing.get(from);
    const incoming = this.incoming.get(to);
    if (!outgoing || !incoming) {
      return false;
    }

    const removed = outgoing.delete(to);
    if (removed) {
      incoming.delete(from);
    }

    return removed;
  }

  hasEdge(from: NodeId, to: NodeId): boolean {
    return this.outgoing.get(from)?.has(to) ?? false;
  }

  getOutgoing(id: NodeId): NodeId[] {
    this.assertNodeExists(id);
    return [...(this.outgoing.get(id) ?? new Set<NodeId>())];
  }

  getIncoming(id: NodeId): NodeId[] {
    this.assertNodeExists(id);
    return [...(this.incoming.get(id) ?? new Set<NodeId>())];
  }

  removeNode(id: NodeId): {
    removedNode: GraphNode<TAttributes>;
    incomingSources: NodeId[];
    outgoingTargets: NodeId[];
  } {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Node "${id}" does not exist.`);
    }

    const incomingSources = this.getIncoming(id);
    const outgoingTargets = this.getOutgoing(id);

    // Remove reverse references first to keep outgoing/incoming mirrors aligned.
    for (const source of incomingSources) {
      this.outgoing.get(source)?.delete(id);
    }

    for (const target of outgoingTargets) {
      this.incoming.get(target)?.delete(id);
    }

    this.nodes.delete(id);
    this.outgoing.delete(id);
    this.incoming.delete(id);

    return {
      removedNode: { ...node },
      incomingSources,
      outgoingTargets,
    };
  }

  snapshot(): GraphStoreSnapshot<TAttributes> {
    const nodeEntries = [...this.nodes.entries()].map(([id, node]) => [
      id,
      { ...node },
    ]) as Array<[NodeId, GraphNode<TAttributes>]>;
    const outgoingEntries = [...this.outgoing.entries()].map(([id, targets]) => [
      id,
      new Set(targets),
    ]) as Array<[NodeId, ReadonlySet<NodeId>]>;
    const incomingEntries = [...this.incoming.entries()].map(([id, sources]) => [
      id,
      new Set(sources),
    ]) as Array<[NodeId, ReadonlySet<NodeId>]>;

    return {
      nodes: new Map(nodeEntries),
      outgoing: new Map(outgoingEntries),
      incoming: new Map(incomingEntries),
    };
  }

  private assertNodeExists(id: NodeId): void {
    if (!this.nodes.has(id)) {
      throw new Error(`Node "${id}" does not exist.`);
    }
  }

  private hasExplicitStartNode(): boolean {
    for (const node of this.nodes.values()) {
      if (node.type === GraphNodeKinds.START_NODE) {
        return true;
      }
    }
    return false;
  }

  private assertEdgeTypeConstraints(
    fromType: GraphNodeType,
    toType: GraphNodeType,
    currentOutgoingCount: number,
  ): void {
    if (fromType === GraphNodeKinds.START_NODE && currentOutgoingCount >= 1) {
      throw new Error("START_NODE can only point to one child node.");
    }

    if (
      fromType !== GraphNodeKinds.GOTO_NODE
      && fromType !== GraphNodeKinds.TRANSITIVE_PARENT
      && currentOutgoingCount >= 1
    ) {
      throw new Error(
        `Node type "${fromType}" cannot point to more than one child. Only GOTO_NODE or TRANSITIVE_PARENT can fan out.`,
      );
    }

    if (fromType === GraphNodeKinds.TRANSITIVE_PARENT && toType !== GraphNodeKinds.TRANSITION_BRANCH) {
      throw new Error(
        "TRANSITIVE_PARENT nodes can only have TRANSITION_BRANCH children.",
      );
    }

    if (toType === GraphNodeKinds.TRANSITION_BRANCH && fromType !== GraphNodeKinds.TRANSITIVE_PARENT) {
      throw new Error(
        "TRANSITION_BRANCH nodes must be direct children of TRANSITIVE_PARENT nodes.",
      );
    }
  }

  private wouldIntroduceCycle(from: NodeId, to: NodeId): boolean {
    if (from === to) {
      return true;
    }

    // Reachability check from `to` to `from` predicts whether adding `from -> to`
    // would create a cycle.
    const visited = new Set<NodeId>();
    const stack: NodeId[] = [to];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) {
        continue;
      }
      if (current === from) {
        return true;
      }
      visited.add(current);
      const next = this.outgoing.get(current);
      if (!next) {
        continue;
      }
      for (const targetId of next) {
        if (!visited.has(targetId)) {
          stack.push(targetId);
        }
      }
    }

    return false;
  }
}
