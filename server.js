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
const TASKS_FILE = path.join(__dirname, 'tasks.json');

// Agent definitions & system prompts
const AGENTS = {
  Tom: {
    name: 'Tom',
    role: 'Inbound Receptionist & Voice/Inbox',
    badge: 'Receptionist',
    category: 'Customer Ops',
    avatar: 'T',
    color: '#06b6d4',
    description: 'Answers inbound customer queries, schedules appointments, and qualifies leads via WhatsApp and inbox.',
    autonomy: 'Inbox, Messaging & Phone triage',
    systemPrompt: 'You are Tom, Linda\'s autonomous Inbound Receptionist. You answer inbound customer queries, qualify leads, schedule appointments, handle emergency after-hours triage, and draft polite, professional responses. Keep outputs structured, concise, and actionable.',
    samplePrompts: [
      'Create an after-hours emergency call triage script for HVAC/service businesses',
      'Draft an inbound lead qualification questionnaire for software agencies',
      'Write a multilingual customer greeting sequence (English/Spanish) for WhatsApp'
    ]
  },
  John: {
    name: 'John',
    role: 'Marketing Campaigns & Social Media Lead',
    badge: 'Marketing',
    category: 'Growth',
    avatar: 'J',
    color: '#ec4899',
    description: 'Plans, drafts, and schedules social content across Twitter/X, LinkedIn, and newsletters with visual hooks.',
    autonomy: 'Multi-channel social & newsletters',
    systemPrompt: 'You are John, Linda\'s autonomous Marketing Campaign Lead. You create viral Twitter/X threads, high-converting LinkedIn thought leadership posts, newsletter copy, and launch campaigns. Format outputs with catchy hooks, bulleted takeaways, and clear calls-to-action.',
    samplePrompts: [
      'Plan a 5-day LinkedIn build-in-public content series on replacing manual agency tasks',
      'Draft a viral Twitter/X hook thread breaking down why SMBs waste 20 hrs/week on admin',
      'Write a product launch newsletter announcing Linda Growth plan with 14-day free trial'
    ]
  },
  Lou: {
    name: 'Lou',
    role: 'SEO Content Strategist & Long-Form Writer',
    badge: 'SEO',
    category: 'Content',
    avatar: 'L',
    color: '#10b981',
    description: 'Audits site health, identifies competitor keyword gaps, and drafts search-optimized content that ranks.',
    autonomy: 'SERP & Keyword research',
    systemPrompt: 'You are Lou, Linda\'s autonomous SEO Content Strategist. You produce search-intent optimized article outlines, keyword matrices, meta tags, and structured articles engineered for Google search ranking and organic lead capture.',
    samplePrompts: [
      'Draft a comprehensive SEO article outline targeting "autonomous AI agents for agencies"',
      'Create a keyword gap analysis matrix comparing Linda vs Limova.ai',
      'Generate high-CTR title tags and meta descriptions for B2B workflow automation pages'
    ]
  },
  Elio: {
    name: 'Elio',
    role: 'B2B Outbound Sales Rep & Prospecting (SDR)',
    badge: 'Sales',
    category: 'Sales',
    avatar: 'E',
    color: '#6366f1',
    description: 'Discovers qualified B2B leads, crafts personalized cold outbound sequences, and keeps CRM records updated.',
    autonomy: 'Outbound email sequences & CRM syncing',
    systemPrompt: 'You are Elio, Linda\'s autonomous B2B Outbound Sales Rep (SDR). You craft razor-sharp, zero-fluff cold email sequences, prospect qualifying criteria, objection rebuttals, and follow-up drips that drive replies and demo-free trial signups.',
    samplePrompts: [
      'Draft a 3-step cold email sequence targeting digital marketing agencies suffering margin squeeze',
      'Write a response handling the common objection: "We already have too many software tools"',
      'Formulate an ICP qualification rubric for 5-25 person professional service firms'
    ]
  },
  Manue: {
    name: 'Manue',
    role: 'Accounting, Cash Flow & Financial Runway Analyst',
    badge: 'Finance',
    category: 'Operations',
    avatar: 'M',
    color: '#f59e0b',
    description: 'Reconciles bank accounts, forecasts cash runway, sends invoice reminders, and surfaces anomalous expenses.',
    autonomy: 'Bookkeeping, Runway & Invoicing',
    systemPrompt: 'You are Manue, Linda\'s autonomous Financial & Runway Analyst. You analyze burn rates, forecast runway scenarios, draft professional invoice collection notices, and categorize expenses with clear mathematical rigor and prudence.',
    samplePrompts: [
      'Calculate monthly cash runway and break-even milestones from $80k cash at $9.5k monthly burn',
      'Draft a 3-stage escalatory invoice collection sequence (Friendly / Due / Overdue)',
      'List 7 tax-deductible software and AI automation expense categories for bootstrapped startups'
    ]
  },
  Julia: {
    name: 'Julia',
    role: 'Legal Review & Contract Compliance Assistant',
    badge: 'Legal',
    category: 'Risk',
    avatar: 'Ju',
    color: '#8b5cf6',
    description: 'Reviews vendor contracts, flags non-standard liability clauses, and drafts standard NDAs and MSAs.',
    autonomy: 'Document review & Risk assessment',
    systemPrompt: 'You are Julia, Linda\'s autonomous Legal Review Assistant. You analyze contracts, identify high-risk indemnification and limitation of liability clauses, summarize MSAs/NDAs, and provide clear redline recommendations in plain English.',
    samplePrompts: [
      'Highlight 4 standard risk areas in agency subcontractor / freelance master service agreements',
      'Draft a clear, balanced Mutual Non-Disclosure Agreement (NDA) for early partnership talks',
      'Audit an SaaS Service Level Agreement clause for acceptable downtime and liability cap'
    ]
  },
  Rony: {
    name: 'Rony',
    role: 'Recruiting, Screening & Talent Evaluator',
    badge: 'Recruiting',
    category: 'HR & Talent',
    avatar: 'R',
    color: '#14b8a6',
    description: 'Parses candidate CVs against hiring rubrics, coordinates screening, and crafts personalized interview loops.',
    autonomy: 'Applicant screening & Rubric scoring',
    systemPrompt: 'You are Rony, Linda\'s autonomous Recruiting and Screening Specialist. You design structured hiring scorecards, formulate role-specific behavioral interview questions, write job descriptions, and evaluate candidate qualifications objectively.',
    samplePrompts: [
      'Design a structured scorecard and screening rubric for a Senior Full-Stack Node.js Engineer',
      'Draft 5 behavioral and situational interview questions evaluating autonomous execution',
      'Write a high-converting, realistic job post for an Async Operations Coordinator'
    ]
  },
  Charly: {
    name: 'Charly',
    role: 'Chief of Staff & Autonomous Orchestrator',
    badge: 'Chief of Staff',
    category: 'Executive',
    avatar: 'C',
    color: '#818cf8',
    description: 'Coordinates agent cross-dependencies, synthesizes daily executive digests, and escalates blockers to you.',
    autonomy: 'Cross-agent workflow orchestration',
    systemPrompt: 'You are Charly, Linda\'s Chief of Staff and Master Autonomous Orchestrator. You supervise and coordinate the other 7 agents (Tom, John, Lou, Elio, Manue, Julia, Rony), delegate complex multi-agent workflows, synthesize executive daily digests, and ensure zero human bottlenecks.',
    samplePrompts: [
      'Coordinate a multi-agent product launch combining Elio (sales), Lou (SEO), and John (marketing)',
      'Synthesize a weekly executive brief on company operations, signups, and cash runway',
      'Identify top 3 operational bottlenecks in a fast-scaling 10-person service business'
    ]
  }
};

