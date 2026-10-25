import { expect, it } from 'vitest';
import { estateSystemPrompt, estateVersions } from '../../src/sandbox/real-estate/agent';
import { shopSystemPrompt, shopVersions } from '../../src/sandbox/shop/agent';
import { clinicSystemPrompt, clinicVersions } from '../../src/sandbox/clinic/agent';
import { schoolSystemPrompt, schoolVersions } from '../../src/sandbox/school/agent';
import { hash } from '../../src/sandbox/demo-rule-pack';
import { estateToolManifestHash } from '../../src/sandbox/real-estate/tools';
import { shopToolManifestHash } from '../../src/sandbox/shop/tools';
import { clinicToolManifestHash } from '../../src/sandbox/clinic/tools';
import { schoolToolManifestHash } from '../../src/sandbox/school/tools';

it.each([
  [estateSystemPrompt, estateVersions.baseline, estateToolManifestHash],
  [shopSystemPrompt, shopVersions.baseline, shopToolManifestHash],
  [clinicSystemPrompt, clinicVersions.baseline, clinicToolManifestHash],
  [schoolSystemPrompt, schoolVersions.baseline, schoolToolManifestHash],
] as const)('requires same turn review and fingerprints the prompt', (prompt, version, tools) => {
  expect(prompt).toContain('call request_human_review in the same turn');
  expect(prompt).toContain('Never ask permission first');
  expect(prompt).toContain('tell the requester it was sent and name the team');
  expect(prompt).toContain('equivalent logging tool');
  const { configHash, ...config } = version;
  expect(configHash).toBe(hash({ ...config, prompt: hash(prompt), tools: tools() }));
  expect(configHash).not.toBe(hash({ ...config, prompt: hash(`${prompt} changed`), tools: tools() }));
});
