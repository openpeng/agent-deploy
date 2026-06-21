import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";
import { getPolicyRegistry } from "../policy.js";

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

interface GoogleSearchItem {
  title: string;
  link: string;
  snippet?: string;
}

interface BingWebPage {
  name: string;
  url: string;
  snippet?: string;
}

interface BingSearchResponse {
  error?: { message?: string };
  webPages?: { value?: BingWebPage[] };
}

interface GoogleSearchResponse {
  error?: { message?: string };
  items?: GoogleSearchItem[];
}

/**
 * Web Search tool
 * Searches the web using search engine APIs
 *
 * Supports:
 * - DuckDuckGo (default, no API key required)
 * - Google Custom Search API
 * - Bing Search API
 */
export class WebSearchTool implements Tool {
  name = "web_search";

  async execute(
    args: {
      query: string;
      engine?: "duckduckgo" | "google" | "bing";
      max_results?: number;
      api_key?: string;
      search_engine_id?: string; // For Google CSE
      language?: string;
      region?: string;
    },
    context: ExecutionContext
  ): Promise<{
    results: SearchResultItem[];
    query: string;
    engine: string;
  }> {
    // Validate args
    if (!args.query) {
      throw new Error("web_search: 'query' parameter is required");
    }

    // Policy check
    const agentName = context.agent?.identity?.name || context.agent?.name || "unknown";
    const policy = getPolicyRegistry().get(agentName);
    if (!policy.allowWebSearch) {
      throw new Error(
        `web_search: Web search is blocked by security policy. ` +
        `Agent '${agentName}' policy level: ${policy.level}. ` +
        `Use --policy-level standard or trusted to allow web search.`
      );
    }

    const engine = args.engine || "duckduckgo";
    const maxResults = args.max_results || 10;

    try {
      let results: SearchResultItem[] = [];

      switch (engine) {
        case "duckduckgo":
          results = await this.searchDuckDuckGo(
            args.query,
            maxResults,
            args.region
          );
          break;

        case "google":
          results = await this.searchGoogle(
            args.query,
            maxResults,
            args.api_key || context.env.GOOGLE_SEARCH_API_KEY,
            args.search_engine_id || context.env.GOOGLE_SEARCH_ENGINE_ID,
            args.language,
            args.region
          );
          break;

        case "bing":
          results = await this.searchBing(
            args.query,
            maxResults,
            args.api_key || context.env.BING_SEARCH_API_KEY,
            args.language,
            args.region
          );
          break;

        default:
          throw new Error(`web_search: Unknown search engine: ${engine}`);
      }

      return {
        results,
        query: args.query,
        engine,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`web_search: Search failed: ${msg}`);
    }
  }

  private async searchDuckDuckGo(
    query: string,
    maxResults: number,
    region?: string
  ): Promise<SearchResultItem[]> {
    // DuckDuckGo Instant Answer API (HTML scraping alternative)
    // Note: DuckDuckGo doesn't have an official API, using HTML fallback
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.append("q", query);
    if (region) {
      url.searchParams.append("kl", region);
    }

    const https = await import("https");

    return new Promise((resolve, reject) => {
      https.get(url.toString(), { headers: { "User-Agent": "agent-deploy/1.0" } }, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            // Simple HTML parsing for results
            const results = this.parseDuckDuckGoHTML(data, maxResults);
            resolve(results);
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            reject(new Error(`Failed to parse DuckDuckGo results: ${msg}`));
          }
        });

        res.on("error", reject);
      }).on("error", reject);
    });
  }

  private parseDuckDuckGoHTML(
    html: string,
    maxResults: number
  ): SearchResultItem[] {
    const results: SearchResultItem[] = [];

    // Simple regex-based parsing (not production-ready, just for demo)
    // In production, use a proper HTML parser like cheerio
    const resultRegex = /<div class="result[^"]*">[\s\S]*?<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match: RegExpExecArray | null;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const url = this.decodeHtmlEntities(match[1]);
      const title = this.stripHtmlTags(match[2]);
      const snippet = this.stripHtmlTags(match[3]);

      if (url && title && snippet) {
        results.push({ title, url, snippet });
      }
    }

    return results;
  }

  private async searchGoogle(
    query: string,
    maxResults: number,
    apiKey?: string,
    searchEngineId?: string,
    language?: string,
    region?: string
  ): Promise<SearchResultItem[]> {
    if (!apiKey || !searchEngineId) {
      throw new Error(
        "Google Search requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables"
      );
    }

    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.append("key", apiKey);
    url.searchParams.append("cx", searchEngineId);
    url.searchParams.append("q", query);
    url.searchParams.append("num", Math.min(maxResults, 10).toString());

    if (language) {
      url.searchParams.append("lr", `lang_${language}`);
    }
    if (region) {
      url.searchParams.append("gl", region);
    }

    const https = await import("https");

    return new Promise((resolve, reject) => {
      https.get(url.toString(), (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const parsed = JSON.parse(data) as GoogleSearchResponse;

            if (parsed.error) {
              reject(new Error(parsed.error.message || "Google Search error"));
              return;
            }

            const results = (parsed.items || []).map((item) => ({
              title: item.title,
              url: item.link,
              snippet: item.snippet || "",
            }));

            resolve(results);
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            reject(new Error(`Failed to parse Google results: ${msg}`));
          }
        });

        res.on("error", reject);
      }).on("error", reject);
    });
  }

  private async searchBing(
    query: string,
    maxResults: number,
    apiKey?: string,
    language?: string,
    region?: string
  ): Promise<SearchResultItem[]> {
    if (!apiKey) {
      throw new Error("Bing Search requires BING_SEARCH_API_KEY environment variable");
    }

    const url = new URL("https://api.bing.microsoft.com/v7.0/search");
    url.searchParams.append("q", query);
    url.searchParams.append("count", Math.min(maxResults, 50).toString());

    if (language) {
      url.searchParams.append("setLang", language);
    }
    if (region) {
      url.searchParams.append("mkt", region);
    }

    const https = await import("https");

    return new Promise((resolve, reject) => {
      const req = https.get(
        url.toString(),
        {
          headers: {
            "Ocp-Apim-Subscription-Key": apiKey,
          },
        },
        (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            try {
              const parsed = JSON.parse(data) as BingSearchResponse;

              if (parsed.error) {
                reject(new Error(parsed.error.message || "Bing Search error"));
                return;
              }

              const results = (parsed.webPages?.value || []).map((item) => ({
                title: item.name,
                url: item.url,
                snippet: item.snippet || "",
              }));

              resolve(results);
            } catch (error: unknown) {
              const msg = error instanceof Error ? error.message : String(error);
              reject(new Error(`Failed to parse Bing results: ${msg}`));
            }
          });

          res.on("error", reject);
        }
      );

      req.on("error", reject);
    });
  }

  private stripHtmlTags(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
}
