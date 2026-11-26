import type { RepositoryDocumentRole } from "@lervo/project";

export interface ProviderDocumentSurfaceDescriptor {
  descriptorId: string;
  descriptorVersion: 1;
  provider: "codex" | "claude";
  surfaces: Array<{
    neutralRoleId: "canonical_agent_instruction" | "provider_instruction_bridge";
    scopePath: ".";
    path: string;
    discovery: "ancestor_search" | "root_import";
    rewritePolicy: RepositoryDocumentRole["rewritePolicy"];
  }>;
}

export const builtinProviderDocumentSurfaces: readonly ProviderDocumentSurfaceDescriptor[] = [
  {
    descriptorId: "codex.repository-instructions.v1",
    descriptorVersion: 1,
    provider: "codex",
    surfaces: [
      {
        neutralRoleId: "canonical_agent_instruction",
        scopePath: ".",
        path: "AGENTS.md",
        discovery: "ancestor_search",
        rewritePolicy: "managed_regions",
      },
    ],
  },
  {
    descriptorId: "claude.repository-instructions.v1",
    descriptorVersion: 1,
    provider: "claude",
    surfaces: [
      {
        neutralRoleId: "provider_instruction_bridge",
        scopePath: ".",
        path: "CLAUDE.md",
        discovery: "root_import",
        rewritePolicy: "managed_regions",
      },
    ],
  },
];

export function providerSurfaceRoles(
  descriptors: readonly ProviderDocumentSurfaceDescriptor[] = builtinProviderDocumentSurfaces,
): RepositoryDocumentRole[] {
  return descriptors
    .flatMap((descriptor) =>
      descriptor.surfaces.map((surface) => ({
        roleId: surface.neutralRoleId,
        scopePath: surface.scopePath,
        path: surface.path,
        cardinality: "one" as const,
        lifecycleOwner: "provider_adapter" as const,
        relocation: "preserve" as const,
        rewritePolicy: surface.rewritePolicy,
        required: false,
      })),
    )
    .sort((left, right) =>
      left.roleId === right.roleId
        ? left.path.localeCompare(right.path)
        : left.roleId.localeCompare(right.roleId),
    );
}

type ProviderSurfaceRole = ProviderDocumentSurfaceDescriptor["surfaces"][number]["neutralRoleId"];

/** The neutral role of the root provider instruction surface at `path`, or null for any other. */
export function providerSurfaceRoleAt(
  path: string,
  descriptors: readonly ProviderDocumentSurfaceDescriptor[] = builtinProviderDocumentSurfaces,
): ProviderSurfaceRole | null {
  for (const descriptor of descriptors)
    for (const surface of descriptor.surfaces)
      if (surface.path === path) return surface.neutralRoleId;
  return null;
}

/** The imports of root provider instruction surfaces in `content`, such as `@AGENTS.md`. */
export function providerSurfaceImports(
  content: string,
  descriptors: readonly ProviderDocumentSurfaceDescriptor[] = builtinProviderDocumentSurfaces,
): string[] {
  const paths = descriptors.flatMap((descriptor) =>
    descriptor.surfaces.map((surface) => surface.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")),
  );
  return content.match(new RegExp(`@(?:${paths.join("|")})\\b`, "gu")) ?? [];
}
