import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MarketClient,
  uploadAgent,
  downloadAgent,
  searchAgents,
  getAgent,
  uploadTeam,
  downloadTeam,
  searchTeams,
  getTeam,
  uploadWorkflow,
  downloadWorkflow,
  searchWorkflows,
  getWorkflow,
  listLocalAgents,
  packDirectoryToTarGz,
} from "../src/market.js";
import fs from "fs";
import path from "path";
import os from "os";
import { ErrorHandlers } from "../src/errors.js";

// ============================================================
// Mocks
// ============================================================

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
      mkdirSync: vi.fn(),
      mkdtempSync: vi.fn(),
      readdirSync: vi.fn(),
      statSync: vi.fn(),
      promises: {
        readFile: vi.fn(),
      },
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
    },
  };
});

vi.mock("tar", () => ({
  create: vi.fn(),
  extract: vi.fn(),
}));

// ============================================================
// Helpers
// ============================================================

function mockResponse(options: {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<any>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  headers?: { get: (name: string) => string | null };
}): Response {
  return {
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 500),
    statusText: options.statusText ?? "Internal Server Error",
    json: options.json ?? (async () => ({})),
    arrayBuffer: options.arrayBuffer ?? (async () => new ArrayBuffer(0)),
    headers: options.headers ?? { get: () => null },
  } as Response;
}

function createMockAgentJson(name = "test-agent", version = "1.0.0") {
  return JSON.stringify({
    schema_version: "2.0",
    identity: {
      name,
      version,
      display_name: "Test Agent",
      description: "A test agent",
      author: "tester",
      tags: ["test"],
    },
  });
}

function createMockTeamJson(name = "test-team", version = "1.0.0") {
  return JSON.stringify({ name, version });
}

function createMockWorkflowJson(name = "test-workflow", version = "1.0.0") {
  return JSON.stringify({ name, version });
}

// ============================================================
// MarketClient Constructor
// ============================================================

describe("MarketClient constructor", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MARKET_API_URL;
    delete process.env.MARKET_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should use default URL when no config or env provided", () => {
    const client = new MarketClient({ baseUrl: "" });
    expect((client as any).baseUrl).toBe("http://localhost:8321");
    expect((client as any).apiKey).toBeUndefined();
  });

  it("should use config baseUrl when provided", () => {
    const client = new MarketClient({ baseUrl: "https://market.example.com" });
    expect((client as any).baseUrl).toBe("https://market.example.com");
  });

  it("should use env MARKET_API_URL when config baseUrl is empty", () => {
    process.env.MARKET_API_URL = "https://env-market.example.com";
    const client = new MarketClient({ baseUrl: "" });
    expect((client as any).baseUrl).toBe("https://env-market.example.com");
  });

  it("should use config apiKey when provided", () => {
    const client = new MarketClient({ baseUrl: "http://localhost:8321", apiKey: "config-key" });
    expect((client as any).apiKey).toBe("config-key");
  });

  it("should use env MARKET_API_KEY when config apiKey is not provided", () => {
    process.env.MARKET_API_KEY = "env-key";
    const client = new MarketClient({ baseUrl: "http://localhost:8321" });
    expect((client as any).apiKey).toBe("env-key");
  });

  it("should prefer config over env variables", () => {
    process.env.MARKET_API_URL = "https://env-market.example.com";
    process.env.MARKET_API_KEY = "env-key";
    const client = new MarketClient({ baseUrl: "https://config-market.example.com", apiKey: "config-key" });
    expect((client as any).baseUrl).toBe("https://config-market.example.com");
    expect((client as any).apiKey).toBe("config-key");
  });
});

// ============================================================
// uploadAgent
// ============================================================

