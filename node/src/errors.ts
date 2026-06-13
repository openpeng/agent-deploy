/**
 * Error Handling Utilities
 *
 * Provides consistent, user-friendly error messages and recovery suggestions
 */

export interface ErrorContext {
  command: string;
  operation: string;
  details?: Record<string, any>;
}

export interface ErrorSuggestion {
  message: string;
  actions: string[];
  link?: string;
}

/**
 * Enhanced error with user-friendly message and suggestions
 */
export class UserFriendlyError extends Error {
  constructor(
    message: string,
    public suggestions: string[] = [],
    public context?: ErrorContext
  ) {
    super(message);
    this.name = 'UserFriendlyError';
  }
}

/**
 * Format error message with suggestions
 */
export function formatError(error: Error | string, suggestions: string[] = []): string {
  const message = error instanceof Error ? error.message : error;

  let output = `❌ Error: ${message}\n`;

  if (suggestions.length > 0) {
    output += '\n💡 Suggestions:\n';
    suggestions.forEach((suggestion, idx) => {
      output += `   ${idx + 1}. ${suggestion}\n`;
    });
  }

  return output;
}

/**
 * Common error handlers
 */
export const ErrorHandlers = {
  /**
   * File not found error
   */
  fileNotFound(path: string, fileType: string = 'file'): UserFriendlyError {
    return new UserFriendlyError(
      `${fileType} not found: ${path}`,
      [
        `Check the path is correct: ${path}`,
        `Make sure the ${fileType} exists`,
        `Try using an absolute path instead of relative path`,
      ]
    );
  },

  /**
   * Missing agent.json error
   */
  missingAgentJson(dir: string): UserFriendlyError {
    return new UserFriendlyError(
      `agent.json not found in: ${dir}`,
      [
        `Make sure the directory contains a valid agent.json file`,
        `Run 'agent-deploy import' to create agent.json from an AI tool format`,
        `Check the agent.json file is not corrupted`,
      ]
    );
  },

  /**
   * Invalid agent.json error
   */
  invalidAgentJson(path: string, reason?: string): UserFriendlyError {
    const suggestions = [
      'Check agent.json has valid JSON syntax',
      'Ensure required fields are present (identity.name, identity.version)',
      'Validate against the schema: https://github.com/openpeng/agent-deploy/blob/main/docs/specs/AGENT_JSON_SPEC_V2.md',
    ];

    if (reason) {
      suggestions.unshift(`Fix the issue: ${reason}`);
    }

    return new UserFriendlyError(
      `Invalid agent.json: ${path}`,
      suggestions
    );
  },

  /**
   * Market connection error
   */
  marketConnectionError(marketUrl: string): UserFriendlyError {
    return new UserFriendlyError(
      `Cannot connect to Market: ${marketUrl}`,
      [
        'Check the Market server is running',
        `Try: curl ${marketUrl}/api/v1/health`,
        'Verify the MARKET_API_URL environment variable or --market option',
        'Check your network connection',
      ]
    );
  },

  /**
   * Authentication error (401)
   */
  authenticationError(): UserFriendlyError {
    return new UserFriendlyError(
      'Authentication failed: Invalid or missing API key',
      [
        'Set MARKET_API_KEY environment variable',
        'Use --api-key option to provide API key',
        'Contact Market administrator to get a valid API key',
        'Check the API key has not expired',
      ]
    );
  },

  /**
   * Conflict error (409)
   */
  conflictError(agentName: string, version: string): UserFriendlyError {
    return new UserFriendlyError(
      `Agent '${agentName}' version ${version} already exists`,
      [
        'Update the version in agent.json to a new version',
        'Use --force to overwrite (caution: others may be using this version)',
        `View existing versions: agent-deploy versions ${agentName}`,
        'Consider semantic versioning: increment patch (x.x.X) for fixes, minor (x.X.0) for features',
      ]
    );
  },

  /**
   * Not found error (404)
   */
  notFoundError(resourceType: string, resourceId: string): UserFriendlyError {
    return new UserFriendlyError(
      `${resourceType} not found: ${resourceId}`,
      [
        `Search available ${resourceType}s: agent-deploy search "${resourceId}"`,
        `Check the ${resourceType} ID is correct`,
        `List local ${resourceType}s: agent-deploy list`,
      ]
    );
  },

  /**
   * Tool not detected error
   */
  toolNotDetected(): UserFriendlyError {
    return new UserFriendlyError(
      'No AI coding tools detected',
      [
        'Make sure at least one supported AI tool is installed',
        'Try specifying tool manually: -t cursor, -t claude_code, etc.',
        'Check the tool is running and accessible',
        'Supported tools: Cursor, Claude Code, CodeBuddy, GitHub Copilot',
      ]
    );
  },

  /**
   * No adapters matched error
   */
  noAdapterMatched(sourcePath: string): UserFriendlyError {
    return new UserFriendlyError(
      `No adapter found for: ${sourcePath}`,
      [
        'Check the file path matches one of the supported formats:',
        '  - Cursor: .cursor/commands/*.md',
        '  - Claude Code: .claude/commands/*.md',
        '  - CodeBuddy: .codebuddy/skills/*/SKILL.md',
        '  - GitHub Copilot: .github/agents/*.md',
        'Try forcing an adapter: --tool cursor, --tool claude_code, etc.',
        'Use --dry-run to preview the import',
      ]
    );
  },

  /**
   * Permission error
   */
  permissionError(path: string, operation: string): UserFriendlyError {
    return new UserFriendlyError(
      `Permission denied: Cannot ${operation} ${path}`,
      [
        'Check you have write permissions for the directory',
        'Try running with appropriate permissions',
        'Check the file/directory is not locked by another process',
      ]
    );
  },

  /**
   * Network timeout error
   */
  networkTimeout(operation: string): UserFriendlyError {
    return new UserFriendlyError(
      `Operation timed out: ${operation}`,
      [
        'Check your internet connection',
        'Try again in a few moments',
        'The server may be experiencing high load',
      ]
    );
  },

  /**
   * Validation error
   */
  validationError(field: string, issue: string): UserFriendlyError {
    return new UserFriendlyError(
      `Validation failed for '${field}': ${issue}`,
      [
        `Fix the ${field} value in agent.json`,
        'Check the agent.json specification for valid formats',
        'Use --dry-run to validate before importing',
      ]
    );
  },
};

