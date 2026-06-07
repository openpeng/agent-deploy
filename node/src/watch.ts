/**
 * Watch mode for agent-deploy run command.
 *
 * Watches agent directory for file changes and re-executes the pipeline.
 * Uses Node.js native fs.watch for maximum compatibility.
 */
import * as fs from "fs";
import * as path from "path";

export interface WatchOptions {
  /** Agent directory to watch */
  dir: string;
  /** Callback when a change is detected */
  onChange: (changedFile: string) => Promise<void>;
  /** Patterns to exclude from watching */
  excludePatterns?: RegExp[];
  /** Debounce in ms (default: 500) */
  debounceMs?: number;
}

const DEFAULT_EXCLUDE = [
  /node_modules/,
  /\.git\//,
  /dist\//,
  /\.cache\//,
];

export class FileWatcher {
  private options: WatchOptions;
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private pendingChange: string | null = null;

  constructor(options: WatchOptions) {
    this.options = {
      debounceMs: 500,
      excludePatterns: [],
      ...options,
    };
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.watchDirectory(this.options.dir);
    console.log(`[WATCH] Watching for changes in ${this.options.dir}`);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    console.log("[WATCH] Stopped watching");
  }

  private watchDirectory(dir: string): void {
    const excludes = [...DEFAULT_EXCLUDE, ...(this.options.excludePatterns || [])];

    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename || !this.isRunning) return;

        const fullPath = path.join(dir, filename);

        // Check exclusions
        for (const pattern of excludes) {
          if (pattern.test(fullPath)) return;
        }

        // Only trigger on relevant file changes
        if (!this.isRelevantFile(filename)) return;

        this.onFileChange(fullPath);
      });

      this.watchers.push(watcher);
    } catch (error) {
      console.warn(`[WATCH] Failed to watch directory ${dir}: ${(error as Error).message}`);

      // Fall back to non-recursive watch
      try {
        const fallback = fs.watch(dir, (eventType, filename) => {
          if (!filename || !this.isRunning) return;
          const fullPath = path.join(dir, filename);
          if (!this.isRelevantFile(filename)) return;
          this.onFileChange(fullPath);
        });
        this.watchers.push(fallback);
      } catch {
        // Give up
      }
    }
  }

  private isRelevantFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return [".yaml", ".yml", ".json", ".md", ".ts", ".js"].includes(ext);
  }

  private onFileChange(changedFile: string): void {
    this.pendingChange = changedFile;

    // Debounce: wait for file writes to settle
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      const file = this.pendingChange!;
      this.pendingChange = null;
      console.log(`\n[WATCH] Change detected: ${path.relative(this.options.dir, file)}`);
      try {
        await this.options.onChange(file);
      } catch (error) {
        console.error(`[WATCH] Error during re-run: ${(error as Error).message}`);
      }
    }, this.options.debounceMs || 500);
  }
}