describe("MarketClient.uploadAgent", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw missingAgentJson when agent.json does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(
      client.uploadAgent({ agentDir: "/fake/agent" })
    ).rejects.toThrow("agent.json not found");
  });

  it("should throw invalidAgentJson when agent.json is invalid JSON", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("agent.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue("not json");

    await expect(
      client.uploadAgent({ agentDir: "/fake/agent" })
    ).rejects.toThrow("Invalid agent.json");
  });

  it("should upload agent successfully", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    const packagePath = path.join(tmpDir, "test-agent-v1.0.0.tar.gz");

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return sp.endsWith("agent.json") || sp === packagePath;
    });
    vi.mocked(fs.readFileSync).mockReturnValue(createMockAgentJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ id: "test-agent", message: "Uploaded" }),
      })
    );

    const result = await client.uploadAgent({ agentDir: "/fake/agent" });

    expect(result.success).toBe(true);
    expect(result.agent_id).toBe("test-agent");
    expect(result.agent_name).toBe("test-agent");
    expect(result.version).toBe("1.0.0");
    expect(result.market_url).toBe("http://localhost:8321/agents/test-agent");
  });

  it("should throw authentication error on 401", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("agent.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(createMockAgentJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 401 }));

    await expect(
      client.uploadAgent({ agentDir: "/fake/agent" })
    ).rejects.toThrow("Authentication failed");
  });

  it("should throw conflict error on 409", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("agent.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(createMockAgentJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 409 }));

    await expect(
      client.uploadAgent({ agentDir: "/fake/agent" })
    ).rejects.toThrow("already exists");
  });

  it("should throw generic error on other HTTP errors", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("agent.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(createMockAgentJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ detail: "Server exploded" }),
      })
    );

    await expect(
      client.uploadAgent({ agentDir: "/fake/agent" })
    ).rejects.toThrow("Server exploded");
  });

  it("should use marketUrl and apiKey from options", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("agent.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(createMockAgentJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ id: "test-agent" }),
      })
    );

    await client.uploadAgent({
      agentDir: "/fake/agent",
      marketUrl: "https://custom.market.com",
      apiKey: "custom-key",
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe("https://custom.market.com/api/v1/agents");
    expect((fetchCall[1] as any).headers["Authorization"]).toBe("Bearer custom-key");
  });
});

// ============================================================
// downloadAgent
// ============================================================

describe("MarketClient.downloadAgent", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should download agent successfully", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-disposition" ? 'filename="test-agent-v1.0.0.tar.gz"' : null,
        },
        arrayBuffer: async () => {
          const buf = Buffer.from("fake-tar-gz-content");
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
      })
    );

    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => "");
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    const result = await client.downloadAgent({
      agentId: "test-agent",
      outputDir: "/fake/output",
    });

    expect(result.success).toBe(true);
    expect(result.agent_id).toBe("test-agent");
    expect(result.output_path).toBe(path.resolve("/fake/output/test-agent"));
  });

  it("should throw not found error on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 }));

    await expect(
      client.downloadAgent({ agentId: "missing-agent", outputDir: "/fake/output" })
    ).rejects.toThrow("Agent not found");
  });

  it("should throw generic error on other HTTP errors", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: false, status: 500, statusText: "Server Error" })
    );

    await expect(
      client.downloadAgent({ agentId: "test-agent", outputDir: "/fake/output" })
    ).rejects.toThrow("Download failed: Server Error");
  });
});

// ============================================================
// getAgent
// ============================================================

describe("MarketClient.getAgent", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get agent info successfully", async () => {
    const agentInfo = {
      id: "test-agent",
      name: "test-agent",
      display_name: "Test Agent",
      version: "1.0.0",
      description: "A test agent",
      author: "tester",
      category: "general",
      tags: ["test"],
      downloads: 100,
      rating: 4.5,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
    };

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => agentInfo,
      })
    );

    const result = await client.getAgent("test-agent");
    expect(result).toEqual(agentInfo);
  });

  it("should throw not found error on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 }));

    await expect(client.getAgent("missing-agent")).rejects.toThrow("Agent not found");
  });

  it("should throw generic error on other HTTP errors", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: false, status: 500, statusText: "Server Error" })
    );

    await expect(client.getAgent("test-agent")).rejects.toThrow("Failed to get agent: Server Error");
  });
});

// ============================================================
// searchAgents
// ============================================================