let leads = [];
try {
  if (fs.existsSync(LEADS_FILE)) {
    leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  }
} catch (e) {
  leads = [];
}

let tasks = [];
try {
  if (fs.existsSync(TASKS_FILE)) {
    tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  }
} catch (e) {
  tasks = [];
}

function saveTasks() {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save tasks file:', e.message);
  }
}

// Seed initial demo tasks if empty
if (tasks.length === 0) {
  tasks = [
    {
      id: 'task_demo_1',
      title: 'Draft B2B Outbound Sequence for Agency Founders',
      agent: 'Elio',
      category: 'Sales',
      status: 'completed',
      input: 'Create a 3-step cold email sequence targeting boutique marketing agencies struggling with manual reporting bottlenecks.',
      output: `### Subject: Quick observation on agency client reporting hours\n\nHi {{firstName}},\n\nNoticed {{companyName}} manages multi-channel campaigns for growth brands. Most agency founders we talk to mention their account managers lose 4-6 hours weekly compiling cross-platform analytics reports.\n\nLinda's autonomous marketing agent (John) automates multi-channel reporting and client drafts with zero manual intervention.\n\nWould you be open to testing this on your team? You can launch a 14-day trial self-serve in 3 minutes:\nhttps://linda-llm-production.up.railway.app/signup\n\nBest,\nElio\nB2B Sales Agent @ Linda`,
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      completedAt: new Date(Date.now() - 3600000 * 2 + 12000).toISOString(),
      tokensUsed: 215,
    },
    {
      id: 'task_demo_2',
      title: 'SEO Long-Form Keyword Gap Analysis vs Limova.ai',
      agent: 'Lou',
      category: 'SEO',
      status: 'completed',
      input: 'Identify 5 high-intent keywords where competitors like Limova.ai leave content gaps.',
      output: `### Keyword Opportunity Matrix (Low Difficulty / High Intent)\n\n1. **"self-serve ai agents for small business"** — Monthly Volume: 1,400 | Intent: Commercial | Competitor Coverage: Low (Limova requires demo calls).\n2. **"autonomous b2b cold outreach software without sales calls"** — Volume: 880 | Intent: Transactional | Competitor Coverage: None.\n3. **"limova alternative transparent pricing"** — Volume: 620 | Intent: Direct Comparison | Competitor Coverage: Zero.\n4. **"ai bookkeeping assistant for agency runway"** — Volume: 1,100 | Intent: Informational/Commercial | Competitor Coverage: Weak.\n5. **"no-human onboarding ai workforce"** — Volume: 450 | Intent: High Buying Intent | Competitor Coverage: Zero.`,
      createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      completedAt: new Date(Date.now() - 3600000 * 4 + 15000).toISOString(),
      tokensUsed: 310,
    },
    {
      id: 'task_demo_3',
      title: 'Mutual NDA & Contractor Risk Review Matrix',
      agent: 'Julia',
      category: 'Legal',
      status: 'completed',
      input: 'Provide a 4-point risk assessment checklist for agency contractor master agreements.',
      output: `### Legal Risk Assessment Matrix\n\n1. **IP Assignment & Work Made for Hire:** Ensure immediate vesting of all work product, prompts, code, and copy upon creation without dependency on invoice settlement.\n2. **Non-Solicitation Scope:** Limit non-solicitation strictly to clients the contractor directly serviced during the preceding 12 months, avoiding unenforceable broad geographic bans.\n3. **Limitation of Liability:** Cap aggregate contractor liability at total fees paid in the past 6 months, with explicit carve-outs for confidentiality breaches and willful misconduct.\n4. **Data Privacy & AI Input Security:** Mandate that client confidential data is not ingested into public LLM training corpuses.`,
      createdAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      completedAt: new Date(Date.now() - 3600000 * 8 + 18000).toISOString(),
      tokensUsed: 280,
    }
  ];
  saveTasks();
}

