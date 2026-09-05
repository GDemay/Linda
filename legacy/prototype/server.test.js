const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const app = require('./server');

function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...options, port: server.address().port }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('GET /health returns ok status, agents count and tasks count', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/health' });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.status, 'ok');
  assert.strictEqual(data.totalAgents, 8);
  assert.ok(typeof data.totalTasks === 'number');
});

test('POST /api/chat rejects missing message', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(
    server,
    { method: 'POST', path: '/api/chat', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({})
  );
  assert.strictEqual(res.status, 400);
});

test('GET /admin without ADMIN_TOKEN is disabled', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/admin' });
  assert.strictEqual(res.status, 503);
});

test('GET /signup serves self-serve onboarding page', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/signup' });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.includes('Deploy your AI workforce in 3 minutes'));
});

test('GET /app serves multi-agent customer dashboard', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/app' });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.includes('Multi-Agent Autonomous Dashboard'));
  assert.ok(res.body.includes('Autonomous Workforce (8)'));
});

test('GET /dashboard redirects to /app', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/dashboard' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/app');
});

test('GET /workspace redirects to /app', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/workspace' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/app');
});

test('GET /api/agents returns all 8 autonomous agents with metadata', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/api/agents' });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.count, 8);
  assert.strictEqual(data.agents.length, 8);
  const names = data.agents.map(a => a.name);
  assert.ok(names.includes('Tom'));
  assert.ok(names.includes('John'));
  assert.ok(names.includes('Lou'));
  assert.ok(names.includes('Elio'));
  assert.ok(names.includes('Manue'));
  assert.ok(names.includes('Julia'));
  assert.ok(names.includes('Rony'));
  assert.ok(names.includes('Charly'));
});

test('GET /api/agents/:name returns single agent details and tasks', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/api/agents/elio' });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.agent.name, 'Elio');
  assert.strictEqual(data.agent.badge, 'Sales');
  assert.ok(Array.isArray(data.tasks));
});

test('GET /api/agents/:name returns 404 for unknown agent', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/api/agents/unknownagent' });
  assert.strictEqual(res.status, 404);
});

test('GET /api/tasks lists seeded and dispatched tasks', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/api/tasks' });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.count >= 1);
  assert.ok(Array.isArray(data.tasks));
});

test('GET /api/tasks/:id returns specific task by id', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const listRes = await request(server, { method: 'GET', path: '/api/tasks' });
  const tasks = JSON.parse(listRes.body).tasks;
  assert.ok(tasks.length > 0);
  const firstId = tasks[0].id;

  const res = await request(server, { method: 'GET', path: `/api/tasks/${firstId}` });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.task.id, firstId);
  assert.ok(data.task.agent);
});

test('POST /api/tasks rejects empty or missing input', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(
    server,
    { method: 'POST', path: '/api/tasks', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ agent: 'Elio' })
  );
  assert.strictEqual(res.status, 400);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.error, 'Field "input" is required and must be non-empty.');
});

test('POST /api/tasks executes task with real LLM inference synchronously', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(
    server,
    { method: 'POST', path: '/api/tasks', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({
      agent: 'Elio',
      title: 'Automated Test Cold Outreach',
      input: 'Write 1 short opening line for cold outreach to commercial real estate agents.',
      sync: true
    })
  );
  assert.strictEqual(res.status, 201);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.task.agent, 'Elio');
  assert.strictEqual(data.task.status, 'completed');
  assert.ok(data.task.output.length > 10);
  assert.ok(data.task.tokensUsed > 0);
});

test('POST /api/tasks dispatches task asynchronously with 202 status', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(
    server,
    { method: 'POST', path: '/api/tasks', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({
      agent: 'John',
      title: 'Async Marketing Draft',
      input: 'Draft a short marketing slogan for Linda.',
      sync: false
    })
  );
  assert.strictEqual(res.status, 202);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.task.agent, 'John');
  assert.strictEqual(data.task.status, 'in_progress');
});

test('POST /api/signup rejects invalid email', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(
    server,
    { method: 'POST', path: '/api/signup', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ name: 'Test', email: 'notanemail', company: 'Acme' })
  );
  assert.strictEqual(res.status, 400);
  assert.strictEqual(JSON.parse(res.body).error, 'A valid work email address is required.');
});

