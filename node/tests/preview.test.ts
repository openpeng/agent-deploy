/**
 * Tests for preview module
 */

import {
  previewPipeline,
  formatPipelinePreview,
  generateMermaidDiagram,
  dryRunPipeline,
  formatDryRunResult,
} from "../src/preview.js";

describe("previewPipeline", () => {
  const basicWorkerYaml = {
    pipeline: [
      { step: "search", tool: "web_search", args: { query: "test" }, output: "results" },
      { step: "summarize", tool: "llm_chat", args: { prompt: "${results}" } },
    ],
  };

  test("generates step previews", () => {
    const previews = previewPipeline(basicWorkerYaml);
    expect(previews.length).toBe(2);
    expect(previews[0].name).toBe("search");
    expect(previews[0].tool).toBe("web_search");
    expect(previews[0].outputs).toEqual(["results"]);
    expect(previews[0].inputs).toEqual([]);
  });

  test("detects input variable references", () => {
    const previews = previewPipeline(basicWorkerYaml);
    expect(previews[1].inputs).toEqual(["results"]);
  });

  test("handles invoke step", () => {
    const yaml = {
      pipeline: [
        { step: "delegate", invoke: "sub-agent-1" },
      ],
    };
    const previews = previewPipeline(yaml);
    expect(previews[0].tool).toBe("invoke:sub-agent-1");
    expect(previews[0].description).toContain("sub-agent-1");
  });

  test("handles parallel invoke", () => {
    const yaml = {
      pipeline: [
        {
          step: "parallel",
          invoke_parallel: [
            { agent: "agent-a" },
            { agent: "agent-b" },
          ],
        },
      ],
    };
    const previews = previewPipeline(yaml);
    expect(previews[0].tool).toBe("invoke_parallel");
    expect(previews[0].description).toContain("2 agents");
  });

  test("handles conditional step", () => {
    const yaml = {
      pipeline: [
        { step: "conditional", tool: "bash", when: "${need_run} == true" },
      ],
    };
    const previews = previewPipeline(yaml);
    expect(previews[0].has_condition).toBe(true);
    expect(previews[0].condition).toBe("${need_run} == true");
  });

  test("handles on_fail", () => {
    const yaml = {
      pipeline: [
        { step: "risky", tool: "bash", on_fail: "skip" },
      ],
    };
    const previews = previewPipeline(yaml);
    expect(previews[0].on_fail).toBe("skip");
  });
});

describe("formatPipelinePreview", () => {
  test("formats text output", () => {
    const yaml = {
      pipeline: [
        { step: "search", tool: "web_search", output: "results" },
      ],
    };
    const previews = previewPipeline(yaml);
    const output = formatPipelinePreview(previews);
    expect(output).toContain("Pipeline Execution Preview");
    expect(output).toContain("Step 1: search");
    expect(output).toContain("web_search");
    expect(output).toContain("Total: 1 step(s)");
  });
});

describe("generateMermaidDiagram", () => {
  test("generates valid mermaid syntax", () => {
    const yaml = {
      pipeline: [
        { step: "search", tool: "web_search", output: "results" },
        { step: "summarize", tool: "llm_chat" },
      ],
    };
    const diagram = generateMermaidDiagram(yaml);
    expect(diagram).toContain("flowchart TD");
    expect(diagram).toContain("START");
    expect(diagram).toContain("END");
    expect(diagram).toContain("step0");
    expect(diagram).toContain("step1");
    expect(diagram).toContain("search");
    expect(diagram).toContain("summarize");
  });

  test("handles conditional steps", () => {
    const yaml = {
      pipeline: [
        { step: "a", tool: "bash", when: "condition" },
        { step: "b", tool: "bash" },
      ],
    };
    const diagram = generateMermaidDiagram(yaml);
    expect(diagram).toContain("condition");
  });

  test("handles empty pipeline", () => {
    const yaml = { pipeline: [] };
    const diagram = generateMermaidDiagram(yaml);
    expect(diagram).toContain("flowchart TD");
    expect(diagram).toContain("START");
    expect(diagram).toContain("END");
  });
});

describe("dryRunPipeline", () => {
  test("simulates basic pipeline", () => {
    const yaml = {
      pipeline: [
        { step: "search", tool: "web_search", args: { query: "test" }, output: "results" },
        { step: "summarize", tool: "llm_chat", args: { prompt: "${results}" } },
      ],
    };
    const results = dryRunPipeline(yaml);
    expect(results.length).toBe(2);
    expect(results[0].step).toBe("search");
    expect(results[0].status).toBe("simulated");
    expect(results[0].simulated_output).toEqual({ results: expect.any(String) });
  });

  test("resolves variable references", () => {
    const yaml = {
      pipeline: [
        { step: "set_var", tool: "bash", args: { cmd: "echo hello" }, output: "greeting" },
        { step: "use_var", tool: "bash", args: { cmd: "say ${greeting}" } },
      ],
    };
    const results = dryRunPipeline(yaml);
    // The simulated output is a placeholder string, not "hello"
    // But the variable reference should be resolved to the placeholder
    expect(results[1].simulated_input.cmd).toContain("simulated output");
    expect(results[1].simulated_input.cmd).not.toContain("${greeting}");
  });

  test("uses shared_context for variable resolution", () => {
    const yaml = {
      shared_context: { base_dir: "/tmp" },
      pipeline: [
        { step: "list", tool: "bash", args: { cmd: "ls ${base_dir}" } },
      ],
    };
    const results = dryRunPipeline(yaml);
    expect(results[0].simulated_input.cmd).toBe("ls /tmp");
  });
});

describe("formatDryRunResult", () => {
  test("formats dry-run output", () => {
    const yaml = {
      pipeline: [
        { step: "search", tool: "web_search", output: "results" },
      ],
    };
    const results = dryRunPipeline(yaml);
    const output = formatDryRunResult(results);
    expect(output).toContain("Pipeline Dry-Run Results");
    expect(output).toContain("Step: search");
    expect(output).toContain("simulated");
    expect(output).toContain("Total: 1 step(s) simulated");
  });
});
