/**
 * Template Manager
 *
 * Manages agent templates for quick-start agent creation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentJsonV2 } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Template directory
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// ============================================================
// Template generation helpers (programmatic creation)
// ============================================================

export interface GenerateAgentOptions {
  name: string;
  description: string;
  tools?: string[];
  modelProvider?: string;
  modelId?: string;
}

export interface GenerateWorkerOptions {
  agentName: string;
  steps?: Array<{ name: string; agent: string; prompt: string }>;
}

export interface GenerateTeamOptions {
  name: string;
  members?: Array<{ name: string; role: string; agent: string }>;
  mode?: 'sequential' | 'parallel' | 'supervisor';
}

/**
 * Generate an agent.json template programmatically
 */
export function generateAgentTemplate(options: GenerateAgentOptions): AgentJsonV2 {
  const {
    name,
    description,
    tools = [],
    modelProvider = 'openrouter',
    modelId = 'openrouter/free',
  } = options;

  const displayName = name
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return {
    schema_version: '2.0',
    identity: {
      name,
      version: '0.1.0',
      display_name: displayName,
      description,
      author: process.env.USER || process.env.USERNAME || 'Unknown',
      license: 'MIT',
      tags: ['agent-deploy'],
    },
    instructions: {
      format: 'markdown',
      source: 'inline',
      content: `You are ${displayName}. ${description}`,
    },
    capabilities: tools.map(t => `Use ${t} tool`),
    compatibility: {
      model_provider: modelProvider,
      model_id: modelId,
    },
  };
}

/**
 * Generate a worker.yaml template programmatically
 */
export function generateWorkerTemplate(options: GenerateWorkerOptions): Record<string, any> {
  const { agentName, steps = [{ name: 'step_1', agent: agentName, prompt: 'Execute the main task' }] } = options;

  return {
    version: '1.0',
    worker: {
      name: `${agentName}_worker`,
      description: `Worker for ${agentName}`,
      agent: agentName,
      steps,
    },
  };
}

/**
 * Generate a team.yaml template programmatically
 */
export function generateTeamTemplate(options: GenerateTeamOptions): Record<string, any> {
  const { name, members = [], mode = 'sequential' } = options;
  const displayName = name
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return {
    version: '1.0',
    team: {
      name,
      display_name: displayName,
      description: `Team: ${displayName}`,
      mode,
      members,
    },
  };
}

/**
 * Write template to file (JSON or YAML based on extension)
 */
export function writeTemplateToFile(template: object, outputPath: string): string {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.json') {
    fs.writeFileSync(outputPath, JSON.stringify(template, null, 2), 'utf-8');
  } else if (ext === '.yaml' || ext === '.yml') {
    // Simple YAML serialization without external dependency
    fs.writeFileSync(outputPath, _toYaml(template), 'utf-8');
  } else {
    fs.writeFileSync(outputPath, JSON.stringify(template, null, 2), 'utf-8');
  }

  return outputPath;
}

/**
 * Simple object-to-YAML serializer
 */
function _toYaml(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent);
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj.includes('\n') ? `|\n${spaces}${obj.split('\n').join('\n' + spaces)}` : obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => `${spaces}- ${_toYaml(item, indent + 1).trimStart()}`).join('\n');
  }
  const entries = Object.entries(obj);
  if (entries.length === 0) return '{}';
  return entries.map(([k, v]) => {
    if (v === null || v === undefined) return `${spaces}${k}:`;
    if (typeof v === 'object') {
      return `${spaces}${k}:\n${_toYaml(v, indent + 1)}`;
    }
    return `${spaces}${k}: ${_toYaml(v, 0)}`;
  }).join('\n');
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
}

export interface InitOptions {
  template: string;
  name?: string;
  outputDir: string;
  customize?: boolean;
}

/**
 * Get list of available templates
 */
