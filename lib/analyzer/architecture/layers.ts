export type InferredLayer = "presentation" | "interface" | "domain" | "data" | "shared";

const LAYER_SEGMENTS: Record<InferredLayer, Set<string>> = {
  presentation: new Set(["components", "component", "views", "view", "pages", "screens", "ui"]),
  interface: new Set(["api", "routes", "route", "controllers", "controller", "handlers", "handler", "endpoints", "server", "app"]),
  domain: new Set(["domain", "services", "service", "usecases", "use-cases", "core"]),
  data: new Set(["data", "db", "database", "repositories", "repository", "persistence", "models", "infra", "infrastructure", "adapters", "adapter"]),
  shared: new Set(["shared", "common", "utils", "util", "helpers", "helper", "types", "config"]),
};

export function inferLayer(path: string): InferredLayer | null {
  const directories = path.toLowerCase().split("/").slice(0, -1);
  for (const directory of directories) {
    for (const [layer, segments] of Object.entries(LAYER_SEGMENTS) as Array<[InferredLayer, Set<string>]>) {
      if (segments.has(directory)) return layer;
    }
  }
  return null;
}

export function isLayerViolation(source: InferredLayer, target: InferredLayer): boolean {
  if (source === "data") return target === "presentation" || target === "interface";
  if (source === "domain") return target === "presentation";
  if (source === "presentation") return target === "data";
  return false;
}
