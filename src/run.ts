import { mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Graph,
  GraphNodeType,
  type PartitionResult,
} from "./index.js";
import { collectEdges, collectNodeIds } from "./utils/graphView.js";
import {
  renderGraphMermaid,
  renderPartitionMermaid,
  type PipelineArtifact,
  writePipelineArtifacts,
} from "./utils/mermaidPipeline.js";

type ChunkSize = 2 | 3;

interface ScenarioNodeAttributes {
  label: string;
  group: string;
  score: number;
}

interface ScenarioNode {
  id: string;
  nodeType?: GraphNodeType;
  attributes: ScenarioNodeAttributes;
}

interface ScenarioDefinition {
  name: string;
  description: string;
  nodes: ScenarioNode[];
  edges: Array<[string, string]>;
  analysisRoots: string[];
}

interface TopologyComparison {
  sameNodes: boolean;
  sameEdges: boolean;
  missingNodes: string[];
  extraNodes: string[];
  missingEdges: string[];
  extraEdges: string[];
}

/** Driver entry point used for local workflow visualization and sanity checks. */
function main(): void {
  const scenario = buildScenario();
  const outputDir = getDriverOutputDir();
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  console.log("=== Graph Driver Pipeline ===");
  console.log("Pipeline: original -> partition(chunk=3) -> merge(stitch)");
  console.log(`Mermaid output directory: ${outputDir}`);
  runScenario(scenario, outputDir);
}

function runScenario(
  scenario: ScenarioDefinition,
  outputDir: string,
): void {
  console.log(`\n--- Scenario: ${scenario.name} ---`);
  console.log(scenario.description);

  // Step 1: build and validate source graph.
  const graph = createGraphFromScenario(scenario);
  const originalValidation = graph.validate();
  const originalEdges = collectEdges(graph);
  const originalNodeIds = collectNodeIds(graph);

  console.log(
    `Original graph: nodes=${originalNodeIds.length}, edges=${originalEdges.length}, valid=${originalValidation.isValid}`,
  );
  printRootAnalysis(graph, scenario.analysisRoots);

  const artifacts: PipelineArtifact[] = [];
  artifacts.push({
    stepNumber: 1,
    stepName: "build_original_graph",
    fileSuffix: "original",
    contents: renderGraphMermaid(graph, `${scenario.name}_original`, {
      validationIsValid: originalValidation.isValid,
      nodeCount: originalNodeIds.length,
      edgeCount: originalEdges.length,
    }),
  });
  // Step 2/3: partition and stitch, then compare topological equivalence.
  const chunkSize: ChunkSize = 3;
  const partition = graph.partitionGraph({
    chunkSize,
    rootIds: scenario.analysisRoots,
  });
  const stitched = Graph.stitchGraph({
    chunks: partition.chunks,
    boundaryEdges: partition.boundaryEdges,
    order: partition.chunks.map((chunk) => chunk.chunkId),
  });
  const comparison = compareTopologies(graph, stitched.graph);

  printPartitionSummary(partition);
  console.log(
    `Merged graph: nodes=${stitched.graph.getNodes().length}, edges=${collectEdges(stitched.graph).length}, valid=${stitched.validation.isValid}`,
  );
  console.log(
    `Topology match after merge: nodes=${comparison.sameNodes}, edges=${comparison.sameEdges}`,
  );
  if (!comparison.sameNodes || !comparison.sameEdges) {
    console.log(`  missingNodes=${comparison.missingNodes.join(",") || "-"}`);
    console.log(`  extraNodes=${comparison.extraNodes.join(",") || "-"}`);
    console.log(`  missingEdges=${comparison.missingEdges.join(",") || "-"}`);
    console.log(`  extraEdges=${comparison.extraEdges.join(",") || "-"}`);
  }

  artifacts.push({
    stepNumber: 2,
    stepName: "partition_chunk_3",
    fileSuffix: "chunk-3.partition",
    contents: renderPartitionMermaid(partition, `${scenario.name}_partition_3`),
  });
  artifacts.push({
    stepNumber: 3,
    stepName: "merge_stitch_graph",
    fileSuffix: "chunk-3.merged",
    contents: renderGraphMermaid(stitched.graph, `${scenario.name}_merged_3`, {
      mergedValid: stitched.validation.isValid,
      topologyNodesMatch: comparison.sameNodes,
      topologyEdgesMatch: comparison.sameEdges,
    }),
  });

  writePipelineArtifacts(outputDir, scenario.name, artifacts);
}

function createGraphFromScenario(
  scenario: ScenarioDefinition,
): Graph<ScenarioNodeAttributes> {
  const graph = new Graph<ScenarioNodeAttributes>();
  for (const node of scenario.nodes) {
    graph.addNode(node.id, node.attributes, node.nodeType);
  }
  for (const [from, to] of scenario.edges) {
    graph.addEdge(from, to);
  }
  return graph;
}

