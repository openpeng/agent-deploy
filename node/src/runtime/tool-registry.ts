import { Tool } from "./pipeline.js";

/**
 * Tool Registry with parent pointer for tool inheritance
 *
 * Supports hierarchical tool lookup:
 * - Child registry first checks its own tools
 * - If not found, checks parent registry
 * - Continues up the chain until found or reaches root
 *
 * This enables subagents to inherit parent agent's builtin tools
 * while still being able to register their own tools.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private parent?: ToolRegistry;

  /**
   * Create a new tool registry
   * @param parent Optional parent registry for tool inheritance
   */
  constructor(parent?: ToolRegistry) {
    this.parent = parent;
  }

  /**
   * Register a tool in this registry
   * @param tool Tool to register
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name, checking parent registries if not found locally
   * @param name Tool name
   * @returns Tool instance or undefined if not found
   */
  get(name: string): Tool | undefined {
    // Check local tools first
    const local = this.tools.get(name);
    if (local) {
      return local;
    }

    // Check parent if available
    if (this.parent) {
      return this.parent.get(name);
    }

    return undefined;
  }

  /**
   * Check if a tool exists in this registry or any parent
   * @param name Tool name
   * @returns true if tool exists
   */
  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /**
   * Get all tool names available in this registry (including inherited)
   * @returns Array of tool names
   */
  list(): string[] {
    const names = new Set<string>();

    // Add local tools
    for (const name of this.tools.keys()) {
      names.add(name);
    }

    // Add parent tools
    if (this.parent) {
      for (const name of this.parent.list()) {
        names.add(name);
      }
    }

    return Array.from(names);
  }

  /**
   * Get only the tools registered directly in this registry (not inherited)
   * @returns Array of tool names
   */
  listLocal(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Create a child registry that inherits tools from this registry
   * @returns New child registry
   */
  createChild(): ToolRegistry {
    return new ToolRegistry(this);
  }

  /**
   * Attach a registry to an execution context for tool inheritance
   */
  static attach(registry: ToolRegistry, context: any): void {
    context.__registry = registry;
  }

  /**
   * Retrieve a registry from an execution context
   * @returns ToolRegistry or undefined if not attached
   */
  static from(context: any): ToolRegistry | undefined {
    return context.__registry;
  }

  /**
   * Unregister a tool from this registry (does not affect parent)
   * @param name Tool name
   * @returns true if tool was removed, false if not found
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all tools from this registry (does not affect parent)
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get the parent registry
   * @returns Parent registry or undefined if this is root
   */
  getParent(): ToolRegistry | undefined {
    return this.parent;
  }
}
