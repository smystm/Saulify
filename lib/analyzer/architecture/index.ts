import type { FetchedFile, TreeEntry } from "@/lib/github/client";
import type { Confidence, Finding, Severity } from "@/lib/reports/schema";
import type { ImportGraphInput } from "@/lib/analyzer/ast/imports";
import { makeQualityFinding } from "@/lib/analyzer/quality/findings";
import type { QualityCandidate } from "@/lib/analyzer/quality/metrics";
import { buildModuleGraph, stronglyConnectedComponents, type ModuleGraph } from "./graph";
import { inferLayer, isLayerViolation } from "./layers";
import {
  collectStructureMetrics,
  FRAGMENTED_DIR_LIMIT,
  MAX_PATH_DEPTH,
  ROOT_SPRAWL_LIMIT,
} from "./structure";

export const ARCHITECTURE_MAX_FINDINGS = 4;
export const ARCHITECTURE_TIME_BUDGET_MS = 1_000;
export const FAN_IN_THRESHOLD = 6;
export const FAN_OUT_THRESHOLD = 8;
export const CONCENTRATION_SHARE = 0.3;
export const CONCENTRATION_MIN_EDGES = 6;

export type ArchitectureInput = {
  files: FetchedFile[];
  treeEntries: TreeEntry[];
  treeTruncated: boolean;
  imports: ImportGraphInput[];
  analyzedPaths: string[];
  knownPaths: Set<string>;
  fullCoverage?: boolean;
  timeBudgetMs?: number;
  maxFindings?: number;
  now?: () => number;
};

export type ArchitectureResult = {
  findings: Finding[];
  timedOut: boolean;
  warning: string | null;
};

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const CONFIG_FILE = /(^|\/)[^/]+\.config\.[^/]+$/i;

function edgeEvidence(graph: ModuleGraph, members: Set<string>): string {
  return graph.edges
    .filter((edge) => members.has(edge.from) && members.has(edge.to))
    .slice(0, 16)
    .map((edge) => `${edge.from}:${edge.line} -> ${edge.to} (${edge.specifier})`)
    .join("\n");
}

function cycleCandidates(graph: ModuleGraph, byPath: Map<string, FetchedFile>): QualityCandidate[] {
  const candidates: QualityCandidate[] = [];
  for (const component of stronglyConnectedComponents(graph)) {
    const members = new Set(component);
    const internal = graph.edges.filter((edge) => members.has(edge.from) && members.has(edge.to));
    const primary = internal[0];
    const primaryFile = primary?.from ?? component[0];
    const file = byPath.get(primaryFile);
    if (!file) continue;
    const relatedLocations = component
      .filter((member) => member !== primaryFile)
      .slice(0, 7)
      .map((member) => {
        const edge = internal.find((item) => item.from === member) ?? internal[0];
        return { file: member, startLine: edge?.line ?? 1, endLine: edge?.line ?? 1 };
      });
    const severity = component.length >= 3 ? "medium" : "low";
    const finding = makeQualityFinding(file.path, file.content, {
      ruleId: `circular-module:${component.join("|")}`,
      title:
        component.length >= 3
          ? `Circular module dependency across ${component.length} modules`
          : "Circular module dependency",
      severity,
      confidence: "high",
      category: "architecture",
      assessment: "measured",
      explanation: `The analyzed module graph contains a strongly connected component of ${component.length} modules: ${component.join(", ")}. Each module can reach every other member.`,
      whyProblematic:
        "Cycles make initialization order fragile and can leave bindings partially initialized, depending on the runtime and bundler.",
      suggestedFix:
        "Move shared declarations into a neutral module, or invert one dependency so the strongly connected component becomes a directed path.",
      startLine: primary?.line ?? 1,
      endLine: primary?.line ?? 1,
      evidence: `Modules: ${component.join(", ")}\nInternal edges:\n${edgeEvidence(graph, members)}`,
      relatedLocations,
    });
    candidates.push({ finding, score: 100 + component.length });
  }
  return candidates;
}

