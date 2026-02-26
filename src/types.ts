export type NodeId = string;

/**
 * Domain-level node categories used to enforce graph-shape rules.
 *
 * The string values are persisted/emitted externally, so they remain stable.
 */
export enum GraphNodeType {
  START_NODE = "START_NODE",
  LINEAR_NODE = "LINEAR_NODE",
  TRANSITIVE_PARENT = "TRANSITIVE_PARENT",
  TRANSITION_BRANCH = "TRANSITION_BRANCH",
  GOTO_NODE = "GOTO_NODE",
}

export interface GraphNode<TAttributes = unknown> {
  id: NodeId;
  type: GraphNodeType;
  attributes: TAttributes;
}

/** Immutable snapshot of store state for validation/read-only algorithms. */
export interface GraphStoreSnapshot<TAttributes = unknown> {
  nodes: ReadonlyMap<NodeId, GraphNode<TAttributes>>;
  outgoing: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  incoming: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
}

/** Read contract consumed by algorithms and validators. */
export interface GraphReadStore<TAttributes = unknown> {
  hasNode(id: NodeId): boolean;
  getNode(id: NodeId): GraphNode<TAttributes> | undefined;
  getNodeIds(): NodeId[];
  getOutgoing(id: NodeId): NodeId[];
  getIncoming(id: NodeId): NodeId[];
  snapshot(): GraphStoreSnapshot<TAttributes>;
}

export type NodeAttributeUpdater<TAttributes> = (
  current: TAttributes,
) => TAttributes;

/** Classification for reachable subgraphs based on induced branching. */
export enum ReachabilitySubgraphKind {
  LINEAR = "linear",
  TRANSITIVE = "transitive",
}

export interface ReachabilitySubgraphClassification {
  kind: ReachabilitySubgraphKind;
  reachableNodeCount: number;
  terminalNodeCount: number;
}

/** Optional behavior controls for node deletion. */
export interface RemoveNodeOptions {
  reconnect?: boolean;
}

/** Controls how parent edges are detached before subtree reattachment. */
export interface MoveSubtreeOptions {
  detachFromAllParents?: boolean;
  fromParentId?: NodeId;
}

/** Returned from subtree move operations for caller auditing/logging. */
export interface MoveSubtreeResult {
  rootId: NodeId;
  attachedToParentId: NodeId;
  detachedParentIds: NodeId[];
}

/** Stable operation IDs emitted via telemetry hooks. */
export enum GraphOperationName {
  ADD_NODE = "addNode",
  UPDATE_NODE_ATTRIBUTES = "updateNodeAttributes",
  REMOVE_NODE = "removeNode",
  ADD_EDGE = "addEdge",
  REMOVE_EDGE = "removeEdge",
  MOVE_SUBTREE = "moveSubtree",
  PARTITION_GRAPH = "partitionGraph",
  STITCH_GRAPH = "stitchGraph",
  VALIDATE = "validate",
}

export interface OperationStartEvent {
  operation: GraphOperationName;
  startedAtMs: number;
  payload?: Record<string, unknown>;
}

export interface OperationSuccessEvent {
  operation: GraphOperationName;
  startedAtMs: number;
  durationMs: number;
  payload?: Record<string, unknown>;
}

export interface OperationFailureEvent {
  operation: GraphOperationName;
  startedAtMs: number;
  durationMs: number;
  error: unknown;
  payload?: Record<string, unknown>;
}

export type ValidationIssueSeverity = "error" | "warning";

/** Stable machine-readable validation codes for downstream consumers. */
export enum ValidationIssueCode {
  MISSING_NODE_FOR_OUTGOING_KEY = "MISSING_NODE_FOR_OUTGOING_KEY",
  MISSING_NODE_FOR_INCOMING_KEY = "MISSING_NODE_FOR_INCOMING_KEY",
  DANGLING_OUTGOING_EDGE = "DANGLING_OUTGOING_EDGE",
  DANGLING_INCOMING_EDGE = "DANGLING_INCOMING_EDGE",
  MISSING_INCOMING_MIRROR = "MISSING_INCOMING_MIRROR",
  MISSING_OUTGOING_MIRROR = "MISSING_OUTGOING_MIRROR",
  MISSING_EXPLICIT_START_NODE = "MISSING_EXPLICIT_START_NODE",
  MULTIPLE_EXPLICIT_START_NODES = "MULTIPLE_EXPLICIT_START_NODES",
  TRANSITIVE_PARENT_CHILD_COUNT_INVALID = "TRANSITIVE_PARENT_CHILD_COUNT_INVALID",
  CYCLE_DETECTED = "CYCLE_DETECTED",
}

export interface ValidationIssue {
  severity: ValidationIssueSeverity;
  code: ValidationIssueCode;
  message: string;
  data?: Record<string, unknown>;
}

/** Validation execution controls. */
export interface ValidationOptions {
  includeCycleWarning?: boolean;
}

/** Aggregated validation result payload. */
export interface ValidationReport {
  isValid: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

/** Directed edge descriptor used by partition/stitch structures. */
export interface GraphEdge {
  from: NodeId;
  to: NodeId;
}

/** A chunk emitted by the partition algorithm. */
export interface PartitionChunk<TAttributes = unknown> {
  chunkId: string;
  kind: ReachabilitySubgraphKind;
  nodes: GraphNode<TAttributes>[];
  intraChunkEdges: GraphEdge[];
}

/** Cross-chunk edge descriptor required for stitch reconstruction. */
export interface BoundaryEdge extends GraphEdge {
  fromChunkId: string;
  toChunkId: string;
}

/** Partition knobs; chunk size is constrained by product requirements. */
export interface PartitionOptions {
  chunkSize: 2 | 3;
  rootIds?: NodeId[];
}

/** Selected partitioning strategy identifier. */
export enum PartitionStrategy {
  SCC_CONDENSE = "scc-condense",
  WORKFLOW_SUBTREES = "workflow-subtrees",
}

export interface PartitionResult<TAttributes = unknown> {
  chunkSize: 2 | 3;
  strategy: PartitionStrategy;
  chunks: PartitionChunk<TAttributes>[];
  boundaryEdges: BoundaryEdge[];
  metadata: {
    sccCount: number;
    chunkCount: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export interface StitchInput<TAttributes = unknown> {
  chunks: PartitionChunk<TAttributes>[];
  boundaryEdges: BoundaryEdge[];
  order?: string[];
}

/** Legacy-style stitch output shape preserved for API compatibility. */
export interface StitchResult<TAttributes = unknown> {
  graph: GraphNode<TAttributes>[];
  edgeCount: number;
  validation: ValidationReport;
}
