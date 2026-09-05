const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const app = require('./server');

function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...options, port: server.address().port }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('GET /health returns ok status', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/health' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(JSON.parse(res.body).status, 'ok');
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

test('GET /workspace serves self-serve onboarding page', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/workspace' });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.includes('Deploy your AI workforce in 3 minutes'));
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

test('POST /api/signup creates a lead with active 14-day trial', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const testPayload = {
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    company: 'Growth Agency IO',
    plan: 'Growth',
    focusAgent: 'Elio',
    referralSource: 'reddit_community',
  };
  const res = await request(
    server,
    { method: 'POST', path: '/api/signup', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify(testPayload)
  );
  assert.strictEqual(res.status, 201);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.lead.email, 'alex.rivera@example.com');
  assert.strictEqual(data.lead.plan, 'Growth');
  assert.strictEqual(data.lead.focusAgent, 'Elio');
  assert.strictEqual(data.lead.status, 'active_trial');
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

test('GET /api/stats returns runtime and sales metrics', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await request(server, { method: 'GET', path: '/api/stats' });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.ok, true);
  assert.ok(typeof data.totalSignups === 'number');
  assert.ok(typeof data.activeTrials === 'number');
});
