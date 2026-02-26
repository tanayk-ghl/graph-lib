import {
  partitionGraph as partitionGraphFromStore,
} from "./algorithms/partition.js";
import {
  buildStitchedGraphData,
} from "./algorithms/stitch.js";
import {
  classifyReachabilitySubgraph,
} from "./algorithms/subtree.js";
import {
  getLeftmostTerminalNode,
  getRightmostTerminalNode,
  getTerminalNodeByIndex,
  getTerminalNodesFromRoot,
} from "./algorithms/terminalNodes.js";
import { GraphStore } from "./store/GraphStore.js";
import {
  NoopGraphTelemetry,
  type GraphTelemetry,
} from "./telemetry/GraphTelemetry.js";
import {
  GraphOperationName,
  GraphNodeType,
} from "./types.js";
import type {
  GraphNode,
  MoveSubtreeOptions,
  MoveSubtreeResult,
  NodeAttributeUpdater,
  NodeId,
  PartitionOptions,
  PartitionResult,
  RemoveNodeOptions,
  StitchInput,
  ValidationReport,
} from "./types.js";
import { validateGraph } from "./validation/validateGraph.js";

export interface GraphOptions {
  telemetry?: GraphTelemetry;
}

/**
 * Public graph facade responsible for telemetry, invariant-safe mutations,
 * and delegating algorithmic operations to specialized modules.
 */
export class Graph<TAttributes = unknown> {
  private readonly store = new GraphStore<TAttributes>();
  private readonly telemetry: GraphTelemetry;

  constructor(options?: GraphOptions) {
    this.telemetry = options?.telemetry ?? new NoopGraphTelemetry();
  }

  /** Adds a node with optional explicit type (first node is normalized to START_NODE). */
  addNode(
    id: NodeId,
    attributes: TAttributes,
    nodeType: GraphNodeType = GraphNodeType.LINEAR_NODE,
  ): GraphNode<TAttributes> {
    return this.runOperation(GraphOperationName.ADD_NODE, { id, nodeType }, () => {
      this.store.addNode(id, attributes, nodeType);
      const node = this.store.getNode(id);
      if (!node) {
        throw new Error(`Node "${id}" could not be created.`);
      }
      return node;
    });
  }

  /** Replaces or derives a node's attributes using an updater callback. */
  updateNodeAttributes(
    id: NodeId,
    next: TAttributes | NodeAttributeUpdater<TAttributes>,
  ): GraphNode<TAttributes> {
    return this.runOperation(GraphOperationName.UPDATE_NODE_ATTRIBUTES, { id }, () =>
      this.store.updateNodeAttributes(id, next)
    );
  }

  /**
   * Removes a node and, optionally, reconnects every removed parent to every
   * removed child to preserve forward reachability.
   */
  removeNode(
    id: NodeId,
    options?: RemoveNodeOptions,
  ): GraphNode<TAttributes> {
    return this.runOperation(
      GraphOperationName.REMOVE_NODE,
      { id, reconnect: options?.reconnect ?? false },
      () => {
        const reconnect = options?.reconnect ?? false;
        const { incomingSources, outgoingTargets, removedNode } = this.store.removeNode(id);

        if (reconnect) {
          this.reconnectParentsToChildren(incomingSources, outgoingTargets);
        }

        return removedNode;
      },
    );
  }

  /** Creates a directed edge if it does not already exist. */
  addEdge(from: NodeId, to: NodeId): boolean {
    return this.runOperation(GraphOperationName.ADD_EDGE, { from, to }, () =>
      this.store.addEdge(from, to)
    );
  }

  /** Removes a directed edge when present. */
  removeEdge(from: NodeId, to: NodeId): boolean {
    return this.runOperation(GraphOperationName.REMOVE_EDGE, { from, to }, () =>
      this.store.removeEdge(from, to)
    );
  }

  /**
   * Reattaches a root node to a new parent after optional parent detachment.
   * Structural constraints are validated by the underlying store on addEdge.
   */
  moveSubtree(
    rootId: NodeId,
    newParentId: NodeId,
    options?: MoveSubtreeOptions,
  ): MoveSubtreeResult {
    return this.runOperation(
      GraphOperationName.MOVE_SUBTREE,
      {
        rootId,
        newParentId,
        detachFromAllParents: options?.detachFromAllParents ?? false,
        fromParentId: options?.fromParentId,
      },
      () => {
        if (rootId === newParentId) {
          throw new Error("Cannot move subtree: root and new parent are the same node.");
        }
        this.assertNodeExists(rootId);
        this.assertNodeExists(newParentId);

        const detachedParentIds: NodeId[] = [];
        if (options?.detachFromAllParents) {
          const existingParents = this.store.getIncoming(rootId);
          for (const parentId of existingParents) {
            if (this.store.removeEdge(parentId, rootId)) {
              detachedParentIds.push(parentId);
            }
          }
        } else if (options?.fromParentId) {
          if (this.store.removeEdge(options.fromParentId, rootId)) {
            detachedParentIds.push(options.fromParentId);
          }
        }

        this.store.addEdge(newParentId, rootId);
        return { rootId, attachedToParentId: newParentId, detachedParentIds };
      },
    );
  }

  /** Returns whether a node exists. */
  hasNode(id: NodeId): boolean {
    return this.store.hasNode(id);
  }

