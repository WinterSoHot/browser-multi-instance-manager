function createAppLifecycle({
  platform,
  getCloseToTray,
  getActiveStatusCount,
  confirmExit,
  hideWindow,
  destroyTray,
  quitApp,
}) {
  let quitting = false;
  let quitRequest = null;

  function getSafeActiveCounts(counts) {
    if (!counts || typeof counts !== 'object') {
      return null;
    }

    const { running, unknown } = counts;
    if (!Number.isSafeInteger(running) || running < 0
      || !Number.isSafeInteger(unknown) || unknown < 0) {
      return null;
    }

    return { running, unknown };
  }

  async function getActiveCountsForExit() {
    try {
      return getSafeActiveCounts(await getActiveStatusCount({ force: true }))
        || { running: 0, unknown: 1 };
    } catch {
      return { running: 0, unknown: 1 };
    }
  }

  function requestQuit() {
    if (quitRequest) {
      return quitRequest;
    }

    if (quitting) {
      return Promise.resolve(true);
    }

    quitRequest = (async () => {
      const activeCounts = await getActiveCountsForExit();
      if (activeCounts.running > 0 || activeCounts.unknown > 0) {
        let confirmed = false;
        try {
          confirmed = await confirmExit(activeCounts);
        } catch {
          confirmed = false;
        }
        if (confirmed !== true) {
          return false;
        }
      }

      quitting = true;
      try {
        await destroyTray();
      } catch {
        // A stale tray must not keep the application process alive.
      }
      try {
        await quitApp();
        return true;
      } catch {
        quitting = false;
        return false;
      }
    })();

    quitRequest.then(() => {
      if (!quitting) {
        quitRequest = null;
      }
    }, () => {
      quitRequest = null;
    });

    return quitRequest;
  }

  function handleWindowClose(event) {
    if (quitting) {
      return Promise.resolve(true);
    }

    if (getCloseToTray() === true) {
      event.preventDefault();
      hideWindow();
      return Promise.resolve(false);
    }

    if (platform !== 'darwin') {
      event.preventDefault();
      return requestQuit();
    }

    return Promise.resolve(false);
  }

  function handleBeforeQuit(event) {
    if (quitting) {
      return Promise.resolve(true);
    }

    event.preventDefault();
    return requestQuit();
  }

  return {
    handleWindowClose,
    handleBeforeQuit,
    requestQuit,
    isQuitting: () => quitting,
  };
}

module.exports = {
  createAppLifecycle,
};