/**
 * Wrap async function with error handling
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  context: ErrorContext
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof UserFriendlyError) {
        // Already a user-friendly error, just add context
        error.context = context;
        throw error;
      }

      // Try to match known error patterns
      const message = error instanceof Error ? error.message : String(error);

      // File not found
      if (message.includes('ENOENT') || message.includes('not found')) {
        const match = message.match(/['"](.+?)['"]/);
        const path = match ? match[1] : 'unknown';
        throw ErrorHandlers.fileNotFound(path);
      }

      // Permission denied
      if (message.includes('EACCES') || message.includes('EPERM')) {
        throw ErrorHandlers.permissionError(context.operation, 'access');
      }

      // Network errors
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        const marketUrl = context.details?.marketUrl || 'http://localhost:8321';
        throw ErrorHandlers.marketConnectionError(marketUrl);
      }

      // Timeout
      if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
        throw ErrorHandlers.networkTimeout(context.operation);
      }

      // HTTP status codes
      if (message.includes('401')) {
        throw ErrorHandlers.authenticationError();
      }

      if (message.includes('404')) {
        const resourceId = context.details?.resourceId || 'unknown';
        throw ErrorHandlers.notFoundError(context.operation, resourceId);
      }

      if (message.includes('409')) {
        const agentName = context.details?.agentName || 'unknown';
        const version = context.details?.version || 'unknown';
        throw ErrorHandlers.conflictError(agentName, version);
      }

      // Generic error
      throw error;
    }
  };
}

/**
 * Handle CLI command errors
 */
export function handleCommandError(error: Error, command: string): never {
  if (error instanceof UserFriendlyError) {
    console.error(formatError(error.message, error.suggestions));
  } else {
    console.error(`❌ ${command} failed: ${error.message}\n`);
    console.error('💡 If this error persists, please report it at:');
    console.error('   https://github.com/openpeng/agent-deploy/issues\n');
  }

  process.exit(1);
}
