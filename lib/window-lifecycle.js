async function createWindowAfterInitialization({
  initializationPromise,
  getWindows,
  createWindow,
}) {
  await initializationPromise;
  if (getWindows().length === 0) {
    createWindow();
  }
}

module.exports = {
  createWindowAfterInitialization,
};