describe("MarketClient.searchAgents", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should build query params correctly", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({
          agents: [],
          total: 0,
          limit: 10,
          offset: 0,
        }),
      })
    );

    await client.searchAgents({
      query: "test",
      tag: "ai",
      category: "tools",
      limit: 10,
      offset: 5,
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const url = new URL(fetchCall[0] as string);
    expect(url.searchParams.get("q")).toBe("test");
    expect(url.searchParams.get("tag")).toBe("ai");
    expect(url.searchParams.get("category")).toBe("tools");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("5");
  });

  it("should parse search results correctly", async () => {
    const searchResult = {
      agents: [
        {
          id: "agent-1",
          name: "agent-1",
          display_name: "Agent One",
          version: "1.0.0",
          description: "First agent",
          author: "author1",
          category: "general",
          tags: ["tag1"],
          downloads: 10,
          rating: 4.0,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => searchResult,
      })
    );

    const result = await client.searchAgents({ query: "agent" });
    expect(result).toEqual(searchResult);
    expect(result.agents.length).toBe(1);
    expect(result.total).toBe(1);
  });

  it("should use marketUrl from options", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ agents: [], total: 0, limit: 50, offset: 0 }),
      })
    );

    await client.searchAgents({ marketUrl: "https://custom.market.com" });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toContain("https://custom.market.com/api/v1/agents");
  });

  it("should throw marketConnectionError on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    await expect(client.searchAgents({})).rejects.toThrow("Cannot connect to Market");
  });

  it("should throw search failed on HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: false, status: 500, statusText: "Server Error" })
    );

    await expect(client.searchAgents({})).rejects.toThrow("Search failed: Server Error");
  });
});

// ============================================================
// uploadTeam
// ============================================================

describe("MarketClient.uploadTeam", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw when team.json does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(
      client.uploadTeam({ teamDir: "/fake/team" })
    ).rejects.toThrow("team.json not found");
  });

  it("should throw when team.json is invalid", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("team.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue("not json");

    await expect(
      client.uploadTeam({ teamDir: "/fake/team" })
    ).rejects.toThrow("Invalid team.json");
  });

  it("should throw when team.json missing name/version", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("team.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

    await expect(
      client.uploadTeam({ teamDir: "/fake/team" })
    ).rejects.toThrow("team.json must contain 'name' and 'version' fields");
  });

  it("should upload team successfully", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return sp.endsWith("team.json") || sp === path.join(tmpDir, "test-team-v1.0.0.tar.gz");
    });
    vi.mocked(fs.readFileSync).mockReturnValue(createMockTeamJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ id: "test-team", message: "Uploaded" }),
      })
    );

    const result = await client.uploadTeam({ teamDir: "/fake/team" });

    expect(result.success).toBe(true);
    expect(result.team_id).toBe("test-team");
    expect(result.team_name).toBe("test-team");
    expect(result.version).toBe("1.0.0");
  });

  it("should throw authentication error on 401", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("team.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(createMockTeamJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 401 }));

    await expect(
      client.uploadTeam({ teamDir: "/fake/team" })
    ).rejects.toThrow("Authentication failed");
  });

  it("should throw conflict error on 409", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("team.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(createMockTeamJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 409 }));

    await expect(
      client.uploadTeam({ teamDir: "/fake/team" })
    ).rejects.toThrow("already exists");
  });
});

// ============================================================
// downloadTeam
// ============================================================

describe("MarketClient.downloadTeam", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should download team successfully", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-disposition" ? 'filename="test-team-v1.0.0.tar.gz"' : null,
        },
        arrayBuffer: async () => {
          const buf = Buffer.from("fake-tar-gz-content");
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
      })
    );

    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => "");
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    const result = await client.downloadTeam({
      teamId: "test-team",
      outputDir: "/fake/output",
    });

    expect(result.success).toBe(true);
    expect(result.team_id).toBe("test-team");
  });

  it("should throw not found error on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 }));

    await expect(
      client.downloadTeam({ teamId: "missing-team", outputDir: "/fake/output" })
    ).rejects.toThrow("Team not found");
  });

  it("should throw generic error on other HTTP errors", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: false, status: 500, statusText: "Server Error" })
    );

    await expect(
      client.downloadTeam({ teamId: "test-team", outputDir: "/fake/output" })
    ).rejects.toThrow("Download failed: Server Error");
  });
});

// ============================================================
// searchTeams
// ============================================================

