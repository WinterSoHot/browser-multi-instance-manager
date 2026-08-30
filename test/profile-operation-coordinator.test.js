const test = require('node:test');
const assert = require('node:assert/strict');

let coordinatorModule = {};
try {
  coordinatorModule = require('../lib/profile-operation-coordinator');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('prevents launch from interleaving with delete or rename of the same profile', async () => {
  const coordinator = coordinatorModule.createProfileOperationCoordinator?.();
  const order = [];
  let releaseLaunch;

  const launch = coordinator.runLifecycle('work', async () => {
    order.push('launch-start');
    await new Promise((resolve) => {
      releaseLaunch = resolve;
    });
    order.push('launch-end');
  });
  const remove = coordinator.runMutation('work', async () => order.push('delete'));
  const rename = coordinator.runMutation('work', async () => order.push('rename'));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['launch-start']);
  releaseLaunch();
  await Promise.all([launch, remove, rename]);
  assert.deepEqual(order, ['launch-start', 'launch-end', 'delete', 'rename']);
});

test('allows lifecycle work for a different profile during a mutation', async () => {
  const coordinator = coordinatorModule.createProfileOperationCoordinator?.();
  const order = [];
  let releaseMutation;

  const mutation = coordinator.runMutation('work', async () => {
    order.push('work-mutation');
    await new Promise((resolve) => {
      releaseMutation = resolve;
    });
  });
  const launch = coordinator.runLifecycle('personal', async () => order.push('personal-launch'));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...order].sort(), ['personal-launch', 'work-mutation']);
  releaseMutation();
  await Promise.all([mutation, launch]);
});
