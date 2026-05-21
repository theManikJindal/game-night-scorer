import { test, describe } from 'node:test';
import assert from 'node:assert';

// Mock localStorage before importing state.js
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};

import { set, get, on, update } from '../../public/js/state.js';

describe('State Store', () => {
  test('set and get updates state', () => {
    set('testKey', 'testValue');
    assert.strictEqual(get('testKey'), 'testValue');
  });

  test('set triggers listeners on change', () => {
    let called = false;
    let receivedValue = null;
    let receivedPrev = null;

    on('key1', (val, prev) => {
      called = true;
      receivedValue = val;
      receivedPrev = prev;
    });

    set('key1', 'newVal');
    assert.strictEqual(called, true);
    assert.strictEqual(receivedValue, 'newVal');
    assert.strictEqual(receivedPrev, undefined);

    called = false;
    set('key1', 'anotherVal');
    assert.strictEqual(called, true);
    assert.strictEqual(receivedValue, 'anotherVal');
    assert.strictEqual(receivedPrev, 'newVal');
  });

  test('set does not trigger listeners if value is the same', () => {
    let callCount = 0;
    on('key2', () => {
      callCount++;
    });

    set('key2', 'same');
    assert.strictEqual(callCount, 1);

    set('key2', 'same');
    assert.strictEqual(callCount, 1, 'Listener should not be called when value is identical');
  });

  test('wildcard listener triggers for any key', () => {
    const changes = [];
    on('*', (key, val, prev) => {
      changes.push({ key, val, prev });
    });

    set('wild1', 'a');
    set('wild2', 'b');

    // We search for our specific keys in case other tests ran and added to changes
    const wild1Change = changes.find(c => c.key === 'wild1');
    const wild2Change = changes.find(c => c.key === 'wild2');

    assert.ok(wild1Change);
    assert.deepStrictEqual(wild1Change, { key: 'wild1', val: 'a', prev: undefined });
    assert.ok(wild2Change);
    assert.deepStrictEqual(wild2Change, { key: 'wild2', val: 'b', prev: undefined });
  });

  test('update applies transformation and sets value', () => {
    set('counter', 10);
    update('counter', (n) => n + 5);
    assert.strictEqual(get('counter'), 15);
  });

  test('on returns unsubscribe function', () => {
    let callCount = 0;
    const unsub = on('unsubKey', () => callCount++);

    set('unsubKey', 1);
    assert.strictEqual(callCount, 1);

    unsub();
    set('unsubKey', 2);
    assert.strictEqual(callCount, 1);
  });
});