describe("MarketClient.searchTeams", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should build query params correctly", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ teams: [], total: 0 }),
      })
    );

    await client.searchTeams({
      query: "test",
      tag: "ai",
      category: "tools",
      limit: 10,
      offset: 5,
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const url = new URL(fetchCall[0] as string);
    expect(url.searchParams.get("q")).toBe("test");
    expect(url.searchParams.get("tag")).toBe("ai");
    expect(url.searchParams.get("category")).toBe("tools");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("5");
  });

  it("should parse search results correctly", async () => {
    const searchResult = {
      teams: [
        {
          id: "team-1",
          name: "team-1",
          display_name: "Team One",
          version: "1.0.0",
          description: "First team",
          author: "author1",
          category: "general",
          type: "team",
          tags: ["tag1"],
          package_size: 1000,
          package_format: "tar.gz",
          package_sha256: "abc123",
          json_content: "{}",
          dependencies: [],
          download_count: 10,
          downloads: 10,
          rating: 4.0,
          rating_count: 2,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
      total: 1,
    };

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => searchResult,
      })
    );

    const result = await client.searchTeams({ query: "team" });
    expect(result).toEqual(searchResult);
    expect(result.teams.length).toBe(1);
    expect(result.total).toBe(1);
  });

  it("should throw marketConnectionError on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    await expect(client.searchTeams({})).rejects.toThrow("Cannot connect to Market");
  });
});

// ============================================================
// uploadWorkflow
// ============================================================

describe("MarketClient.uploadWorkflow", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw when workflow.json does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(
      client.uploadWorkflow({ workflowDir: "/fake/workflow" })
    ).rejects.toThrow("workflow.json not found");
  });

  it("should throw when workflow.json is invalid", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("workflow.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue("not json");

    await expect(
      client.uploadWorkflow({ workflowDir: "/fake/workflow" })
    ).rejects.toThrow("Invalid workflow.json");
  });

  it("should throw when workflow.json missing name/version", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("workflow.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

    await expect(
      client.uploadWorkflow({ workflowDir: "/fake/workflow" })
    ).rejects.toThrow("workflow.json must contain 'name' and 'version' fields");
  });

  it("should upload workflow successfully", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return sp.endsWith("workflow.json") || sp === path.join(tmpDir, "test-workflow-v1.0.0.tar.gz");
    });
    vi.mocked(fs.readFileSync).mockReturnValue(createMockWorkflowJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ id: "test-workflow", message: "Uploaded" }),
      })
    );

    const result = await client.uploadWorkflow({ workflowDir: "/fake/workflow" });

    expect(result.success).toBe(true);
    expect(result.workflow_id).toBe("test-workflow");
    expect(result.workflow_name).toBe("test-workflow");
    expect(result.version).toBe("1.0.0");
  });

  it("should throw authentication error on 401", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("workflow.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(createMockWorkflowJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 401 }));

    await expect(
      client.uploadWorkflow({ workflowDir: "/fake/workflow" })
    ).rejects.toThrow("Authentication failed");
  });

  it("should throw conflict error on 409", async () => {
    const tmpDir = "/tmp/agent-deploy-xxx";
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).endsWith("workflow.json")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(createMockWorkflowJson());
    vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 409 }));

    await expect(
      client.uploadWorkflow({ workflowDir: "/fake/workflow" })
    ).rejects.toThrow("already exists");
  });
});

// ============================================================
// downloadWorkflow
// ============================================================

describe("MarketClient.downloadWorkflow", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should download workflow successfully", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-disposition" ? 'filename="test-workflow-v1.0.0.tar.gz"' : null,
        },
        arrayBuffer: async () => {
          const buf = Buffer.from("fake-tar-gz-content");
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
      })
    );

    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => "");
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});

    const result = await client.downloadWorkflow({
      workflowId: "test-workflow",
      outputDir: "/fake/output",
    });

    expect(result.success).toBe(true);
    expect(result.workflow_id).toBe("test-workflow");
  });

  it("should throw not found error on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 }));

    await expect(
      client.downloadWorkflow({ workflowId: "missing-workflow", outputDir: "/fake/output" })
    ).rejects.toThrow("Workflow not found");
  });

  it("should throw generic error on other HTTP errors", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: false, status: 500, statusText: "Server Error" })
    );

    await expect(
      client.downloadWorkflow({ workflowId: "test-workflow", outputDir: "/fake/output" })
    ).rejects.toThrow("Download failed: Server Error");
  });
});

// ============================================================
// searchWorkflows
// ============================================================

