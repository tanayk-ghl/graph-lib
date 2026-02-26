import type {
  GraphReadStore,
  NodeId,
  ValidationIssue,
  ValidationOptions,
  ValidationReport,
} from "../types.js";
import {
  GraphNodeType,
  ValidationIssueCode,
} from "../types.js";

/**
 * Validates structural mirror integrity, node-type constraints that can be
 * checked post hoc, and optional cycle warnings.
 */
export function validateGraph<TAttributes>(
  store: GraphReadStore<TAttributes>,
  options?: ValidationOptions,
): ValidationReport {
  // Snapshot-first validation guarantees a consistent view even if callers mutate
  // the graph immediately after this function returns.
  const snapshot = store.snapshot();
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(snapshot.nodes.keys());

  for (const key of snapshot.outgoing.keys()) {
    if (!nodeIds.has(key)) {
      issues.push({
        severity: "error",
          code: ValidationIssueCode.MISSING_NODE_FOR_OUTGOING_KEY,
        message: `Outgoing adjacency exists for missing node "${key}".`,
        data: { nodeId: key },
      });
    }
  }

  for (const key of snapshot.incoming.keys()) {
    if (!nodeIds.has(key)) {
      issues.push({
        severity: "error",
          code: ValidationIssueCode.MISSING_NODE_FOR_INCOMING_KEY,
        message: `Incoming adjacency exists for missing node "${key}".`,
        data: { nodeId: key },
      });
    }
  }

  for (const [from, targets] of snapshot.outgoing.entries()) {
    for (const to of targets) {
      if (!nodeIds.has(to)) {
        issues.push({
          severity: "error",
          code: ValidationIssueCode.DANGLING_OUTGOING_EDGE,
          message: `Edge "${from}" -> "${to}" points to a missing node.`,
          data: { from, to },
        });
        continue;
      }

      const incoming = snapshot.incoming.get(to);
      if (!incoming?.has(from)) {
        issues.push({
          severity: "error",
          code: ValidationIssueCode.MISSING_INCOMING_MIRROR,
          message: `Edge "${from}" -> "${to}" has no incoming mirror entry.`,
          data: { from, to },
        });
      }
    }
  }

  for (const [to, sources] of snapshot.incoming.entries()) {
    for (const from of sources) {
      if (!nodeIds.has(from)) {
        issues.push({
          severity: "error",
          code: ValidationIssueCode.DANGLING_INCOMING_EDGE,
          message: `Incoming edge "${from}" -> "${to}" has missing source node.`,
          data: { from, to },
        });
        continue;
      }

      const outgoing = snapshot.outgoing.get(from);
      if (!outgoing?.has(to)) {
        issues.push({
          severity: "error",
          code: ValidationIssueCode.MISSING_OUTGOING_MIRROR,
          message: `Incoming edge "${from}" -> "${to}" has no outgoing mirror entry.`,
          data: { from, to },
        });
      }
    }
  }

  for (const node of snapshot.nodes.values()) {
    if (node.type !== GraphNodeType.TRANSITIVE_PARENT) {
      continue;
    }
    const childCount = snapshot.outgoing.get(node.id)?.size ?? 0;
    if (childCount < 2) {
      issues.push({
        severity: "error",
        code: ValidationIssueCode.TRANSITIVE_PARENT_CHILD_COUNT_INVALID,
        message: `TRANSITIVE_PARENT "${node.id}" must have at least 2 children.`,
        data: { nodeId: node.id, childCount, requiredMin: 2 },
      });
    }
  }

  if (options?.includeCycleWarning) {
    const cycleNodes = findCycleNodes(snapshot.outgoing, nodeIds);
    if (cycleNodes.length > 0) {
      issues.push({
        severity: "warning",
        code: ValidationIssueCode.CYCLE_DETECTED,
        message: "Cycle(s) detected in directed graph.",
        data: { cycleNodes },
      });
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return {
    isValid: errorCount === 0,
    issues,
    errorCount,
    warningCount,
  };
}

function findCycleNodes(
  outgoing: ReadonlyMap<NodeId, ReadonlySet<NodeId>>,
  knownNodes: ReadonlySet<NodeId>,
): NodeId[] {
  const color = new Map<NodeId, 0 | 1 | 2>();
  const cycleNodeSet = new Set<NodeId>();

  const dfs = (nodeId: NodeId): void => {
    color.set(nodeId, 1);
    for (const neighbor of outgoing.get(nodeId) ?? []) {
      if (!knownNodes.has(neighbor)) {
        continue;
      }

      const neighborColor = color.get(neighbor) ?? 0;
      if (neighborColor === 0) {
        dfs(neighbor);
      } else if (neighborColor === 1) {
        cycleNodeSet.add(nodeId);
        cycleNodeSet.add(neighbor);
      }
    }
    color.set(nodeId, 2);
  };

  for (const nodeId of knownNodes) {
    if ((color.get(nodeId) ?? 0) === 0) {
      dfs(nodeId);
    }
  }

  return [...cycleNodeSet];
}
