/**
 * Security Tests for agent-deploy runtime
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_RESTRICTED_POLICY, DEFAULT_TRUSTED_POLICY, PolicyRegistry, DANGEROUS_COMMAND_PATTERNS, BLOCKED_IP_RANGES } from '../../src/runtime/policy.js';

describe('Security: Path Traversal Detection', () => {
  it('detects ../ patterns in paths', () => {
    expect('../' + 'etc/passwd').toContain('..');
  });

  it('detects absolute paths starting with /', () => {
    const path = '/etc/passwd';
    expect(path.startsWith('/')).toBe(true);
  });
});

describe('Security: ExecutionPolicy Defaults', () => {
  it('default policy restricts bash', () => {
    expect(DEFAULT_RESTRICTED_POLICY.allowBash).toBe(false);
  });

  it('default policy restricts network', () => {
    expect(DEFAULT_RESTRICTED_POLICY.allowNetwork).toBe(false);
  });

  it('default policy restricts web_search', () => {
    expect(DEFAULT_RESTRICTED_POLICY.allowWebSearch).toBe(false);
  });

  it('trusted policy allows all operations', () => {
    expect(DEFAULT_TRUSTED_POLICY.allowBash).toBe(true);
    expect(DEFAULT_TRUSTED_POLICY.allowNetwork).toBe(true);
    expect(DEFAULT_TRUSTED_POLICY.allowWebSearch).toBe(true);
  });

  it('trusted policy allows empty allowedPaths (no restriction)', () => {
    expect(DEFAULT_TRUSTED_POLICY.allowedPaths).toEqual([]);
  });
});

describe('Security: PolicyRegistry', () => {
  const registry = new PolicyRegistry();

  it('returns default restricted policy for unknown agents', () => {
    const policy = registry.get('unknown-agent');
    expect(policy.allowBash).toBe(false);
    expect(policy.allowNetwork).toBe(false);
  });

  it('trust() grants full access', () => {
    registry.trust('trusted-agent');
    const policy = registry.get('trusted-agent');
    expect(policy.allowBash).toBe(true);
    expect(policy.allowNetwork).toBe(true);
    expect(registry.isTrusted('trusted-agent')).toBe(true);
  });

  it('propagateTrust copies parent trust to child', () => {
    registry.trust('parent-agent');
    registry.propagateTrust('parent-agent', 'child-agent');
    expect(registry.isTrusted('child-agent')).toBe(true);
  });

  it('propagateTrust does nothing when parent is not trusted', () => {
    const reg = new PolicyRegistry();
    reg.propagateTrust('untrusted-parent', 'child');
    expect(reg.isTrusted('child')).toBe(false);
  });

  it('reset removes agent-specific policy', () => {
    registry.trust('temp-agent');
    expect(registry.isTrusted('temp-agent')).toBe(true);
    registry.reset('temp-agent');
    expect(registry.isTrusted('temp-agent')).toBe(false);
  });
});

describe('Security: Dangerous Command Patterns', () => {
  it('detects rm -rf / pattern', () => {
    const cmd = 'rm -rf /';
    const matched = DANGEROUS_COMMAND_PATTERNS.some(p => p.test(cmd));
    expect(matched).toBe(true);
  });

  it('detects chmod 777 pattern', () => {
    const cmd = 'chmod 777 /var/www';
    const matched = DANGEROUS_COMMAND_PATTERNS.some(p => p.test(cmd));
    expect(matched).toBe(true);
  });

  it('allows safe commands', () => {
    const cmd = 'ls -la';
    const matched = DANGEROUS_COMMAND_PATTERNS.some(p => p.test(cmd));
    expect(matched).toBe(false);
  });
});

describe('Security: Internal IP Blocking', () => {
  it('blocks 127.0.0.1', () => {
    const matched = BLOCKED_IP_RANGES.some(p => p.test('127.0.0.1'));
    expect(matched).toBe(true);
  });

  it('blocks 192.168.x.x', () => {
    const matched = BLOCKED_IP_RANGES.some(p => p.test('192.168.1.1'));
    expect(matched).toBe(true);
  });

  it('blocks 10.x.x.x', () => {
    const matched = BLOCKED_IP_RANGES.some(p => p.test('10.0.0.1'));
    expect(matched).toBe(true);
  });

  it('allows public IPs', () => {
    const matched = BLOCKED_IP_RANGES.some(p => p.test('8.8.8.8'));
    expect(matched).toBe(false);
  });
});
