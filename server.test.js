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
