import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Graph, type PartitionResult } from "../index.js";
import { collectEdges, collectNodeIds } from "./graphView.js";

export interface PipelineArtifact {
  stepNumber: number;
  stepName: string;
  fileSuffix: string;
  contents: string;
}

/** Writes numbered step artifacts so pipeline output reads chronologically. */
export function writePipelineArtifacts(
  outputDir: string,
  scenarioName: string,
  artifacts: PipelineArtifact[],
): void {
  for (const artifact of artifacts) {
    const numbered = `${String(artifact.stepNumber).padStart(2, "0")}_${artifact.stepName}`;
    const fileName = `${scenarioName}.${numbered}.${artifact.fileSuffix}.mmd`;
    writeFileSync(join(outputDir, fileName), artifact.contents, "utf8");
  }
}

/** Renders a graph as raw Mermaid with metadata comments for quick inspection. */
export function renderGraphMermaid<TAttributes>(
  graph: Graph<TAttributes>,
  title: string,
  metadata?: Record<string, string | number | boolean>,
): string {
  const lines: string[] = [];
  lines.push(`%% ${title}`);
  const nodeIds = collectNodeIds(graph);
  const edges = collectEdges(graph);
  lines.push(`%% nodeCount: ${nodeIds.length}`);
  lines.push(`%% edgeCount: ${edges.length}`);
  lines.push(`%% nodeList: ${nodeIds.join(",")}`);
  lines.push(`%% edgeList: ${edges.join(",")}`);
  if (metadata) {
    const entries = Object.entries(metadata).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    for (const [key, value] of entries) {
      lines.push(`%% ${key}: ${String(value)}`);
    }
  }
  lines.push("flowchart TD");

  const idMap = new Map<string, string>();
  const typeById = new Map(
    graph.getNodes().map((node) => [node.id, node.type] as const),
  );
  for (const nodeId of nodeIds) {
    const ref = toMermaidNodeRef(`node_${nodeId}`);
    idMap.set(nodeId, ref);
    const nodeType = typeById.get(nodeId) ?? "UNKNOWN";
    lines.push(`  ${ref}["${nodeId}\\n${nodeType}"]`);
  }

  for (const edge of edges) {
    const [from, to] = edge.split("->");
    if (!from || !to) {
      continue;
    }
    const fromRef = idMap.get(from);
    const toRef = idMap.get(to);
    if (fromRef && toRef) {
      lines.push(`  ${fromRef} --> ${toRef}`);
    }
  }

  return lines.join("\n");
}

/** Renders both chunk-level and node-level partition views into one diagram. */
export function renderPartitionMermaid<TAttributes>(
  partition: PartitionResult<TAttributes>,
  title: string,
): string {
  const lines: string[] = [];
  lines.push(`%% ${title}`);
  const nodeIds = partition.chunks
    .flatMap((chunk) => chunk.nodes.map((node) => node.id))
    .sort();
  const intraEdges = partition.chunks
    .flatMap((chunk) => chunk.intraChunkEdges.map((edge) => `${edge.from}->${edge.to}`))
    .sort();
  const boundaryEdges = [...partition.boundaryEdges]
    .map((edge) => `${edge.from}->${edge.to}`)
    .sort();
  lines.push(`%% sccCount: ${partition.metadata.sccCount}`);
  lines.push(`%% chunkCount: ${partition.metadata.chunkCount}`);
  lines.push(`%% nodeCount: ${nodeIds.length}`);
  lines.push(`%% nodeList: ${nodeIds.join(",")}`);
  lines.push(`%% intraEdgeCount: ${intraEdges.length}`);
  lines.push(`%% boundaryEdgeCount: ${partition.boundaryEdges.length}`);
  lines.push(`%% totalEdgeCount: ${intraEdges.length + boundaryEdges.length}`);
  lines.push(`%% intraEdgeList: ${intraEdges.join(",")}`);
  lines.push(`%% boundaryEdgeList: ${boundaryEdges.join(",")}`);
  lines.push("flowchart TD");

  // Chunk overview is the primary partition signal: chunk nodes and inter-chunk links.
  const chunkRefMap = new Map<string, string>();
  for (const chunk of partition.chunks) {
    const chunkRef = toMermaidNodeRef(`chunk_node_${chunk.chunkId}`);
    chunkRefMap.set(chunk.chunkId, chunkRef);
    const chunkLabel = `${chunk.chunkId}\\n${chunk.kind}\\nsize=${chunk.nodes.length}`;
    lines.push(`  ${chunkRef}["${chunkLabel}"]`);
  }

  const chunkBoundaryEdgeSet = new Set<string>();
  for (const boundary of partition.boundaryEdges) {
    const fromChunkRef = chunkRefMap.get(boundary.fromChunkId);
    const toChunkRef = chunkRefMap.get(boundary.toChunkId);
    if (!fromChunkRef || !toChunkRef) {
      continue;
    }
    const key = `${fromChunkRef}->${toChunkRef}`;
    if (chunkBoundaryEdgeSet.has(key)) {
      continue;
    }
    chunkBoundaryEdgeSet.add(key);
    lines.push(`  ${fromChunkRef} -->|"boundary"| ${toChunkRef}`);
  }

  lines.push("");
  lines.push("  %% Detailed node-level partition layout");

  const idMap = new Map<string, string>();
  for (const chunk of partition.chunks) {
    const chunkRef = toMermaidNodeRef(`chunk_${chunk.chunkId}`);
    lines.push(`  subgraph ${chunkRef} [${chunk.chunkId}_${chunk.kind}]`);
    const sortedNodes = [...chunk.nodes].sort((left, right) => left.id.localeCompare(right.id));
    for (const node of sortedNodes) {
      const nodeRef = toMermaidNodeRef(`node_${node.id}`);
      idMap.set(node.id, nodeRef);
      lines.push(`    ${nodeRef}["${node.id}\\n${node.type}"]`);
    }
    lines.push("  end");
  }

  for (const edge of intraEdges) {
    const [from, to] = edge.split("->");
    if (!from || !to) {
      continue;
    }
    const fromRef = idMap.get(from);
    const toRef = idMap.get(to);
    if (fromRef && toRef) {
      lines.push(`  ${fromRef} --> ${toRef}`);
    }
  }

  for (const edge of boundaryEdges) {
    const [from, to] = edge.split("->");
    if (!from || !to) {
      continue;
    }
    const fromRef = idMap.get(from);
    const toRef = idMap.get(to);
    if (fromRef && toRef) {
      lines.push(`  ${fromRef} -->|"boundary"| ${toRef}`);
    }
  }

  return lines.join("\n");
}

/** Sanitizes arbitrary ids into Mermaid-safe node refs. */
function toMermaidNodeRef(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}