export function listTemplates(): TemplateInfo[] {
  const templates: TemplateInfo[] = [];

  if (!fs.existsSync(TEMPLATES_DIR)) {
    return templates;
  }

  const files = fs.readdirSync(TEMPLATES_DIR);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const templatePath = path.join(TEMPLATES_DIR, file);
    try {
      const content = fs.readFileSync(templatePath, 'utf-8');
      const template: AgentJsonV2 = JSON.parse(content);

      templates.push({
        id: template.identity.name,
        name: template.identity.display_name || template.identity.name,
        description: template.identity.description || '',
        category: (template.identity as any).category || 'general',
        tags: template.identity.tags || [],
        author: template.identity.author || 'Unknown',
      });
    } catch (error) {
      // Skip invalid templates
      continue;
    }
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get template by ID
 */
export function getTemplate(templateId: string): AgentJsonV2 | null {
  const templatePath = path.join(TEMPLATES_DIR, `${templateId}.json`);

  if (!fs.existsSync(templatePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(templatePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Initialize a new agent from template
 */
export function initFromTemplate(options: InitOptions): string {
  const { template, name, outputDir, customize = false } = options;

  // Load template
  const templateData = getTemplate(template);
  if (!templateData) {
    throw new Error(`Template not found: ${template}`);
  }

  // Create new agent from template
  const agentData: AgentJsonV2 = JSON.parse(JSON.stringify(templateData));

  // Customize if name provided
  if (name) {
    agentData.identity.name = name;
    agentData.identity.display_name = name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Reset version to 0.1.0 for new agent
  agentData.identity.version = '0.1.0';

  // Set author to current user if available
  if (process.env.USER || process.env.USERNAME) {
    agentData.identity.author = process.env.USER || process.env.USERNAME || 'Unknown';
  }

  // Determine output directory
  const agentName = agentData.identity.name;
  const agentDir = path.join(outputDir, agentName);

  // Check if directory already exists
  if (fs.existsSync(agentDir)) {
    throw new Error(`Directory already exists: ${agentDir}`);
  }

  // Create directory
  fs.mkdirSync(agentDir, { recursive: true });

  // Write agent.json
  const agentJsonPath = path.join(agentDir, 'agent.json');
  fs.writeFileSync(agentJsonPath, JSON.stringify(agentData, null, 2));

  // Create README.md
  const readme = generateReadme(agentData);
  fs.writeFileSync(path.join(agentDir, 'README.md'), readme);

  // Create CHANGELOG.md
  const changelog = generateChangelog(agentData);
  fs.writeFileSync(path.join(agentDir, 'CHANGELOG.md'), changelog);

  return agentDir;
}

/**
 * Generate README.md from agent data
 */
function generateReadme(agent: AgentJsonV2): string {
  const name = agent.identity.display_name || agent.identity.name;
  const description = agent.identity.description || '';
  const tags = agent.identity.tags?.join(', ') || '';

  return `# ${name}

${description}

## Overview

**Category**: ${(agent.identity as any).category || 'general'}
**Tags**: ${tags}
**Version**: ${agent.identity.version}
**Author**: ${agent.identity.author || 'Unknown'}

## Usage

\`\`\`bash
# Upload to Market
agent-deploy upload .

# Deploy to AI tool
agent-deploy deploy . -t claude_code
\`\`\`

## Instructions

The agent's instructions are defined in \`agent.json\`. You can customize them by editing the \`instructions\` field.

## Customization

1. Edit \`agent.json\` to modify:
   - Agent name and description
   - Instructions and behavior
   - Model requirements
   - Tags and metadata

2. Test your changes locally

3. Upload to Market when ready

## License

${(agent as any).metadata?.license || 'MIT'}

## Links

- [Agent Deploy](https://github.com/openpeng/agent-deploy)
- [Documentation](https://github.com/openpeng/agent-deploy/tree/main/docs)
`;
}

/**
 * Generate CHANGELOG.md
 */
function generateChangelog(agent: AgentJsonV2): string {
  const version = agent.identity.version;
  const date = new Date().toISOString().split('T')[0];

  return `# Changelog

All notable changes to this agent will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [${version}] - ${date}

### Added
- Initial release
- Created from template

---

## Version Guidelines

- **Major** (x.0.0): Breaking changes to agent behavior
- **Minor** (0.x.0): New features, backward compatible
- **Patch** (0.0.x): Bug fixes, improvements
`;
}

/**
 * Validate template structure
 */
export function validateTemplate(template: AgentJsonV2): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields
  if (!template.identity) {
    errors.push('Missing identity field');
  } else {
    if (!template.identity.name) errors.push('Missing identity.name');
    if (!template.identity.version) errors.push('Missing identity.version');
    if (!template.identity.display_name && !template.identity.name) {
      errors.push('Missing identity.display_name');
    }
  }

  if (!template.instructions) {
    errors.push('Missing instructions field');
  }

  // Check instructions length
  if (template.instructions) {
    const instructionsText = typeof template.instructions === 'string'
      ? template.instructions
      : template.instructions.content || '';

    if (instructionsText.length < 100) {
      errors.push('Instructions too short (minimum 100 characters)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
