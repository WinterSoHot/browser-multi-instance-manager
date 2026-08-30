const { createAsyncQueue, createKeyedAsyncQueue } = require('./async-queue');

function createProfileOperationCoordinator() {
  const enqueueMutation = createAsyncQueue();
  const enqueueLifecycle = createKeyedAsyncQueue();
  return {
    runGlobalMutation(operation) {
      return enqueueMutation(operation);
    },
    runLifecycle(profileId, operation) {
      return enqueueLifecycle(profileId, operation);
    },
    runMutation(profileId, operation) {
      return enqueueMutation(() => enqueueLifecycle(profileId, operation));
    },
  };
}

module.exports = { createProfileOperationCoordinator };
