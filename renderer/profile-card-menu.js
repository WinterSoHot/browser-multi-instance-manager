(function exposeProfileCardMenu(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.profileCardMenu = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function createProfileCardMenuState() {
    let openProfileId = null;
    return {
      open(profileId) { openProfileId = String(profileId); },
      toggle(profileId) {
        const target = String(profileId);
        openProfileId = openProfileId === target ? null : target;
      },
      close() { openProfileId = null; },
      getSnapshot() { return { openProfileId }; },
    };
  }

  function nextProfileCardMenuItemIndex(currentIndex, key, itemCount) {
    if (!Number.isSafeInteger(itemCount) || itemCount < 1) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return itemCount - 1;
    if (key === 'ArrowDown') return (currentIndex + 1 + itemCount) % itemCount;
    if (key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
    return null;
  }

  return { createProfileCardMenuState, nextProfileCardMenuItemIndex };
}));
