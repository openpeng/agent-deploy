import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/runtime/tool-registry.js";
import { Tool } from "../../src/runtime/pipeline.js";
import { ExecutionContext } from "../../src/runtime/types.js";

// Mock tools for testing
class MockTool implements Tool {
  constructor(public name: string) {}

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return { tool: this.name, args };
  }
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("basic operations", () => {
    it("should register and retrieve a tool", () => {
      const tool = new MockTool("test_tool");
      registry.register(tool);

      const retrieved = registry.get("test_tool");
      expect(retrieved).toBe(tool);
    });

    it("should return undefined for non-existent tool", () => {
      const retrieved = registry.get("non_existent");
      expect(retrieved).toBeUndefined();
    });

    it("should check if tool exists", () => {
      const tool = new MockTool("test_tool");
      registry.register(tool);

      expect(registry.has("test_tool")).toBe(true);
      expect(registry.has("non_existent")).toBe(false);
    });

    it("should list registered tools", () => {
      registry.register(new MockTool("tool1"));
      registry.register(new MockTool("tool2"));
      registry.register(new MockTool("tool3"));

      const tools = registry.list();
      expect(tools).toHaveLength(3);
      expect(tools).toContain("tool1");
      expect(tools).toContain("tool2");
      expect(tools).toContain("tool3");
    });

    it("should list only local tools", () => {
      registry.register(new MockTool("tool1"));
      registry.register(new MockTool("tool2"));

      const tools = registry.listLocal();
      expect(tools).toHaveLength(2);
      expect(tools).toContain("tool1");
      expect(tools).toContain("tool2");
    });

    it("should unregister a tool", () => {
      const tool = new MockTool("test_tool");
      registry.register(tool);

      expect(registry.has("test_tool")).toBe(true);

      const removed = registry.unregister("test_tool");
      expect(removed).toBe(true);
      expect(registry.has("test_tool")).toBe(false);
    });

    it("should return false when unregistering non-existent tool", () => {
      const removed = registry.unregister("non_existent");
      expect(removed).toBe(false);
    });

    it("should clear all tools", () => {
      registry.register(new MockTool("tool1"));
      registry.register(new MockTool("tool2"));

      expect(registry.list()).toHaveLength(2);

      registry.clear();
      expect(registry.list()).toHaveLength(0);
    });
  });

  describe("tool inheritance", () => {
    it("should create child registry", () => {
      const child = registry.createChild();
      expect(child).toBeInstanceOf(ToolRegistry);
      expect(child.getParent()).toBe(registry);
    });

    it("should inherit parent tools", () => {
      registry.register(new MockTool("parent_tool"));

      const child = registry.createChild();
      expect(child.has("parent_tool")).toBe(true);
      expect(child.get("parent_tool")).toBe(registry.get("parent_tool"));
    });

    it("should list inherited tools", () => {
      registry.register(new MockTool("parent_tool"));
      const child = registry.createChild();

      const tools = child.list();
      expect(tools).toContain("parent_tool");
    });

    it("should distinguish local and inherited tools", () => {
      registry.register(new MockTool("parent_tool"));
      const child = registry.createChild();
      child.register(new MockTool("child_tool"));

      const allTools = child.list();
      expect(allTools).toHaveLength(2);
      expect(allTools).toContain("parent_tool");
      expect(allTools).toContain("child_tool");

      const localTools = child.listLocal();
      expect(localTools).toHaveLength(1);
      expect(localTools).toContain("child_tool");
      expect(localTools).not.toContain("parent_tool");
    });

    it("should not affect parent when registering in child", () => {
      const child = registry.createChild();
      child.register(new MockTool("child_tool"));

      expect(child.has("child_tool")).toBe(true);
      expect(registry.has("child_tool")).toBe(false);
    });

    it("should support multi-level inheritance", () => {
      registry.register(new MockTool("root_tool"));

      const child = registry.createChild();
      child.register(new MockTool("child_tool"));

      const grandchild = child.createChild();
      grandchild.register(new MockTool("grandchild_tool"));

      // Grandchild can access all tools
      expect(grandchild.has("root_tool")).toBe(true);
      expect(grandchild.has("child_tool")).toBe(true);
      expect(grandchild.has("grandchild_tool")).toBe(true);

      // Child can access parent tools
      expect(child.has("root_tool")).toBe(true);
      expect(child.has("child_tool")).toBe(true);
      expect(child.has("grandchild_tool")).toBe(false);

      // Root can only access its own tools
      expect(registry.has("root_tool")).toBe(true);
      expect(registry.has("child_tool")).toBe(false);
      expect(registry.has("grandchild_tool")).toBe(false);
    });

    it("should allow child to override parent tool", () => {
      const parentTool = new MockTool("shared_tool");
      registry.register(parentTool);

      const child = registry.createChild();
      const childTool = new MockTool("shared_tool");
      child.register(childTool);

      // Child should get its own version
      expect(child.get("shared_tool")).toBe(childTool);
      expect(child.get("shared_tool")).not.toBe(parentTool);

      // Parent should still have original
      expect(registry.get("shared_tool")).toBe(parentTool);
    });

    it("should not affect parent when clearing child", () => {
      registry.register(new MockTool("parent_tool"));
      const child = registry.createChild();
      child.register(new MockTool("child_tool"));

      child.clear();

      // Child local tools cleared
      expect(child.listLocal()).toHaveLength(0);

      // But can still access parent tools
      expect(child.has("parent_tool")).toBe(true);

      // Parent unaffected
      expect(registry.has("parent_tool")).toBe(true);
    });

    it("should not affect parent when unregistering in child", () => {
      const parentTool = new MockTool("shared_tool");
      registry.register(parentTool);

      const child = registry.createChild();
      const childTool = new MockTool("shared_tool");
      child.register(childTool);

      // Unregister from child
      child.unregister("shared_tool");

      // Child should now see parent's tool
      expect(child.get("shared_tool")).toBe(parentTool);

      // Parent unaffected
      expect(registry.get("shared_tool")).toBe(parentTool);
    });
  });

  describe("root registry", () => {
    it("should have no parent for root registry", () => {
      expect(registry.getParent()).toBeUndefined();
    });

    it("should return child parent correctly", () => {
      const child = registry.createChild();
      expect(child.getParent()).toBe(registry);
    });
  });

  describe("edge cases", () => {
    it("should handle registering same tool twice", () => {
      const tool1 = new MockTool("test");
      const tool2 = new MockTool("test");

      registry.register(tool1);
      registry.register(tool2);

      // Should use the latest registered
      expect(registry.get("test")).toBe(tool2);
    });

    it("should handle empty registry", () => {
      expect(registry.list()).toHaveLength(0);
      expect(registry.listLocal()).toHaveLength(0);
      expect(registry.has("anything")).toBe(false);
    });

    it("should handle deep inheritance chains", () => {
      let current = registry;
      current.register(new MockTool("level0"));

      // Create 10 levels deep
      for (let i = 1; i <= 10; i++) {
        current = current.createChild();
        current.register(new MockTool(`level${i}`));
      }

      // Deepest child should access all tools
      for (let i = 0; i <= 10; i++) {
        expect(current.has(`level${i}`)).toBe(true);
      }

      // Should list all 11 tools
      expect(current.list()).toHaveLength(11);
    });
  });
});
