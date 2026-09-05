import { describe, expect, it } from 'vitest';
import { db, fixedClock, newAccount, onboard } from './helpers.ts';
import { chunkText, groundingForAgent, htmlToText, removeDocument, uploadDocument } from '../src/lib/knowledge/index.ts';
import { countChunks, findDocument, listDocuments } from '../src/lib/repos/knowledge.ts';
import { listActivity, listRunSteps, listWorkflows } from '../src/lib/repos/workflows.ts';
import { getOnboardingStatus, submitKnowledge } from '../src/lib/onboarding/machine.ts';
import { runTask } from '../src/lib/tasks/engine.ts';
import { runNow } from '../src/lib/workflows/runner.ts';

const PRICING_DOC = [
  'Acme pricing guide.',
  'The Starter plan costs 29 euros per month and includes one phone line.',
  'The Team plan costs 79 euros per month and includes three lines and a shared inbox.',
  'Refunds are available within 14 days of purchase, no questions asked.',
].join('\n\n');

describe('knowledge — upload & processing', () => {
  it('ingests pasted text into ready chunks with honest counters', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    const { document } = await uploadDocument(d, workspace.id, {
      title: 'Pricing guide',
      content: PRICING_DOC,
    });

    expect(document.status).toBe('ready');
    expect(document.source).toBe('paste');
    expect(document.charCount).toBe(PRICING_DOC.length);
    expect(document.chunkCount).toBeGreaterThan(0);
    expect(document.lastUsedAt).toBeNull(); // upload alone is not "use"
    expect(countChunks(d, workspace.id)).toBe(document.chunkCount);
  });

  it('chunks on paragraph boundaries and never drops text', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}. ${'x'.repeat(80)}`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, { chunkChars: 600 });
    expect(chunks.length).toBeGreaterThan(1);
    // Every paragraph survives chunking.
    for (let i = 0; i < 30; i++) {
      expect(chunks.join('\n')).toContain(`Paragraph ${i}.`);
    }
  });

  it('strips HTML down to readable text', () => {
    const text = htmlToText(
      '<html><head><style>body{color:red}</style></head><body><script>evil()</script>' +
        '<h1>Acme</h1><p>We answer within one hour.</p><footer>&copy; 2026</footer></body></html>',
    );
    expect(text).toContain('Acme');
    expect(text).toContain('We answer within one hour.');
    expect(text).not.toContain('evil()');
    expect(text).not.toContain('color');
  });

  it('records fetch failures on the row instead of throwing them away', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const fetchImpl = (async () => ({ ok: false, status: 500, headers: new Headers(), text: async () => '' })) as unknown as typeof fetch;

    const { document } = await uploadDocument(
      d, workspace.id, { url: 'https://acme.example/pricing' }, { fetchImpl },
    );

    expect(document.status).toBe('failed');
    expect(document.error).toContain('500');
    expect(document.chunkCount).toBe(0);
    // The row stays so the list can explain what happened.
    expect(listDocuments(d, workspace.id)).toHaveLength(1);
    expect(listActivity(d, workspace.id).some((e) => e.kind === 'knowledge.upload_failed')).toBe(true);
  });

  it('rejects unknown agent scoping keys', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await expect(
      uploadDocument(d, workspace.id, { content: 'some text about the business', agentKeys: ['nonexistent'] }),
    ).rejects.toThrow(/unknown agent/);
  });
});

describe('knowledge — grounding', () => {
  it('scopes documents per agent and stamps last-used on retrieval', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const now = fixedClock('2026-03-01T10:00:00.000Z');

    const { document: shared } = await uploadDocument(d, workspace.id, {
      title: 'Company facts', content: 'We are Acme. We answer within one hour.', agentKeys: [],
    });
    const { document: phoneOnly } = await uploadDocument(d, workspace.id, {
      title: 'Phone script', content: 'Always offer a callback slot.', agentKeys: ['phone'],
    });

    const phone = groundingForAgent(d, workspace.id, 'phone', { now });
    const marketing = groundingForAgent(d, workspace.id, 'marketing', { now });

    // Both see the workspace-wide doc; only phone sees the scoped one.
    const phoneText = phone.blocks.join(' ');
    const marketingText = marketing.blocks.join(' ');
    expect(phoneText).toContain('We answer within one hour.');
    expect(phoneText).toContain('Always offer a callback slot.');
    expect(marketingText).toContain('We answer within one hour.');
    expect(marketingText).not.toContain('Always offer a callback slot.');

    // Retrieval is what counts as "use".
    const sharedAfter = findDocument(d, workspace.id, shared.id);
    const phoneOnlyAfter = findDocument(d, workspace.id, phoneOnly.id);
    expect(sharedAfter?.lastUsedAt).toBe('2026-03-01T10:00:00.000Z');
    expect(phoneOnlyAfter?.lastUsedAt).toBe('2026-03-01T10:00:00.000Z');
    // ...but only for agents that actually saw it.
    expect(phone.documentCount).toBe(2);
    expect(marketing.documentCount).toBe(1);
  });

  it('never injects failed documents', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const fetchFail = (async () => ({ ok: false, status: 404, headers: new Headers(), text: async () => '' })) as unknown as typeof fetch;
    await uploadDocument(d, workspace.id, { url: 'https://acme.example/gone' }, { fetchImpl: fetchFail });

    const grounding = groundingForAgent(d, workspace.id, null);
    expect(grounding.blocks).toHaveLength(0);
  });
});

describe('knowledge — onboarding step (LIN-13 wizard step 4)', () => {
  it('sits between hire_agents and connect_tools, and is skippable', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    // Drive to just past hire_agents, then check the new step is where the
    // spec puts it: after hiring, before connections.
    await onboard(d, workspace.id, { agents: ['phone'] });
    expect(getOnboardingStatus(d, workspace.id).step).toBe('done'); // skip path still completes

    const d2 = db();
    const { workspace: ws2 } = await newAccount(d2);
    const wsId = ws2.id;
    const { submitCompanyProfile, submitGoals, hireAgents } = await import('../src/lib/onboarding/machine.ts');
    submitCompanyProfile(d2, wsId, {
      legalName: 'Acme SAS', industry: 'software', size: '2-10',
      website: 'https://acme.example', description: '', tone: 'friendly', timezone: 'UTC',
    });
    submitGoals(d2, wsId, { goals: ['capture_leads'] });
    hireAgents(d2, wsId, { agents: [{ key: 'phone', config: {} }] });
    expect(getOnboardingStatus(d2, wsId).step).toBe('add_knowledge');

    const result = await submitKnowledge(d2, wsId, {
      documents: [{ title: 'Pricing', content: PRICING_DOC, agentKeys: ['phone'] }],
    });
    expect(result.added).toHaveLength(1);
    expect(result.added[0].status).toBe('ready');
    expect(getOnboardingStatus(d2, wsId).step).toBe('connect_tools');

    // The status surface carries the knowledge summary for the wizard list.
    const status = getOnboardingStatus(d2, wsId) as ReturnType<typeof getOnboardingStatus> & {
      knowledge: { title: string; status: string; chunkCount: number }[];
    };
    expect(status.knowledge).toHaveLength(1);
    expect(status.knowledge[0].chunkCount).toBeGreaterThan(0);

    // And the skip affordance: no documents, explicit skip, still advances.
    const skipped = await submitKnowledge(d2, wsId, { documents: [], skip: true });
    expect(skipped.added).toHaveLength(0);
  });
});

describe('knowledge — wired into execution', () => {
  it('grounds task templates in the agent-visible knowledge', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id, { agents: ['phone'], knowledge: [{ content: PRICING_DOC, agentKeys: ['phone'] }] });

    const task = runTask(d, {
      workspaceId: workspace.id,
      agent: 'phone',
      template: 'inbound_reply',
      input: 'How much is the Team plan and can I get a refund?',
    });
    expect(task.output).toContain('Grounded in');
    expect(task.output).toContain('passage');
  });

  it('injects knowledge into workflow run step context', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id, {
      agents: ['phone'],
      knowledge: [{ content: 'Refunds are available within 14 days.', agentKeys: ['phone'] }],
    });

    const workflows = listWorkflows(d, workspace.id).filter((w) => w.definitionKey === 'inbound_enquiry');
    expect(workflows.length).toBeGreaterThan(0);
    const { outcome } = await runNow(
      d,
      {
        workspaceId: workspace.id,
        workflowId: workflows[0].id,
        input: {
          channel: 'web',
          contact: { handle: 'web-form' },
          message: 'Can I get a refund on the Team plan?',
        },
        trigger: 'manual',
      },
      { now: fixedClock() },
    );
    expect(outcome.status).toBe('succeeded');
    // The drafted reply carries the grounding provenance count.
    const steps = listRunSteps(d, outcome.runId);
    const reply = steps.find((s) => s.stepKey === 'reply');
    expect(reply).toBeTruthy();
    const output = reply?.output as { knowledgeChunks?: number };
    expect(output.knowledgeChunks).toBeGreaterThan(0);
  });
});

describe('knowledge — deletion reversibility (LIN-14)', () => {
  it('deletes the document and its derived chunks, and says so', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const { document } = await uploadDocument(d, workspace.id, {
      title: 'Pricing guide', content: PRICING_DOC,
    });
    expect(countChunks(d, workspace.id)).toBeGreaterThan(0);

    const result = removeDocument(d, workspace.id, document.id);

    expect(result.chunksDeleted).toBe(document.chunkCount);
    expect(result.removed).toContain('fully deleted');
    expect(result.removed).toContain(`${document.chunkCount} extracted chunk`);
    expect(listDocuments(d, workspace.id)).toHaveLength(0);
    expect(countChunks(d, workspace.id)).toBe(0);
    expect(findDocument(d, workspace.id, document.id)).toBeNull();
    expect(listActivity(d, workspace.id).some((e) => e.kind === 'knowledge.deleted')).toBe(true);
  });

  it('never leaks another workspace document (404 path)', async () => {
    const d = db();
    const a = await newAccount(d);
    const b = await newAccount(d);
    const { document } = await uploadDocument(d, a.workspace.id, { content: 'private facts' });
    expect(() => removeDocument(d, b.workspace.id, document.id)).toThrow(/not found/);
  });
});
