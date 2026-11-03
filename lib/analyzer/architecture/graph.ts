import type { ImportGraphInput } from "@/lib/analyzer/ast/imports";
import { resolveImport } from "@/lib/analyzer/ast/imports";

export type ModuleEdge = {
  from: string;
  to: string;
  line: number;
  specifier: string;
  moduleKind?: "esm" | "cjs";
};

export type ModuleGraph = {
  nodes: string[];
  edges: ModuleEdge[];
  outgoing: Map<string, ModuleEdge[]>;
  incoming: Map<string, ModuleEdge[]>;
  fanOut: Map<string, number>;
  fanIn: Map<string, number>;
};

export function buildModuleGraph(
  inputs: ImportGraphInput[],
  analyzedPaths: Iterable<string>,
  knownPaths: Set<string>,
): ModuleGraph {
  const nodes = [...new Set(analyzedPaths)].sort();
  const nodeSet = new Set(nodes);
  const resolution = new Set<string>([...nodes, ...knownPaths]);
  const edges: ModuleEdge[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    if (!nodeSet.has(input.path)) continue;
    for (const item of input.imports) {
      if (item.typeOnly) continue;
      const resolved = resolveImport(input.path, item, resolution);
      if (!resolved || !nodeSet.has(resolved) || resolved === input.path) continue;
      const key = `${input.path}|${resolved}|${item.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: input.path,
        to: resolved,
        line: item.line,
        specifier: item.specifier,
        moduleKind: item.moduleKind,
      });
    }
  }

  edges.sort(
    (a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.to.localeCompare(b.to),
  );

  const outgoing = new Map<string, ModuleEdge[]>();
  const incoming = new Map<string, ModuleEdge[]>();
  const fanOutSets = new Map<string, Set<string>>();
  const fanInSets = new Map<string, Set<string>>();

  for (const node of nodes) {
    outgoing.set(node, []);
    incoming.set(node, []);
    fanOutSets.set(node, new Set());
    fanInSets.set(node, new Set());
  }

  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
    fanOutSets.get(edge.from)?.add(edge.to);
    fanInSets.get(edge.to)?.add(edge.from);
  }

  const fanOut = new Map<string, number>();
  const fanIn = new Map<string, number>();
  for (const node of nodes) {
    fanOut.set(node, fanOutSets.get(node)?.size ?? 0);
    fanIn.set(node, fanInSets.get(node)?.size ?? 0);
  }

  return { nodes, edges, outgoing, incoming, fanOut, fanIn };
}

export function stronglyConnectedComponents(graph: ModuleGraph): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const strongConnect = (node: string): void => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);

    for (const edge of graph.outgoing.get(node) ?? []) {
      if (!graph.nodes.includes(edge.to)) continue;
      if (!indices.has(edge.to)) {
        strongConnect(edge.to);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(edge.to)!));
      } else if (onStack.has(edge.to)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(edge.to)!));
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (!member) break;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) components.push(component.sort());
    }
  };

  for (const node of graph.nodes) {
    if (!indices.has(node)) strongConnect(node);
  }

  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}
