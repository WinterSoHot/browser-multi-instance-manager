const test = require('node:test');
const assert = require('node:assert/strict');

let queueModule = {};
try {
  queueModule = require('../lib/async-queue');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('serializes asynchronous profile mutations in submission order', async () => {
  const enqueue = queueModule.createAsyncQueue?.();
  const order = [];
  let releaseFirst;

  const first = enqueue(async () => {
    order.push('first-start');
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    order.push('first-end');
    return 1;
  });
  const second = enqueue(async () => {
    order.push('second');
    return 2;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('continues processing after a rejected mutation', async () => {
  const enqueue = queueModule.createAsyncQueue?.();
  const failed = enqueue(async () => {
    throw new Error('failed');
  });
  const recovered = enqueue(async () => 'recovered');

  await assert.rejects(failed, /failed/u);
  assert.equal(await recovered, 'recovered');
});

test('serializes lifecycle work per profile while allowing different profiles', async () => {
  const enqueue = queueModule.createKeyedAsyncQueue?.();
  const order = [];
  let releaseWork;

  const first = enqueue('work', async () => {
    order.push('work-start');
    await new Promise((resolve) => {
      releaseWork = resolve;
    });
    order.push('work-end');
  });
  const second = enqueue('work', async () => order.push('work-second'));
  const personal = enqueue('personal', async () => order.push('personal'));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['work-start', 'personal']);
  releaseWork();
  await Promise.all([first, second, personal]);
  assert.deepEqual(order, ['work-start', 'personal', 'work-end', 'work-second']);
});