// Pricing per 1M tokens (USD)
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
  const price = PRICING[OPENAI_MODEL] || { input: 0.2, output: 1.2 };
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

// Core LLM generation helper
async function callLlm({ systemPrompt, userMessage, maxTokens = 600 }) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_completion_tokens: maxTokens,
      reasoning_effort: REASONING_EFFORT,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    recordUsage({ ok: false, error: data.error?.message || 'OpenAI request failed' });
    throw new Error(data.error?.message || 'OpenAI request failed');
  }

  recordUsage({
    ok: true,
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
  });

  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage,
  };
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    model: OPENAI_MODEL,
    reasoningEffort: REASONING_EFFORT,
    hasApiKey: Boolean(OPENAI_API_KEY),
    totalTasks: tasks.length,
    totalAgents: Object.keys(AGENTS).length,
  });
});

// Interactive chat API for live demo widget
app.post('/api/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Body must include a string "message" field.' });
  }

  try {
    const result = await callLlm({
      systemPrompt: 'You are Linda, the autonomous AI workforce platform for small businesses and founders. Linda provides 8 specialized AI agents: Tom (Phone/reception), John (Marketing/social), Lou (SEO articles), Elio (B2B outbound sales), Manue (Accounting/runway), Julia (Legal/contracts), Rony (Recruiting/screening), and Charly (Chief of Staff/orchestration). Linda offers 100% self-serve, no-human onboarding in 3 minutes with zero sales calls, and transparent pricing ($49/mo Starter, $149/mo Growth, $399/mo Scale) with a 14-day free trial. Answer prospect questions directly, helpfully, and concisely in 2-3 sentences.',
      userMessage: message,
      maxTokens: 350,
    });
    res.json({ reply: result.content, usage: result.usage });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unexpected server error while calling OpenAI.' });
  }
});

