import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedRequestOrigin } from './request-origin.js';
test('requires a bearer session and exact configured preview origin', () => {
  const check = (origin: string, bearer = true, configured = 'http://127.0.0.1:5174') => allowedRequestOrigin(new Request('https://app.example/api/organizations/team/threads', {headers: {origin, ...(bearer ? {authorization:'Bearer example'} : {cookie:'remy_session=example'})}}), configured);
  assert.equal(check('http://127.0.0.1:5174'), true);
  assert.equal(check('http://127.0.0.1:5174', false), false);
  assert.equal(check('http://127.0.0.1:5175'), false);
  assert.equal(check('http://127.0.0.1:5174.evil.test'), false);
  assert.equal(check('http://127.0.0.1:5174', true, ''), false);
  assert.equal(check('https://app.example', false), true);
});
