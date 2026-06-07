/**
 * Memory System Integration
 *
 * Provides persistent key-value memory for agents across pipeline executions.
 * Storage backend: JSON files under <agentDir>/.memory/
 *
 * Pipeline usage:
 *   - step: save
 *     tool: memory
 *     args:
 *       operation: set
 *       key: last_file
 *       value: "{{file_path}}"
 *
 *   - step: recall
 *     tool: memory
 *     args:
 *       operation: get
 *       key: last_file
 *     output: previous_file
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  key: string;
  value: any;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface MemoryQuery {
  key?: string;
  pattern?: string;
  tags?: string[];
  since?: number;
  limit?: number;
}

export interface MemoryStore {
  set(key: string, value: any, metadata?: Record<string, any>): Promise<void>;
  get(key: string): Promise<any>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// FileMemoryStore
// ---------------------------------------------------------------------------

export class FileMemoryStore implements MemoryStore {
  private memoryDir: string;

  constructor(agentDir: string) {
    // Per-agent memory under <agentDir>/.memory/
    this.memoryDir = path.join(agentDir, ".memory");
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  // Sanitise key → safe filename: replace path separators and dots
  private keyToFile(key: string): string {
    return path.join(this.memoryDir, key.replace(/[/\\:*?"<>|]/g, "_") + ".json");
  }

  async set(key: string, value: any, metadata?: Record<string, any>): Promise<void> {
    this.ensureDir();
    const entry: MemoryEntry = { key, value, timestamp: Date.now(), metadata };
    fs.writeFileSync(this.keyToFile(key), JSON.stringify(entry, null, 2), "utf-8");
  }

  async get(key: string): Promise<any> {
    const file = this.keyToFile(key);
    if (!fs.existsSync(file)) return undefined;
    const entry: MemoryEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    return entry.value;
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!fs.existsSync(this.memoryDir)) return [];

    let entries: MemoryEntry[] = [];

    for (const file of fs.readdirSync(this.memoryDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const entry: MemoryEntry = JSON.parse(
          fs.readFileSync(path.join(this.memoryDir, file), "utf-8")
        );

        // Filter by exact key
        if (query.key && entry.key !== query.key) continue;

        // Filter by glob-style pattern (only * wildcard supported)
        if (query.pattern) {
          const re = new RegExp("^" + query.pattern.replace(/\*/g, ".*") + "$");
          if (!re.test(entry.key)) continue;
        }

        // Filter by since timestamp
        if (query.since && entry.timestamp < query.since) continue;

        // Filter by tags (stored in metadata.tags)
        if (query.tags && query.tags.length > 0) {
          const entryTags: string[] = entry.metadata?.tags || [];
          if (!query.tags.every(t => entryTags.includes(t))) continue;
        }

        entries.push(entry);
      } catch {
        // Skip corrupted entries
      }
    }

    // Sort newest-first
    entries.sort((a, b) => b.timestamp - a.timestamp);

    if (query.limit && query.limit > 0) {
      entries = entries.slice(0, query.limit);
    }

    return entries;
  }

  async delete(key: string): Promise<void> {
    const file = this.keyToFile(key);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  async clear(): Promise<void> {
    if (!fs.existsSync(this.memoryDir)) return;
    for (const file of fs.readdirSync(this.memoryDir)) {
      if (file.endsWith(".json")) {
        fs.unlinkSync(path.join(this.memoryDir, file));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MemoryTool — single tool exposing all operations
// ---------------------------------------------------------------------------

export class MemoryTool {
  readonly name = "memory";
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  async execute(
    args: {
      operation: "set" | "get" | "query" | "delete" | "clear";
      key?: string;
      value?: any;
      query?: MemoryQuery;
      metadata?: Record<string, any>;
    },
    _context: any
  ): Promise<any> {
    switch (args.operation) {
      case "set": {
        if (!args.key || args.value === undefined) {
          throw new Error("memory: 'key' and 'value' are required for set");
        }
        await this.store.set(args.key, args.value, args.metadata);
        return { success: true, key: args.key };
      }

      case "get": {
        if (!args.key) throw new Error("memory: 'key' is required for get");
        const value = await this.store.get(args.key);
        return { value, found: value !== undefined };
      }

      case "query": {
        const results = await this.store.query(args.query || {});
        return { results, count: results.length };
      }

      case "delete": {
        if (!args.key) throw new Error("memory: 'key' is required for delete");
        await this.store.delete(args.key);
        return { success: true, key: args.key };
      }

      case "clear": {
        await this.store.clear();
        return { success: true };
      }

      default:
        throw new Error(`memory: unknown operation '${(args as any).operation}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helper used by CLI
// ---------------------------------------------------------------------------

/**
 * Create and register a MemoryTool bound to the agent's directory.
 */
export function registerMemoryTool(agentDir: string, registry: any): void {
  const store = new FileMemoryStore(agentDir);
  registry.register(new MemoryTool(store));
}