function couplingCandidates(graph: ModuleGraph, byPath: Map<string, FetchedFile>): QualityCandidate[] {
  const candidates: QualityCandidate[] = [];
  for (const node of graph.nodes) {
    const fanIn = graph.fanIn.get(node) ?? 0;
    const fanOut = graph.fanOut.get(node) ?? 0;
    if (fanIn < FAN_IN_THRESHOLD && fanOut < FAN_OUT_THRESHOLD) continue;
    const file = byPath.get(node);
    if (!file) continue;
    const outgoing = graph.outgoing.get(node) ?? [];
    const incoming = graph.incoming.get(node) ?? [];
    const first = outgoing[0] ?? incoming[0];
    const related = [...new Set([...outgoing.map((edge) => edge.to), ...incoming.map((edge) => edge.from)])].slice(0, 7);
    const finding = makeQualityFinding(file.path, file.content, {
      ruleId: "coupling-hub",
      title: "Highly coupled module",
      severity: "low",
      confidence: "high",
      category: "architecture",
      assessment: "measured",
      explanation: `This module has ${fanIn} internal module${fanIn === 1 ? "" : "s"} importing it and imports ${fanOut} internal module${fanOut === 1 ? "" : "s"} itself.`,
      whyProblematic:
        "A module with many incoming and outgoing dependencies is expensive to change because one edit can affect several parts of the repository.",
      suggestedFix:
        "Split unrelated responsibilities, move shared types to a neutral module, and reduce the number of modules that must change together.",
      startLine: first?.line ?? 1,
      endLine: first?.line ?? 1,
      evidence: [
        `Fan-in: ${fanIn}, fan-out: ${fanOut}`,
        ...outgoing.slice(0, 8).map((edge) => `imports ${edge.to} at line ${edge.line}`),
        ...incoming.slice(0, 8).map((edge) => `imported by ${edge.from} at line ${edge.line}`),
      ].join("\n"),
      relatedLocations: related.map((member) => ({ file: member, startLine: 1, endLine: 1 })),
    });
    candidates.push({ finding, score: 10 + Math.max(fanIn / FAN_IN_THRESHOLD, fanOut / FAN_OUT_THRESHOLD) });
  }
  return candidates;
}

function concentrationCandidate(graph: ModuleGraph, byPath: Map<string, FetchedFile>): QualityCandidate[] {
  const edgeKeys = new Set(graph.edges.map((edge) => `${edge.from}|${edge.to}`));
  const total = edgeKeys.size;
  if (total < CONCENTRATION_MIN_EDGES) return [];

  const incidents = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const key = `${edge.from}|${edge.to}`;
    if (!incidents.has(edge.from)) incidents.set(edge.from, new Set());
    if (!incidents.has(edge.to)) incidents.set(edge.to, new Set());
    incidents.get(edge.from)?.add(key);
    incidents.get(edge.to)?.add(key);
  }

  let best: { node: string; count: number; share: number } | null = null;
  for (const [node, edges] of incidents) {
    const share = edges.size / total;
    if (edges.size < CONCENTRATION_MIN_EDGES || share < CONCENTRATION_SHARE) continue;
    if (!best || share > best.share || (share === best.share && edges.size > best.count)) {
      best = { node, count: edges.size, share };
    }
  }
  if (!best) return [];
  const file = byPath.get(best.node);
  if (!file) return [];
  const connected = [
    ...new Set(
      graph.edges
        .filter((edge) => edge.from === best!.node || edge.to === best!.node)
        .flatMap((edge) => [edge.from, edge.to])
        .filter((node) => node !== best!.node),
    ),
  ].slice(0, 7);
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "dependency-concentration",
    title: "Internal dependency graph is concentrated around one module",
    severity: "low",
    confidence: "high",
    category: "architecture",
    assessment: "measured",
    explanation: `One module participates in ${best.count} of ${total} internal dependency edges (${Math.round(best.share * 100)}%).`,
    whyProblematic:
      "When most dependencies pass through one module, that module becomes a coordination bottleneck and a single point of architectural failure.",
    suggestedFix:
      "Check whether the module owns unrelated responsibilities. Move shared contracts down into smaller modules and let callers depend on those directly.",
    startLine: 1,
    endLine: 1,
    evidence: `Module: ${best.node}\nIncident distinct edges: ${best.count}\nTotal distinct internal edges: ${total}`,
    relatedLocations: connected.map((member) => ({ file: member, startLine: 1, endLine: 1 })),
  });
  return [{ finding, score: 5 + best.share }];
}