describe("MarketClient.searchWorkflows", () => {
  const client = new MarketClient({ baseUrl: "http://localhost:8321" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should build query params correctly", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ workflows: [], total: 0 }),
      })
    );

    await client.searchWorkflows({
      query: "test",
      tag: "ai",
      category: "tools",
      limit: 10,
      offset: 5,
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const url = new URL(fetchCall[0] as string);
    expect(url.searchParams.get("q")).toBe("test");
    expect(url.searchParams.get("tag")).toBe("ai");
    expect(url.searchParams.get("category")).toBe("tools");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("5");
  });

  it("should parse search results correctly", async () => {
    const searchResult = {
      workflows: [
        {
          id: "workflow-1",
          name: "workflow-1",
          display_name: "Workflow One",
          version: "1.0.0",
          description: "First workflow",
          author: "author1",
          category: "general",
          type: "workflow",
          tags: ["tag1"],
          package_size: 1000,
          package_format: "tar.gz",
          package_sha256: "abc123",
          json_content: "{}",
          dependencies: [],
          download_count: 10,
          downloads: 10,
          rating: 4.0,
          rating_count: 2,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
      total: 1,
    };

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => searchResult,
      })
    );

    const result = await client.searchWorkflows({ query: "workflow" });
    expect(result).toEqual(searchResult);
    expect(result.workflows.length).toBe(1);
    expect(result.total).toBe(1);
  });

  it("should throw marketConnectionError on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    await expect(client.searchWorkflows({})).rejects.toThrow("Cannot connect to Market");
  });
});

// ============================================================
// Convenience functions
// ============================================================