  /** Returns whether an edge exists. */
  hasEdge(from: NodeId, to: NodeId): boolean {
    return this.store.hasEdge(from, to);
  }

  /** Returns a cloned node snapshot for a given id. */
  getNode(id: NodeId): GraphNode<TAttributes> | undefined {
    return this.store.getNode(id);
  }

  /** Returns cloned node snapshots in insertion order. */
  getNodes(): GraphNode<TAttributes>[] {
    return this.store.getNodes();
  }

  /** Returns outgoing node ids in insertion order. */
  getOutgoing(id: NodeId): NodeId[] {
    return this.store.getOutgoing(id);
  }

  /** Returns incoming node ids in insertion order. */
  getIncoming(id: NodeId): NodeId[] {
    return this.store.getIncoming(id);
  }

  /** Classifies the root-induced reachable region as linear or transitive. */
  classifyReachabilitySubgraph(rootId: NodeId) {
    return classifyReachabilitySubgraph(this.store, rootId);
  }

  /** Returns terminal node ids for the root-induced region. */
  getTerminalNodes(rootId: NodeId): NodeId[] {
    return getTerminalNodesFromRoot(this.store, rootId);
  }

  /** Returns the first terminal node in deterministic traversal order. */
  getLeftmostTerminal(rootId: NodeId): NodeId | undefined {
    return getLeftmostTerminalNode(this.store, rootId);
  }

  /** Returns the last terminal node in deterministic traversal order. */
  getRightmostTerminal(rootId: NodeId): NodeId | undefined {
    return getRightmostTerminalNode(this.store, rootId);
  }

  /** Returns the terminal node at a zero-based index, if available. */
  getTerminalByIndex(rootId: NodeId, index: number): NodeId | undefined {
    return getTerminalNodeByIndex(this.store, rootId, index);
  }

  /** Partitions the graph using SCC condensation then deterministic chunking. */
  partitionGraph(options: PartitionOptions): PartitionResult<TAttributes> {
    const payload: Record<string, unknown> = { chunkSize: options.chunkSize };
    if (options.rootIds) {
      payload.rootIds = options.rootIds;
    }

    return this.runOperation(GraphOperationName.PARTITION_GRAPH, payload, () => {
      const result = partitionGraphFromStore(this.store, options);
      payload.sccCount = result.metadata.sccCount;
      payload.chunkCount = result.metadata.chunkCount;
      payload.boundaryEdgeCount = result.boundaryEdges.length;
      return result;
    });
  }

  static stitchGraph<TAttributes>(
    input: StitchInput<TAttributes>,
    options?: GraphOptions,
  ): { graph: Graph<TAttributes>; validation: ValidationReport; edgeCount: number } {
    const graph = new Graph<TAttributes>(options);
    const payload: Record<string, unknown> = {
      chunkCount: input.chunks.length,
      boundaryEdgeCount: input.boundaryEdges.length,
    };

    return graph.runOperation(GraphOperationName.STITCH_GRAPH, payload, () => {
      const build = buildStitchedGraphData(input);
      payload.nodeCount = build.nodes.length;
      payload.edgeCount = build.edges.length;

      for (const node of build.nodes) {
        graph.addNode(node.id, node.attributes, node.type);
      }
      for (const edge of build.edges) {
        graph.addEdge(edge.from, edge.to);
      }

      const validation = validateGraph(graph.store, { includeCycleWarning: true });
      payload.isValid = validation.isValid;
      return {
        graph,
        validation,
        edgeCount: build.edges.length,
      };
    });
  }

  /** Validates adjacency integrity and business constraints. */
  validate(): ValidationReport {
    return this.runOperation(GraphOperationName.VALIDATE, undefined, () =>
      validateGraph(this.store, { includeCycleWarning: true })
    );
  }

  private reconnectParentsToChildren(
    parentIds: NodeId[],
    childIds: NodeId[],
  ): void {
    // Reconnect mode builds the Cartesian product of removed incoming/outgoing
    // edges to keep traversal continuity after node deletion.
    for (const parentId of parentIds) {
      for (const childId of childIds) {
        if (parentId !== childId) {
          this.store.addEdge(parentId, childId);
        }
      }
    }
  }

  private assertNodeExists(id: NodeId): void {
    if (!this.store.hasNode(id)) {
      throw new Error(`Node "${id}" does not exist.`);
    }
  }

  private runOperation<TResult>(
    operation: GraphOperationName,
    payload: Record<string, unknown> | undefined,
    work: () => TResult,
  ): TResult {
    // Telemetry emits operation lifecycle events around all public mutations/queries.
    const startedAtMs = Date.now();
    this.telemetry.onOperationStart({
      operation,
      startedAtMs,
      ...(payload ? { payload } : {}),
    });

    try {
      const result = work();
      this.telemetry.onOperationSuccess({
        operation,
        startedAtMs,
        durationMs: Date.now() - startedAtMs,
        ...(payload ? { payload } : {}),
      });
      return result;
    } catch (error) {
      this.telemetry.onOperationFailure({
        operation,
        startedAtMs,
        durationMs: Date.now() - startedAtMs,
        error,
        ...(payload ? { payload } : {}),
      });
      throw error;
    }
  }
}
