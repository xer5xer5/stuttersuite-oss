// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test'), assert = require('node:assert/strict');
const {createServer} = require('../server.js');
test('serves worklet modules with JavaScript MIME; refuses uploads and non-app files', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const file of ['pitch-worklet.js', 'pitch-core.mjs']) {
      const response = await fetch(`${origin}/${file}`);
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/javascript/);
    }
    assert.equal((await fetch(`${origin}/app.js`, {method: 'POST', body: 'synthetic-test'})).status, 404);
    assert.equal((await fetch(`${origin}/.git/config`)).status, 404);
    assert.equal((await fetch(`${origin}/tests/browser.cjs`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
