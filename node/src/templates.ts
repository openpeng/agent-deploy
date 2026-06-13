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
