const express = require('express');

const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'none';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// Cheapest-tier pricing per 1M tokens (USD). Update if the model changes.
const PRICING = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
};

const usage = {
  requestCount: 0,
  errorCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
  recent: [],
};

function recordUsage({ ok, promptTokens = 0, completionTokens = 0, error = null }) {
  usage.requestCount += 1;
  if (!ok) usage.errorCount += 1;
  usage.promptTokens += promptTokens;
  usage.completionTokens += completionTokens;
  const price = PRICING[OPENAI_MODEL] || { input: 0, output: 0 };
  usage.estimatedCostUsd += (promptTokens / 1e6) * price.input + (completionTokens / 1e6) * price.output;
  usage.recent.unshift({
    at: new Date().toISOString(),
    ok,
    promptTokens,
    completionTokens,
    error,
  });
  usage.recent = usage.recent.slice(0, 20);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: OPENAI_MODEL, reasoningEffort: REASONING_EFFORT, hasApiKey: Boolean(OPENAI_API_KEY) });
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Body must include a string "message" field.' });
  }
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are Linda, the autonomous AI workforce platform for small businesses and founders. Linda provides 8 specialized AI agents: Tom (Phone/reception), John (Marketing/social), Lou (SEO articles), Elio (B2B outbound sales), Manue (Accounting/runway), Julia (Legal/contracts), Rony (Recruiting/screening), and Charly (Chief of Staff/orchestration). Linda offers 100% self-serve, no-human onboarding in 3 minutes with zero sales calls, and transparent pricing (/mo Starter, /mo Growth, /mo Scale) with a 14-day free trial. Answer prospect questions directly, helpfully, and concisely in 2-3 sentences.',
          },
          { role: 'user', content: message },
        ],
        max_completion_tokens: 300,
        reasoning_effort: REASONING_EFFORT,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      recordUsage({ ok: false, error: data.error?.message || 'OpenAI request failed' });
      return res.status(response.status).json({ error: data.error?.message || 'OpenAI request failed' });
    }

    recordUsage({
      ok: true,
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
    });

    res.json({ reply: data.choices?.[0]?.message?.content ?? '', usage: data.usage });
  } catch (err) {
    recordUsage({ ok: false, error: err.message });
    res.status(500).json({ error: 'Unexpected server error while calling OpenAI.' });
  }
});

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).send('Admin panel disabled: set ADMIN_TOKEN to enable it.');
  }
  const provided = req.query.token || req.headers['x-admin-token'];
  if (provided !== ADMIN_TOKEN) {
    return res.status(401).send('Unauthorized. Pass ?token=<ADMIN_TOKEN>.');
  }
  next();
}

app.get('/admin', requireAdmin, (req, res) => {
  res.json({
    model: OPENAI_MODEL,
    reasoningEffort: REASONING_EFFORT,
    hasApiKey: Boolean(OPENAI_API_KEY),
    usage,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Linda test service listening on port ${PORT}, model=${OPENAI_MODEL}`);
  });
}

module.exports = app;