describe("Convenience functions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MARKET_API_URL;
    delete process.env.MARKET_API_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("uploadAgent (convenience)", () => {
    it("should create client with default URL and call uploadAgent", async () => {
      const tmpDir = "/tmp/agent-deploy-xxx";
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const sp = String(p);
        return sp.endsWith("agent.json") || sp === path.join(tmpDir, "test-agent-v1.0.0.tar.gz");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(createMockAgentJson());
      vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => ({ id: "test-agent" }),
        })
      );

      const result = await uploadAgent({ agentDir: "/fake/agent" });
      expect(result.success).toBe(true);
    });
  });

  describe("downloadAgent (convenience)", () => {
    it("should create client with default URL and call downloadAgent", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          headers: {
            get: (name: string) =>
              name === "content-disposition" ? 'filename="test-agent-v1.0.0.tar.gz"' : null,
          },
          arrayBuffer: async () => {
            const buf = Buffer.from("fake-tar-gz-content");
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          },
        })
      );

      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => "");
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const result = await downloadAgent({ agentId: "test-agent", outputDir: "/fake/output" });
      expect(result.success).toBe(true);
    });
  });

  describe("searchAgents (convenience)", () => {
    it("should create client with default URL and call searchAgents", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => ({ agents: [], total: 0, limit: 50, offset: 0 }),
        })
      );

      const result = await searchAgents({ query: "test" });
      expect(result.total).toBe(0);
    });
  });

  describe("getAgent (convenience)", () => {
    it("should create client with marketUrl and call getAgent", async () => {
      const agentInfo = {
        id: "test-agent",
        name: "test-agent",
        display_name: "Test Agent",
        version: "1.0.0",
        description: "A test agent",
        author: "tester",
        category: "general",
        tags: ["test"],
        downloads: 100,
        rating: 4.5,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      };

      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => agentInfo,
        })
      );

      const result = await getAgent("test-agent", "https://custom.market.com");
      expect(result).toEqual(agentInfo);
    });
  });

  describe("uploadTeam (convenience)", () => {
    it("should create client with default URL and call uploadTeam", async () => {
      const tmpDir = "/tmp/agent-deploy-xxx";
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const sp = String(p);
        return sp.endsWith("team.json") || sp === path.join(tmpDir, "test-team-v1.0.0.tar.gz");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(createMockTeamJson());
      vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => ({ id: "test-team" }),
        })
      );

      const result = await uploadTeam({ teamDir: "/fake/team" });
      expect(result.success).toBe(true);
    });
  });

  describe("downloadTeam (convenience)", () => {
    it("should create client with default URL and call downloadTeam", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          headers: {
            get: (name: string) =>
              name === "content-disposition" ? 'filename="test-team-v1.0.0.tar.gz"' : null,
          },
          arrayBuffer: async () => {
            const buf = Buffer.from("fake-tar-gz-content");
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          },
        })
      );

      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => "");
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const result = await downloadTeam({ teamId: "test-team", outputDir: "/fake/output" });
      expect(result.success).toBe(true);
    });
  });

  describe("searchTeams (convenience)", () => {
    it("should create client with marketUrl and call searchTeams", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => ({ teams: [], total: 0 }),
        })
      );

      const result = await searchTeams({ query: "test" }, "https://custom.market.com");
      expect(result.total).toBe(0);
    });
  });

  describe("getTeam (convenience)", () => {
    it("should create client with marketUrl and call getTeam", async () => {
      const teamInfo = {
        id: "test-team",
        name: "test-team",
        display_name: "Test Team",
        version: "1.0.0",
        description: "A test team",
        author: "tester",
        category: "general",
        type: "team",
        tags: ["test"],
        package_size: 1000,
        package_format: "tar.gz",
        package_sha256: "abc123",
        json_content: "{}",
        dependencies: [],
        download_count: 10,
        downloads: 10,
        rating: 4.0,
        rating_count: 2,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => teamInfo,
        })
      );

      const result = await getTeam("test-team", "https://custom.market.com");
      expect(result).toEqual(teamInfo);
    });
  });

  describe("uploadWorkflow (convenience)", () => {
    it("should create client with default URL and call uploadWorkflow", async () => {
      const tmpDir = "/tmp/agent-deploy-xxx";
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const sp = String(p);
        return sp.endsWith("workflow.json") || sp === path.join(tmpDir, "test-workflow-v1.0.0.tar.gz");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(createMockWorkflowJson());
      vi.mocked(fs.mkdtempSync).mockReturnValue(tmpDir);
      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("tar-gz-content"));
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => ({ id: "test-workflow" }),
        })
      );

      const result = await uploadWorkflow({ workflowDir: "/fake/workflow" });
      expect(result.success).toBe(true);
    });
  });

  describe("downloadWorkflow (convenience)", () => {
    it("should create client with default URL and call downloadWorkflow", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          headers: {
            get: (name: string) =>
              name === "content-disposition" ? 'filename="test-workflow-v1.0.0.tar.gz"' : null,
          },
          arrayBuffer: async () => {
            const buf = Buffer.from("fake-tar-gz-content");
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          },
        })
      );

      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => "");
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const result = await downloadWorkflow({ workflowId: "test-workflow", outputDir: "/fake/output" });
      expect(result.success).toBe(true);
    });
  });

  describe("searchWorkflows (convenience)", () => {
    it("should create client with marketUrl and call searchWorkflows", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => ({ workflows: [], total: 0 }),
        })
      );

      const result = await searchWorkflows({ query: "test" }, "https://custom.market.com");
      expect(result.total).toBe(0);
    });
  });

  describe("getWorkflow (convenience)", () => {
    it("should create client with marketUrl and call getWorkflow", async () => {
      const workflowInfo = {
        id: "test-workflow",
        name: "test-workflow",
        display_name: "Test Workflow",
        version: "1.0.0",
        description: "A test workflow",
        author: "tester",
        category: "general",
        type: "workflow",
        tags: ["test"],
        package_size: 1000,
        package_format: "tar.gz",
        package_sha256: "abc123",
        json_content: "{}",
        dependencies: [],
        download_count: 10,
        downloads: 10,
        rating: 4.0,
        rating_count: 2,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      global.fetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: async () => workflowInfo,
        })
      );

      const result = await getWorkflow("test-workflow", "https://custom.market.com");
      expect(result).toEqual(workflowInfo);
    });
  });
});

// ============================================================
// packDirectoryToTarGz
// ============================================================

describe("packDirectoryToTarGz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw fileNotFound when directory does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(
      packDirectoryToTarGz("/fake/dir", "/fake/output", "base", "1.0.0")
    ).rejects.toThrow("directory not found");
  });

  it("should create output directory if not exists", async () => {
    const resolvedDir = path.resolve("/fake/dir");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return sp === resolvedDir;
    });
    vi.mocked(fs.mkdirSync).mockImplementation(() => "");

    const tar = await import("tar");
    vi.mocked(tar.create).mockResolvedValue(undefined as any);

    await packDirectoryToTarGz("/fake/dir", "/fake/output", "base", "1.0.0");

    expect(fs.mkdirSync).toHaveBeenCalledWith(path.resolve("/fake/output"), { recursive: true });
  });

  it("should return correct package path", async () => {
    const resolvedDir = path.resolve("/fake/dir");
    const resolvedOutput = path.resolve("/fake/output");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return sp === resolvedDir || sp === resolvedOutput;
    });

    const tar = await import("tar");
    vi.mocked(tar.create).mockResolvedValue(undefined as any);

    const result = await packDirectoryToTarGz("/fake/dir", "/fake/output", "base", "1.0.0");
    expect(result).toBe(path.resolve("/fake/output/base-v1.0.0.tar.gz"));
  });
});

