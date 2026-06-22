/**
 * Core type definitions for agent-deploy
 * Version: 2.0
 */

/**
 * agent.json v2.0 specification
 */
export interface AgentJsonV2 {
  schema_version?: string;
  identity: {
    name: string;
    version: string;
    display_name?: string;
    description?: string;
    author?: string;
    license?: string;
    homepage?: string;
    repository?: string;
    tags?: string[];
  };
  instructions?: {
    format: "markdown" | "yaml" | "text";
    source: "inline" | "file";
    content?: string;
    file?: string;
  };
  capabilities?: string[];
  compatibility?: Record<string, any>;
  // PilotDeck format
  entry?: {
    main_subagent: string;
  };
  subagents?: Array<{
    name: string;
    path: string;
    description?: string;
  }>;
  category?: string;
  type?: string;
  /** Skills 数组 — Market Upload 时自动解析（Format B） */
  skills?: Array<{
    name: string;
    display_name?: string;
    description?: string;
    version?: string;
    category?: string;
    icon?: string;
  }>;
  /** MCP Servers 数组 — Market Upload 时自动解析（Format A1） */
  mcp_servers?: Array<{
    name: string;
    description?: string;
    command?: string;
    args?: string[];
    package?: string;
    tools?: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * Unified internal Agent representation
 */
export interface AgentDescriptor {
  name: string;
  displayName: string;
  version: string;
  description: string;
  instructions: string;
  capabilities: any[];
  compatibility: Record<string, any>;
  metadata: Record<string, any>;
}

/**
 * Result of adapting an agent to a target platform
 */
export interface AdaptationResult {
  content: string;
  target_file: string;
  format: string;
  append?: boolean;
  slug?: string;
}

/**
 * Tool detection result
 */
export interface ToolDetectionResult {
  tool: string;
  name: string;
  confidence: number;
  detected_by: string;
  path?: string;
}

/**
 * Installation result
 */
export interface InstallationResult {
  path: string;
  status: "success" | "error" | "dry-run";
  message?: string;
}