test('POST /api/signup creates lead with active trial and returns dashboard redirectUrl', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const testPayload = {
    name: 'Sarah Connor',
    email: 'sarah.connor@skylineops.io',
    company: 'Skyline Ops',
    plan: 'Growth',
    focusAgent: 'Elio',
    referralSource: 'reddit_community',
  };
  const res = await request(
    server,
    { method: 'POST', path: '/api/signup', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify(testPayload)
  );
  assert.ok(res.status === 201 || res.status === 200, 'signup succeeds (201 new, 200 dedupe update)');
  const data = JSON.parse(res.body);
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.lead.email, 'sarah.connor@skylineops.io');
  assert.strictEqual(data.lead.plan, 'Growth');
  assert.strictEqual(data.lead.focusAgent, 'Elio');
  assert.strictEqual(data.lead.status, 'active_trial');
  assert.ok(data.redirectUrl.includes('/app?email='));
  assert.ok(data.redirectUrl.includes('Skyline%20Ops'));
});

test('GET /api/leads returns recorded leads', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/api/leads' });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(typeof data.count === 'number');
  assert.ok(Array.isArray(data.leads));
});

test('GET /api/stats returns runtime, tasks, and sales metrics', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/api/stats' });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.ok, true);
  assert.ok(typeof data.totalSignups === 'number');
  assert.ok(typeof data.activeTrials === 'number');
  assert.ok(typeof data.totalTasksExecuted === 'number');
  assert.ok(typeof data.completedTasks === 'number');
  assert.ok(typeof data.externalActiveTrials === 'number');
  assert.ok(typeof data.uniqueExternalSignups === 'number');
  assert.ok(typeof data.internalSignups === 'number');
});

test('POST /api/signup dedupes repeat submissions by normalized email', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const before = JSON.parse((await request(server, { method: 'GET', path: '/api/leads' })).body).count;

  const dedupeEmail = `dedupe.lin58-${Date.now()}@externaltest.io`;
  const payload = {
    name: 'Dedupe Test',
    email: dedupeEmail,
    company: 'Dedupe Co',
    plan: 'Growth',
  };
  const first = await request(
    server,
    { method: 'POST', path: '/api/signup', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify(payload)
  );
  assert.strictEqual(first.status, 201);
  assert.strictEqual(JSON.parse(first.body).lead.audience, 'external');

  // Same email, different casing/whitespace -> update, not a new row
  const second = await request(
    server,
    { method: 'POST', path: '/api/signup', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ ...payload, email: `  ${dedupeEmail.toUpperCase()} ` })
  );
  assert.strictEqual(second.status, 200);
  const secondData = JSON.parse(second.body);
  assert.strictEqual(secondData.repeat, true);
  assert.strictEqual(secondData.lead.email, dedupeEmail);

  const after = JSON.parse((await request(server, { method: 'GET', path: '/api/leads' })).body).count;
  assert.strictEqual(after, before + 1);
});

test('internal QA emails are tagged internal and excluded from external stats', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const statsBefore = JSON.parse((await request(server, { method: 'GET', path: '/api/stats' })).body);

  const res = await request(
    server,
    { method: 'POST', path: '/api/signup', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ name: 'QA Audit', email: `audit+lin58-${Date.now()}@agentmail.to`, company: 'Linda QA' })
  );
  assert.strictEqual(res.status, 201);
  assert.strictEqual(JSON.parse(res.body).lead.audience, 'internal');

  const statsAfter = JSON.parse((await request(server, { method: 'GET', path: '/api/stats' })).body);
  assert.strictEqual(statsAfter.totalSignups, statsBefore.totalSignups + 1);
  assert.strictEqual(statsAfter.internalSignups, statsBefore.internalSignups + 1);
  assert.strictEqual(statsAfter.uniqueExternalSignups, statsBefore.uniqueExternalSignups);
  assert.strictEqual(statsAfter.externalActiveTrials, statsBefore.externalActiveTrials);
});