/** Prints root-wise structural summary for quick terminal inspection. */
function printRootAnalysis(
  graph: Graph<ScenarioNodeAttributes>,
  roots: string[],
): void {
  for (const rootId of roots) {
    const classification = graph.classifyReachabilitySubgraph(rootId);
    const terminals = graph.getTerminalNodes(rootId);
    console.log(
      `  root=${rootId} kind=${classification.kind} reachable=${classification.reachableNodeCount} terminals=[${terminals.join(", ")}]`,
    );
  }
}

/** Prints chunk composition and partition metadata. */
function printPartitionSummary(
  partition: PartitionResult<ScenarioNodeAttributes>,
): void {
  console.log(
    `Partition chunkSize=${partition.chunkSize}: sccCount=${partition.metadata.sccCount}, chunks=${partition.metadata.chunkCount}, boundaryEdges=${partition.boundaryEdges.length}`,
  );
  for (const chunk of partition.chunks) {
    const nodeIds = chunk.nodes.map((node) => node.id).join(",");
    console.log(
      `  ${chunk.chunkId} kind=${chunk.kind} nodes=[${nodeIds}] intraEdges=${chunk.intraChunkEdges.length}`,
    );
  }
}

/** Computes exact node/edge deltas between original and stitched graphs. */
function compareTopologies(
  original: Graph<ScenarioNodeAttributes>,
  stitched: Graph<ScenarioNodeAttributes>,
): TopologyComparison {
  const originalNodes = new Set(collectNodeIds(original));
  const stitchedNodes = new Set(collectNodeIds(stitched));
  const originalEdges = new Set(collectEdges(original));
  const stitchedEdges = new Set(collectEdges(stitched));

  const missingNodes = [...originalNodes].filter((nodeId) => !stitchedNodes.has(nodeId)).sort();
  const extraNodes = [...stitchedNodes].filter((nodeId) => !originalNodes.has(nodeId)).sort();
  const missingEdges = [...originalEdges].filter((edge) => !stitchedEdges.has(edge)).sort();
  const extraEdges = [...stitchedEdges].filter((edge) => !originalEdges.has(edge)).sort();

  return {
    sameNodes: missingNodes.length === 0 && extraNodes.length === 0,
    sameEdges: missingEdges.length === 0 && extraEdges.length === 0,
    missingNodes,
    extraNodes,
    missingEdges,
    extraEdges,
  };
}

/** Resolves `docs/generated/run-driver` from either src or dist execution. */
function getDriverOutputDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const currentLeaf = basename(currentDir);
  const projectRoot = currentLeaf === "src" || currentLeaf === "dist"
    ? dirname(currentDir)
    : currentDir;
  return join(projectRoot, "docs", "generated", "run-driver");
}

