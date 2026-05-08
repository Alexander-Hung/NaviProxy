import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAddressPort } from './diagnostics.routes.js';

test('parses lsof wildcard address', () => {
  assert.deepEqual(parseAddressPort('*:3001'), {
    address: '*',
    port: 3001
  });
});

test('parses bracketed ipv6 address', () => {
  assert.deepEqual(parseAddressPort('[::1]:5173'), {
    address: '::1',
    port: 5173
  });
});

test('rejects invalid ports', () => {
  assert.equal(parseAddressPort('127.0.0.1:not-a-port'), null);
});