// -------------------------------------------------------------
// AGENTS & TASK DISPATCH ENGINE (LIN-34 Deliverables 1 & 2)
// -------------------------------------------------------------

// GET /api/agents - Return all 8 autonomous agents and metadata
app.get('/api/agents', (req, res) => {
  const list = Object.values(AGENTS).map(a => ({
    ...a,
    activeTasksCount: tasks.filter(t => t.agent.toLowerCase() === a.name.toLowerCase() && t.status === 'in_progress').length,
    completedTasksCount: tasks.filter(t => t.agent.toLowerCase() === a.name.toLowerCase() && t.status === 'completed').length,
  }));
  res.json({ count: list.length, agents: list });
});

// GET /api/agents/:name - Return single agent details
app.get('/api/agents/:name', (req, res) => {
  const agentKey = Object.keys(AGENTS).find(k => k.toLowerCase() === req.params.name.toLowerCase());
  if (!agentKey) {
    return res.status(404).json({ error: `Agent "${req.params.name}" not found.` });
  }
  const agent = AGENTS[agentKey];
  const agentTasks = tasks.filter(t => t.agent.toLowerCase() === agent.name.toLowerCase());
  res.json({ agent, tasks: agentTasks });
});

// GET /api/tasks - List all dispatched tasks
app.get('/api/tasks', (req, res) => {
  const { agent, status, limit = 50 } = req.query;
  let filtered = [...tasks];
  if (agent) {
    filtered = filtered.filter(t => t.agent.toLowerCase() === agent.toLowerCase());
  }
  if (status) {
    filtered = filtered.filter(t => t.status.toLowerCase() === status.toLowerCase());
  }
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ count: filtered.length, tasks: filtered.slice(0, parseInt(limit, 10)) });
});

// GET /api/tasks/:id - Get single task status & output artifact
app.get('/api/tasks/:id', (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: `Task with id "${req.params.id}" not found.` });
  }
  res.json({ task });
});