/** Workflow-style fixture intentionally rich in branching and fan-in patterns. */
function buildScenario(): ScenarioDefinition {
  return {
    name: "rich_complex",
    description: "n8n/GHL-style workflow graph with routing fan-out, converging stages, and post-action branches.",
    nodes: [
      { id: "J", nodeType: GraphNodeType.START_NODE, attributes: { label: "trigger_webhook", group: "entry", score: 1 } },
      { id: "A", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "load_contact", group: "core", score: 2 } },
      { id: "B", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "precheck", group: "core", score: 3 } },
      { id: "C", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "route_channel", group: "core", score: 4 } },
      { id: "D", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "email_path", group: "branch", score: 5 } },
      { id: "E", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "sms_path", group: "branch", score: 6 } },
      { id: "G", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "enrich_email", group: "branch", score: 8 } },
      { id: "H", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "enrich_sms", group: "branch", score: 9 } },
      { id: "I", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "finalize_sms", group: "branch", score: 10 } },
      { id: "K", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "policy_gateway", group: "policy", score: 11 } },
      { id: "L", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "create_task", group: "policy", score: 12 } },
      { id: "M", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "send_to_crm", group: "policy", score: 13 } },
      { id: "N", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "policy_pre_stage", group: "policy", score: 14 } },
      { id: "O", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "email_stage2", group: "post", score: 15 } },
      { id: "P", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "sms_stage2", group: "post", score: 16 } },
      { id: "U", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "email_post_buffer", group: "post", score: 17 } },
      { id: "Q", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "post_actions_email", group: "post", score: 18 } },
      { id: "R", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "notify_owner_email", group: "post", score: 19 } },
      { id: "S", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "audit_log_email", group: "post", score: 20 } },
      { id: "T", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "post_actions_sms", group: "post", score: 21 } },
      { id: "AA", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "sms_post_buffer", group: "post", score: 22 } },
      { id: "V", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "notify_owner_sms", group: "post", score: 22 } },
      { id: "W", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "audit_log_sms", group: "post", score: 23 } },
      { id: "X", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "post_actions_wa", group: "post", score: 24 } },
      { id: "Y", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "notify_owner_wa", group: "post", score: 25 } },
      { id: "Z", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "audit_log_wa", group: "post", score: 26 } },
      { id: "AB", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "email_campaign_buffer", group: "campaign_email", score: 27 } },
      { id: "AC", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "email_campaign_split", group: "campaign_email", score: 28 } },
      { id: "AD", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "email_campaign_primary", group: "campaign_email", score: 29 } },
      { id: "AE", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "email_campaign_secondary", group: "campaign_email", score: 30 } },
      { id: "AF", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "email_campaign_primary_done", group: "campaign_email", score: 31 } },
      { id: "AG", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "email_campaign_secondary_done", group: "campaign_email", score: 32 } },
      { id: "AH", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "email_audit_buffer", group: "campaign_email", score: 33 } },
      { id: "AI", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "email_audit_split", group: "campaign_email", score: 34 } },
      { id: "AJ", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "email_audit_owner", group: "campaign_email", score: 35 } },
      { id: "AK", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "email_audit_archive", group: "campaign_email", score: 36 } },
      { id: "AL", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "email_audit_owner_done", group: "campaign_email", score: 37 } },
      { id: "AM", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "email_audit_archive_done", group: "campaign_email", score: 38 } },
      { id: "AN", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "sms_branch_buffer", group: "campaign_sms", score: 39 } },
      { id: "AO", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "sms_campaign_split", group: "campaign_sms", score: 40 } },
      { id: "AP", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "sms_campaign_primary", group: "campaign_sms", score: 41 } },
      { id: "AQ", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "sms_campaign_secondary", group: "campaign_sms", score: 42 } },
      { id: "AR", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "sms_campaign_primary_done", group: "campaign_sms", score: 43 } },
      { id: "AS", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "sms_campaign_secondary_done", group: "campaign_sms", score: 44 } },
      { id: "AT", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "wa_notify_buffer", group: "campaign_wa", score: 45 } },
      { id: "AU", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "wa_notify_split", group: "campaign_wa", score: 46 } },
      { id: "AV", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "wa_notify_owner", group: "campaign_wa", score: 47 } },
      { id: "AW", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "wa_notify_archive", group: "campaign_wa", score: 48 } },
      { id: "AX", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "wa_notify_owner_done", group: "campaign_wa", score: 49 } },
      { id: "AY", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "wa_notify_archive_done", group: "campaign_wa", score: 50 } },
      { id: "AZ", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "wa_audit_buffer", group: "campaign_wa", score: 51 } },
      { id: "BA", nodeType: GraphNodeType.TRANSITIVE_PARENT, attributes: { label: "wa_audit_split", group: "campaign_wa", score: 52 } },
      { id: "BB", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "wa_audit_owner", group: "campaign_wa", score: 53 } },
      { id: "BC", nodeType: GraphNodeType.TRANSITION_BRANCH, attributes: { label: "wa_audit_archive", group: "campaign_wa", score: 54 } },
      { id: "BD", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "wa_audit_owner_done", group: "campaign_wa", score: 55 } },
      { id: "BE", nodeType: GraphNodeType.LINEAR_NODE, attributes: { label: "wa_audit_archive_done", group: "campaign_wa", score: 56 } },
    ],
    edges: [
      ["J", "A"],
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
      ["C", "E"],
      ["D", "G"],
      ["E", "H"],
      ["H", "I"],
      ["G", "N"],
      ["N", "K"],
      ["K", "L"],
      ["K", "M"],
      ["L", "O"],
      ["O", "U"],
      ["U", "Q"],
      ["M", "P"],
      ["P", "AA"],
      ["AA", "T"],
      ["Q", "R"],
      ["Q", "S"],
      ["V", "X"],
      ["X", "Y"],
      ["X", "Z"],
      ["T", "V"],
      ["T", "W"],
      ["R", "AB"],
      ["AB", "AC"],
      ["AC", "AD"],
      ["AC", "AE"],
      ["AD", "AF"],
      ["AE", "AG"],
      ["S", "AH"],
      ["AH", "AI"],
      ["AI", "AJ"],
      ["AI", "AK"],
      ["AJ", "AL"],
      ["AK", "AM"],
      ["W", "AN"],
      ["AN", "AO"],
      ["AO", "AP"],
      ["AO", "AQ"],
      ["AP", "AR"],
      ["AQ", "AS"],
      ["Y", "AT"],
      ["AT", "AU"],
      ["AU", "AV"],
      ["AU", "AW"],
      ["AV", "AX"],
      ["AW", "AY"],
      ["Z", "AZ"],
      ["AZ", "BA"],
      ["BA", "BB"],
      ["BA", "BC"],
      ["BB", "BD"],
      ["BC", "BE"],
    ],
    analysisRoots: ["J", "C", "K", "Q", "T", "X", "AC", "AI", "AO", "AU", "BA"],
  };
}

main();