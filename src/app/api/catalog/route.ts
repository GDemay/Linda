import { AGENT_CATALOG, AGENT_KEYS, GOALS } from '@/lib/agents/catalog.ts';
import { definitionsForAgent } from '@/lib/workflows/definitions.ts';
import { templatesFor } from '@/lib/tasks/templates.ts';
import { handle, json } from '@/lib/http.ts';

/** Public: the signup page shows the catalog before an account exists. */
export const GET = handle(async () =>
  json({
    goals: GOALS,
    agents: AGENT_KEYS.map((key) => {
      const a = AGENT_CATALOG[key];
      return {
        key: a.key,
        name: a.name,
        persona: a.persona,
        role: a.role,
        blurb: a.blurb,
        requiredProviders: a.requiredProviders,
        optionalProviders: a.optionalProviders,
        workflows: definitionsForAgent(key).map((w) => ({ key: w.key, name: w.name, description: w.description })),
        taskTemplates: templatesFor(key).map((t) => ({ key: t.key, category: t.category, title: t.title })),
      };
    }),
  }),
);
