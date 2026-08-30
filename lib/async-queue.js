function createAsyncQueue() {
  let tail = Promise.resolve();
  return function enqueue(operation) {
    const result = tail.then(operation, operation);
    tail = result.catch(() => {});
    return result;
  };
}

function createKeyedAsyncQueue() {
  const tails = new Map();
  return function enqueue(key, operation) {
    const previous = tails.get(key) || Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}

module.exports = { createAsyncQueue, createKeyedAsyncQueue };