// POST /api/tasks - Dispatch a real autonomous agent task
app.post('/api/tasks', async (req, res) => {
  const { agent = 'Elio', title, input, sync = true } = req.body || {};

  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return res.status(400).json({ error: 'Field "input" is required and must be non-empty.' });
  }

  const agentKey = Object.keys(AGENTS).find(k => k.toLowerCase() === (agent || '').toLowerCase()) || 'Elio';
  const targetAgent = AGENTS[agentKey];

  const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const taskTitle = (title && typeof title === 'string' && title.trim().length > 0)
    ? title.trim()
    : `${targetAgent.name}: ${input.trim().slice(0, 48)}${input.length > 48 ? '...' : ''}`;

  const task = {
    id: taskId,
    title: taskTitle,
    agent: targetAgent.name,
    category: targetAgent.category,
    status: 'in_progress',
    input: input.trim(),
    output: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    tokensUsed: 0,
  };

  tasks.unshift(task);
  saveTasks();

  // Async execution function
  const runTask = async () => {
    try {
      const llmResult = await callLlm({
        systemPrompt: targetAgent.systemPrompt,
        userMessage: `Task: ${taskTitle}\n\nUser Instructions:\n${task.input}\n\nExecute this task autonomously and output high quality, structured production deliverables.`,
        maxTokens: 750,
      });

      task.output = llmResult.content;
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.tokensUsed = (llmResult.usage?.prompt_tokens || 0) + (llmResult.usage?.completion_tokens || 0);
      saveTasks();
    } catch (err) {
      task.status = 'failed';
      task.output = `Task execution encountered an error: ${err.message}`;
      task.completedAt = new Date().toISOString();
      saveTasks();
    }
  };

  if (sync) {
    // Wait for task completion to return immediate artifact to user
    await runTask();
    return res.status(201).json({
      ok: true,
      message: `Task executed successfully by agent ${targetAgent.name}.`,
      task,
    });
  } else {
    // Asynchronous dispatch
    runTask();
    return res.status(202).json({
      ok: true,
      message: `Task dispatched to agent ${targetAgent.name}. Polling available at /api/tasks/${taskId}.`,
      task,
    });
  }
});

// Welcome email dispatcher via AgentMail
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
        text: `Hi ${name || 'there'},\n\nWelcome to Linda! Your 14-day trial for ${company || 'your team'} is officially active.\n\nYour primary agent, ${focusAgent || 'Elio'}, has been provisioned and is standing by to execute tasks immediately with zero setup.\n\nAccess your multi-agent dashboard anytime here:\nhttps://linda-llm-production.up.railway.app/app\n\nNo human sales call needed. You have full self-serve access to all 8 autonomous agents.\n\nBest regards,\nGuillaume Demay\nFounder, Linda\nhttps://linda-llm-production.up.railway.app`,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('AgentMail dispatch error:', err.message);
    return false;
  }
}

// -------------------------------------------------------------
// ROUTES: UI VIEWS
// -------------------------------------------------------------

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Multi-agent customer dashboard routes
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/dashboard', (req, res) => {
  res.redirect('/app');
});

app.get('/workspace', (req, res) => {
  res.redirect('/app');
});

// POST /api/signup - Lead capture & instant onboarding bridge
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

  // Dispatch transactional email asynchronously
  sendWelcomeEmail(lead).catch((err) => console.error(err));

  res.status(201).json({
    ok: true,
    message: 'Trial successfully activated! Welcome to Linda.',
    lead,
    redirectUrl: `/app?email=${encodeURIComponent(lead.email)}&agent=${encodeURIComponent(lead.focusAgent)}&plan=${encodeURIComponent(lead.plan)}&company=${encodeURIComponent(lead.company)}`,
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
    totalTasksExecuted: tasks.length,
    completedTasks: tasks.filter(t => t.status === 'completed').length,
    recentSignups: leads.slice(0, 5),
    recentTasks: tasks.slice(0, 5),
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
    tasksCount: tasks.length,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Linda application service listening on port ${PORT}, model=${OPENAI_MODEL}`);
  });
}

module.exports = app;
