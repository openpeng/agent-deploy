import { Tool } from "./pipeline.js";
import { ExecutionContext } from "./types.js";

/**
 * Tool registry - manages available tools for pipeline execution
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private parent: ToolRegistry | null = null;

  /**
   * Register a tool
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    const tool = this.tools.get(name);
    if (tool) return tool;
    if (this.parent) return this.parent.get(name);
    return undefined;
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name) || (this.parent?.has(name) ?? false);
  }

  /**
   * List all registered tool names
   */
  list(): string[] {
    const parentTools = this.parent?.list() ?? [];
    return [...new Set([...parentTools, ...this.tools.keys()])];
  }

  /**
   * Remove a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get count of registered tools
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Create a child registry that inherits from this one
   */
  createChild(): ToolRegistry {
    const child = new ToolRegistry();
    child.parent = this;
    return child;
  }

  /**
   * Attach a ToolRegistry to an ExecutionContext for nested invoke_agent calls.
   */
  static attach(registry: ToolRegistry, context: ExecutionContext): void {
    (context as unknown as Record<string, unknown>).__tool_registry = registry;
  }

  /**
   * Retrieve a ToolRegistry from an ExecutionContext.
   */
  static from(context: ExecutionContext): ToolRegistry | null {
    return ((context as unknown as Record<string, unknown>).__tool_registry as ToolRegistry | undefined) || null;
  }
}
