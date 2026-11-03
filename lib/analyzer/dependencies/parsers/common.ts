import { MAX_DEPENDENCY_PACKAGES } from "@/lib/analyzer/dependencies/limits";
import type { DependencyPackage } from "@/lib/analyzer/dependencies/types";

export function safeJson(content: string): { data: unknown | null; malformed: boolean } {
  try {
    return { data: JSON.parse(content) as unknown, malformed: false };
  } catch {
    return { data: null, malformed: true };
  }
}

export function normalizeNpmName(name: string): string {
  return name.trim().toLowerCase();
}

export function normalizePythonName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, "-");
}

export function isValidNpmName(name: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/i.test(name);
}

export function isValidPythonName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,213}$/i.test(name);
}

export function isValidVersion(version: string): boolean {
  return /^[0-9a-z][0-9a-z.+!_~-]{0,63}$/i.test(version);
}

export function capPackages(packages: DependencyPackage[], warnings: string[]): DependencyPackage[] {
  if (packages.length <= MAX_DEPENDENCY_PACKAGES) return packages;
  warnings.push(`Dependency package limit reached: ${packages.length - MAX_DEPENDENCY_PACKAGES} packages were omitted.`);
  return packages.slice(0, MAX_DEPENDENCY_PACKAGES);
}

export function dedupePackages(packages: DependencyPackage[]): DependencyPackage[] {
  const seen = new Set<string>();
  return packages.filter((pkg) => {
    const key = `${pkg.ecosystem}|${pkg.name}|${pkg.version ?? ""}|${pkg.manifest}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
