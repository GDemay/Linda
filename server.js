const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'none';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY || 'am_us_a5267be794e517ead4dd65da9666f36e2c02d478dc324f5bb09303a97ddd3f0f';
const AGENTMAIL_INBOX = process.env.AGENTMAIL_INBOX || 'guillaume-5295@agentmail.to';
const LEADS_FILE = path.join(__dirname, 'leads.json');

let leads = [];
try {
  if (fs.existsSync(LEADS_FILE)) {
    leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  }
} catch (e) {
  leads = [];
}

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

async function sendWelcomeEmail({ email, name, company, plan, focusAgent }) {
  if (!AGENTMAIL_API_KEY || !email) return false;
  try {
    const res = await fetch(`https://api.agentmail.to/v0/inboxes/${AGENTMAIL_INBOX}/messages/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AGENTMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: [email],
        subject: `Welcome to Linda — Your 14-day ${plan || 'Growth'} trial is active`,
        text: `Hi ${name || 'there'},\n\nWelcome to Linda! Your 14-day trial for ${company || 'your team'} is officially active.\n\nYour primary agent, ${focusAgent || 'Elio'}, has been provisioned and is standing by to execute tasks immediately with zero setup.\n\nAccess your instant onboarding workspace anytime here:\nhttps://linda-llm-production.up.railway.app/signup\n\nNo human sales call needed. You have full self-serve access to all 8 autonomous agents.\n\nBest regards,\nGuillaume Demay\nFounder, Linda\nhttps://linda-llm-production.up.railway.app`,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('AgentMail dispatch error:', err.message);
    return false;
  }
}

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.get('/workspace', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.post('/api/signup', async (req, res) => {
  const { name, email, company, plan = 'Growth', focusAgent = 'Elio', referralSource = 'direct' } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'A valid work email address is required.' });
  }

  const lead = {
    id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: (name || '').trim(),
    email: email.trim().toLowerCase(),
    company: (company || '').trim(),
    plan,
    focusAgent,
    referralSource,
    createdAt: new Date().toISOString(),
    status: 'active_trial',
  };

  leads.unshift(lead);
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write leads file:', e.message);
  }

  // Dispatch transactional email asynchronously without blocking the user response
  sendWelcomeEmail(lead).catch((err) => console.error(err));

  res.status(201).json({
    ok: true,
    message: 'Trial successfully activated! Welcome to Linda.',
    lead,
  });
});

app.get('/api/leads', (req, res) => {
  if (ADMIN_TOKEN) {
    const provided = req.query.token || req.headers['x-admin-token'];
    if (provided !== ADMIN_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized. Pass ?token=<ADMIN_TOKEN>.' });
    }
  }
  res.json({ count: leads.length, leads });
});

app.get('/api/stats', (req, res) => {
  res.json({
    ok: true,
    totalRequests: usage.requestCount,
    totalSignups: leads.length,
    activeTrials: leads.filter(l => l.status === 'active_trial').length,
    recentSignups: leads.slice(0, 5),
  });
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
