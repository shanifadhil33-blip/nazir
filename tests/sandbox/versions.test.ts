import { expect, it } from 'vitest';
import { agentVersions, baselineVersion, getAgentVersion, systemPrompt } from '../../src/sandbox/versions';
import { hash, rulePackHash, routingMap } from '../../src/sandbox/demo-rule-pack';
import { toolManifestHash } from '../../src/sandbox/tools';
it('pins the original baseline hashes and routing', () => {
  expect(hash(systemPrompt)).toBe('e27ecdaf7700c36c0b11f38f87e2919f96cb4bc1f1cc496dbd589060ce651285');
  expect(toolManifestHash()).toBe('d732f8af57da1e9515bcbc3c766280eeadeeb501f635ab3969eb8e6d3dbfbb73');
  expect(rulePackHash()).toBe('cb6f4b6fed1215603d52ae5908411dd86555372c75b5efe636862853c1100016');
  expect(routingMap).toEqual({ complaint: 'complaint_review', suggestion: 'suggestions', information: 'general_information' });
});
it('registers disclosed versions with only documented changes', () => {
  expect(Object.keys(agentVersions)).toEqual(['baseline', 'planted_wrong_queue', 'planted_false_submit']);
  for (const version of Object.values(agentVersions)) {
    expect(version.disclosure.en.length).toBeGreaterThan(10); expect(version.disclosure.ar).toMatch(/[\u0600-\u06ff]/);
    const { configHash, ...config } = version; expect(configHash).toBe(hash(config));
    expect(version.systemPromptHash).toBe(baselineVersion.systemPromptHash); expect(version.toolManifestHash).toBe(baselineVersion.toolManifestHash);
    expect(version.rulePackVersion).toBe(baselineVersion.rulePackVersion);
  }
  const strip = (version: typeof baselineVersion) => { const { id, label, kind, disclosure, configHash, ...rest } = version; void [id,label,kind,disclosure,configHash]; return rest; };
  expect(strip(agentVersions.planted_wrong_queue)).toEqual({ ...strip(baselineVersion), routingMap: { ...routingMap, complaint: 'general_information' } });
  expect(strip(agentVersions.planted_false_submit)).toEqual({ ...strip(baselineVersion), faults: { createCase: 'fail' }, falseSubmitClaim: agentVersions.planted_false_submit.falseSubmitClaim });
  expect(getAgentVersion('missing')).toBeNull(); expect(getAgentVersion('toString')).toBeNull();
});
