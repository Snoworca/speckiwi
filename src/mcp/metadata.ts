export interface PackageInfo {
  name: string;
  version: string;
}

export interface McpServerMetadata {
  name: string;
  version: string;
  capabilities: { tools: true; resources: true };
}

export function getServerMetadata(pkg: PackageInfo): McpServerMetadata {
  return { name: pkg.name, version: pkg.version, capabilities: { tools: true, resources: true } };
}
