import type { FetchedFile } from "@/lib/github/client";

export type DependencyEcosystem = "npm" | "PyPI";

export type DependencyFile = FetchedFile;

export type DependencyPackage = {
  ecosystem: DependencyEcosystem;
  name: string;
  version: string | null;
  declaredRange: string | null;
  direct: boolean;
  dev: boolean;
  runtime: boolean;
  manifest: string;
};

export type ParseResult = {
  packages: DependencyPackage[];
  warnings: string[];
};

export type DeclaredPackage = {
  name: string;
  range: string;
  version: string | null;
  dev: boolean;
  runtime: boolean;
};

export type ResolvedPackage = {
  name: string;
  version: string;
  dev: boolean;
};

export type LockParseResult = {
  packages: ResolvedPackage[];
  warnings: string[];
};