function layerCandidates(graph: ModuleGraph, byPath: Map<string, FetchedFile>): QualityCandidate[] {
  const classified = graph.nodes.map((node) => ({ node, layer: inferLayer(node) })).filter((item) => item.layer);
  const distinctLayers = new Set(classified.map((item) => item.layer));
  if (classified.length < 4 || distinctLayers.size < 2) return [];

  const seen = new Set<string>();
  const candidates: QualityCandidate[] = [];
  for (const edge of graph.edges) {
    if (candidates.length >= 2) break;
    const sourceLayer = inferLayer(edge.from);
    const targetLayer = inferLayer(edge.to);
    if (!sourceLayer || !targetLayer || sourceLayer === targetLayer) continue;
    if (!isLayerViolation(sourceLayer, targetLayer)) continue;
    const key = `${edge.from}|${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const file = byPath.get(edge.from);
    const target = byPath.get(edge.to);
    if (!file || !target) continue;
    const finding = makeQualityFinding(file.path, file.content, {
      ruleId: "layer-violation",
      title: `Possible layer violation: ${sourceLayer} imports ${targetLayer}`,
      severity: "low",
      confidence: "low",
      category: "architecture",
      assessment: "advisory",
      explanation: `Directory inference classifies ${edge.from} as ${sourceLayer} and ${edge.to} as ${targetLayer}. The import goes against the usual direction of that layering convention.`,
      whyProblematic:
        "Layer boundaries are a convention, not a universal rule. When this direction is unintentional, changes to lower-level modules can force changes in presentation or interface code.",
      suggestedFix:
        "Confirm the intended boundary first. If the dependency is wrong, invert it through an interface or move shared behavior into a neutral module. If the direction is intentional, record that decision.",
      startLine: edge.line,
      endLine: edge.line,
      evidence: `${edge.from}:${edge.line} imports "${edge.specifier}" -> ${edge.to}\nInferred layers: ${sourceLayer} -> ${targetLayer}`,
      relatedLocations: [{ file: edge.to, startLine: 1, endLine: 1 }],
    });
    candidates.push({ finding, score: 1 });
  }
  return candidates;
}

function structureCandidates(
  treeEntries: TreeEntry[],
  treeTruncated: boolean,
  byPath: Map<string, FetchedFile>,
): QualityCandidate[] {
  if (treeTruncated) return [];
  const metrics = collectStructureMetrics(treeEntries);
  const candidates: QualityCandidate[] = [];

  if (metrics.rootSourceFiles.length > ROOT_SPRAWL_LIMIT) {
    const file = byPath.get(metrics.rootSourceFiles[0]);
    if (file) {
      const finding = makeQualityFinding(file.path, file.content, {
        ruleId: "root-sprawl",
        title: "Many source files live at the repository root",
        severity: "low",
        confidence: "medium",
        category: "architecture",
        assessment: "advisory",
        explanation: `${metrics.rootSourceFiles.length} source files sit directly at the repository root, above the advisory limit of ${ROOT_SPRAWL_LIMIT}.`,
        whyProblematic:
          "Root sprawl makes ownership and entry points harder to find, and often mixes build scripts, application code, and shared helpers.",
        suggestedFix:
          "Group related files into a small number of top-level directories. Keep only entry points and repository configuration at the root.",
        startLine: 1,
        endLine: 1,
        evidence: metrics.rootSourceFiles.slice(0, 20).join("\n"),
        relatedLocations: metrics.rootSourceFiles.slice(1, 8).map((path) => ({ file: path, startLine: 1, endLine: 1 })),
      });
      candidates.push({ finding, score: 1 });
    }
  }

  if (metrics.deepPaths.length > 0) {
    const file = byPath.get(metrics.deepPaths[0]);
    if (file) {
      const finding = makeQualityFinding(file.path, file.content, {
        ruleId: "deep-path",
        title: "Deeply nested directory path",
        severity: "low",
        confidence: "medium",
        category: "architecture",
        assessment: "advisory",
        explanation: `${metrics.deepPaths.length} source file${metrics.deepPaths.length === 1 ? "" : "s"} exceed the advisory path-depth limit of ${MAX_PATH_DEPTH} segments.`,
        whyProblematic:
          "Deep paths are harder to scan in reviews and often signal that intermediate directories no longer represent a meaningful boundary.",
        suggestedFix:
          "Check whether the intermediate directories still group related code. Flatten the path when they do not.",
        startLine: 1,
        endLine: 1,
        evidence: metrics.deepPaths.slice(0, 20).join("\n"),
        relatedLocations: metrics.deepPaths.slice(1, 8).map((path) => ({ file: path, startLine: 1, endLine: 1 })),
      });
      candidates.push({ finding, score: 1 });
    }
  }

  if (metrics.fragmentedDirs.length > FRAGMENTED_DIR_LIMIT) {
    const samplePath = metrics.fragmentedDirs
      .map((entry) => entry.sample)
      .find((path) => byPath.has(path));
    const file = samplePath ? byPath.get(samplePath) : undefined;
    if (file) {
      const finding = makeQualityFinding(file.path, file.content, {
        ruleId: "fragmented-directories",
        title: "Many top-level directories contain a single source file",
        severity: "low",
        confidence: "medium",
        category: "architecture",
        assessment: "advisory",
        explanation: `${metrics.fragmentedDirs.length} top-level directories contain at most one source file, above the advisory limit of ${FRAGMENTED_DIR_LIMIT}.`,
        whyProblematic:
          "Single-file directories add navigation depth without creating a real module boundary.",
        suggestedFix:
          "Consolidate directories that no longer group related code, or add the missing module files if the boundary is intentional.",
        startLine: 1,
        endLine: 1,
        evidence: metrics.fragmentedDirs
          .slice(0, 20)
          .map((entry) => `${entry.directory}/ (${entry.files} source file${entry.files === 1 ? "" : "s"})`)
          .join("\n"),
        relatedLocations: metrics.fragmentedDirs
          .map((entry) => entry.sample)
          .filter((path) => path !== file.path)
          .slice(0, 7)
          .map((path) => ({ file: path, startLine: 1, endLine: 1 })),
      });
      candidates.push({ finding, score: 1 });
    }
  }

  return candidates.slice(0, 2);
}

function mixedModuleCandidates(
  imports: ImportGraphInput[],
  byPath: Map<string, FetchedFile>,
): QualityCandidate[] {
  const esm = new Set<string>();
  const cjs = new Set<string>();
  for (const input of imports) {
    if (CONFIG_FILE.test(input.path)) continue;
    const kinds = new Set(
      input.imports
        .filter((item) => item.language === "js" && !item.typeOnly && item.moduleKind)
        .map((item) => item.moduleKind!),
    );
    if (kinds.has("cjs")) cjs.add(input.path);
    else if (kinds.has("esm")) esm.add(input.path);
  }

  const total = esm.size + cjs.size;
  if (esm.size < 2 || cjs.size < 2 || total === 0) return [];
  if (esm.size / total < 0.2 || cjs.size / total < 0.2) return [];

  const primary = [...cjs].sort()[0];
  const file = byPath.get(primary);
  if (!file) return [];
  const related = [...new Set([...esm, ...cjs])].filter((path) => path !== primary).slice(0, 7);
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "mixed-modules",
    title: "Repository mixes ES modules and CommonJS",
    severity: "low",
    confidence: "medium",
    category: "architecture",
    assessment: "measured",
    explanation: `${esm.size} analyzed files use ES module syntax and ${cjs.size} use CommonJS require calls, excluding configuration files.`,
    whyProblematic:
      "Mixed module systems complicate bundling and can produce interop failures when one format is loaded from the other.",
    suggestedFix:
      "Choose one module system for application code, then migrate the smaller set. Keep configuration files out of the decision.",
    startLine: 1,
    endLine: 1,
    evidence: `ES modules (${esm.size}):\n${[...esm].sort().slice(0, 8).join("\n")}\nCommonJS (${cjs.size}):\n${[...cjs].sort().slice(0, 8).join("\n")}`,
    relatedLocations: related.map((path) => ({ file: path, startLine: 1, endLine: 1 })),
  });
  return [{ finding, score: 1 }];
}

export function analyzeArchitecture(input: ArchitectureInput): ArchitectureResult {
  const now = input.now ?? Date.now;
  const deadline = now() + (input.timeBudgetMs ?? ARCHITECTURE_TIME_BUDGET_MS);
  const byPath = new Map(input.files.map((file) => [file.path, file]));
  const graph = buildModuleGraph(input.imports, input.analyzedPaths, input.knownPaths);
  const candidates: QualityCandidate[] = [];
  let timedOut = false;

  const stages = [
    () => cycleCandidates(graph, byPath),
    () => couplingCandidates(graph, byPath),
    () => concentrationCandidate(graph, byPath),
    () => layerCandidates(graph, byPath),
    () => structureCandidates(input.treeEntries, input.treeTruncated, byPath),
    () => mixedModuleCandidates(input.imports, byPath),
  ];

  for (const stage of stages) {
    if (now() > deadline) {
      timedOut = true;
      break;
    }
    candidates.push(...stage());
  }

  const findings = candidates
    .sort(
      (a, b) =>
        SEVERITY_WEIGHT[a.finding.severity] - SEVERITY_WEIGHT[b.finding.severity] ||
        CONFIDENCE_WEIGHT[a.finding.confidence] - CONFIDENCE_WEIGHT[b.finding.confidence] ||
        b.score - a.score ||
        (a.finding.file ?? "").localeCompare(b.finding.file ?? "") ||
        (a.finding.startLine ?? 0) - (b.finding.startLine ?? 0),
    )
    .slice(0, input.maxFindings ?? ARCHITECTURE_MAX_FINDINGS)
    .map((candidate) => candidate.finding);

  const notes: string[] = [];
  if (input.fullCoverage === false) {
    notes.push(
      `Architecture analysis covers the selected sample of ${graph.nodes.length} analyzed files; dependency and cycle findings may omit modules outside the sample.`,
    );
  }
  if (input.treeTruncated) {
    notes.push("The repository tree was truncated; architecture structure checks use only the returned portion.");
  }
  if (timedOut) {
    notes.push(
      "Architecture analysis reached its time budget; dependency and structure checks cover only the work completed before the limit.",
    );
  }

  return {
    findings,
    timedOut,
    warning: notes.length > 0 ? notes.join(" ") : null,
  };
}
