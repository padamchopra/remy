import assert from 'node:assert/strict';
import test from 'node:test';
import { QA_ACCOUNT_ERROR, qaHostedAccount, qaHostedAccountAvailable, signInWithPassword } from '../hosted-account.mjs';

test('missing hosted QA secrets fail with a clear setup error', () => {
  assert.throws(() => qaHostedAccount({}), { message: QA_ACCOUNT_ERROR });
  assert.throws(() => qaHostedAccount({ REMY_QA_EMAIL: 'qa@example.test' }), { message: QA_ACCOUNT_ERROR });
  assert.throws(() => qaHostedAccount({ REMY_QA_PASSWORD: 'qa-test-password' }), { message: QA_ACCOUNT_ERROR });
  assert.throws(() => qaHostedAccount({ REMY_QA_EMAIL: ' ', REMY_QA_PASSWORD: 'qa-test-password' }), { message: QA_ACCOUNT_ERROR });
  assert.equal(qaHostedAccountAvailable({}), false);
});

test('hosted QA secrets stay out of the setup error', () => {
  try {
    qaHostedAccount({ REMY_QA_EMAIL: 'qa@example.test', REMY_QA_PASSWORD: '' });
    assert.fail('expected missing password to fail');
  } catch (error) {
    assert.equal(error instanceof Error && error.message, QA_ACCOUNT_ERROR);
    assert.equal(JSON.stringify(error).includes('qa-test-password'), false);
    assert.equal(String(error).includes('qa@example.test'), false);
  }
});

test('reads the hosted QA account from the named environment secrets', () => {
  assert.deepEqual(qaHostedAccount({ REMY_QA_EMAIL: ' qa@example.test ', REMY_QA_PASSWORD: ' qa-test-password ' }), {
    email: 'qa@example.test',
    password: ' qa-test-password ',
  });
  assert.equal(qaHostedAccountAvailable({ REMY_QA_EMAIL: 'qa@example.test', REMY_QA_PASSWORD: 'qa-test-password' }), true);
});

test('password sign-in exchanges a Better Auth cookie for a Remy session', async () => {
  const seen = [];
  const fakeFetch = async (url, init = {}) => {
    seen.push({ url: String(url), body: init.body, headers: init.headers });
    if (String(url).endsWith('/api/auth/sign-in/email')) {
      return new Response(JSON.stringify({ user: { email: 'qa@example.test' } }), {
        headers: { 'set-cookie': 'better-auth.session_token=auth-cookie; HttpOnly', 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ expiresIn: 604800 }), {
      headers: { 'set-cookie': 'remy_session=preview-token; HttpOnly; Path=/', 'content-type': 'application/json' },
    });
  };
  const result = await signInWithPassword({
    hub: 'https://app.tryremy.dev',
    email: 'qa@example.test',
    password: 'qa-test-password',
    fetch: fakeFetch,
  });
  assert.deepEqual(result, { accessToken: 'preview-token', expiresIn: 604800 });
  assert.equal(JSON.parse(seen[0].body).password, 'qa-test-password');
  assert.equal(JSON.stringify(result).includes('qa-test-password'), false);
  assert.equal(seen[1].headers.cookie, 'better-auth.session_token=auth-cookie');
});

test('password sign-in failures stay generic', async () => {
  await assert.rejects(
    signInWithPassword({
      hub: 'https://app.tryremy.dev',
      email: 'qa@example.test',
      password: 'qa-test-password',
      fetch: async () => new Response(JSON.stringify({ message: 'Invalid email or password: qa-test-password' }), { status: 401 }),
    }),
    { message: 'Could not sign in; try again.' },
  );
});