// ============================================================
// listLocalAgents
// ============================================================

describe("listLocalAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty array when no directories exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await listLocalAgents();
    expect(result).toEqual([]);
  });

  it("should list agents from imported-agents directory", async () => {
    const mockDirent = {
      name: "test-agent",
      isDirectory: () => true,
    } as fs.Dirent;

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return sp.endsWith("imported-agents") || sp.endsWith("agent.json");
    });
    vi.mocked(fs.readdirSync).mockReturnValue([mockDirent] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        identity: {
          name: "test-agent",
          version: "1.0.0",
          display_name: "Test Agent",
          description: "A test agent",
          author: "tester",
          tags: ["test"],
        },
      })
    );
    vi.mocked(fs.statSync).mockReturnValue({
      birthtime: new Date("2024-01-01"),
      mtime: new Date("2024-01-02"),
    } as any);

    const result = await listLocalAgents({ type: "imported" });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("test-agent");
    expect(result[0].version).toBe("1.0.0");
  });

  it("should list agents from all directories", async () => {
    const mockDirent = {
      name: "test-agent",
      isDirectory: () => true,
    } as fs.Dirent;

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return (
        sp.endsWith("imported-agents") ||
        sp.endsWith("downloaded-agents") ||
        sp.endsWith("agents") ||
        sp.endsWith("agent.json")
      );
    });
    vi.mocked(fs.readdirSync).mockReturnValue([mockDirent] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        identity: {
          name: "test-agent",
          version: "1.0.0",
          display_name: "Test Agent",
          description: "A test agent",
          author: "tester",
          tags: ["test"],
        },
      })
    );
    vi.mocked(fs.statSync).mockReturnValue({
      birthtime: new Date("2024-01-01"),
      mtime: new Date("2024-01-02"),
    } as any);

    const result = await listLocalAgents({ type: "all" });
    expect(result.length).toBe(3);
  });

  it("should skip invalid agent.json files", async () => {
    const mockDirent = {
      name: "bad-agent",
      isDirectory: () => true,
    } as fs.Dirent;

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return sp.endsWith("imported-agents") || sp.endsWith("agent.json");
    });
    vi.mocked(fs.readdirSync).mockReturnValue([mockDirent] as any);
    vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

    const result = await listLocalAgents({ type: "imported" });
    expect(result).toEqual([]);
  });

  it("should skip non-directory entries", async () => {
    const mockDirent = {
      name: "file.txt",
      isDirectory: () => false,
    } as fs.Dirent;

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return sp.endsWith("imported-agents");
    });
    vi.mocked(fs.readdirSync).mockReturnValue([mockDirent] as any);

    const result = await listLocalAgents({ type: "imported" });
    expect(result).toEqual([]);
  });

  it("should use custom outputDir", async () => {
    const mockDirent = {
      name: "test-agent",
      isDirectory: () => true,
    } as fs.Dirent;

    const customAgentsDir = path.resolve("/custom", "agents");
    const customImportedDir = path.resolve("/custom", "imported-agents");
    const customDownloadedDir = path.resolve("/custom", "downloaded-agents");

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const sp = String(p);
      return (
        sp === customAgentsDir ||
        sp === customImportedDir ||
        sp === customDownloadedDir ||
        sp.endsWith("agent.json")
      );
    });
    vi.mocked(fs.readdirSync).mockReturnValue([mockDirent] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        identity: {
          name: "test-agent",
          version: "1.0.0",
          display_name: "Test Agent",
          description: "A test agent",
          author: "tester",
          tags: ["test"],
        },
      })
    );
    vi.mocked(fs.statSync).mockReturnValue({
      birthtime: new Date("2024-01-01"),
      mtime: new Date("2024-01-02"),
    } as any);

    const result = await listLocalAgents({ outputDir: "/custom" });
    expect(result.length).toBe(3);
  });
});
