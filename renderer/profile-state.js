(function exposeProfileState(root, factory) {
  const profileState = factory(
    typeof module === 'object' && module.exports
      ? require('./view-utils')
      : root.viewUtils,
  );

  if (typeof module === 'object' && module.exports) {
    module.exports = profileState;
  } else {
    root.profileState = profileState;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, ({
  filterProfiles,
  retainVisibleSelection,
  sortProfiles,
}) => {
  function cloneProfiles(profiles) {
    return profiles.map((profile) => ({ ...profile }));
  }

  function createProfileState(initial = {}) {
    let profiles = cloneProfiles(initial.profiles || []);
    let runningIds = new Set(initial.runningIds || []);
    let unknownIds = new Set(initial.unknownIds || []);
    let retryableCloseIds = new Set(initial.retryableCloseIds || []);
    let selectedIds = new Set(initial.selectedIds || []);
    let filter = initial.filter || 'all';
    let query = initial.query || '';
    let sort = initial.sort || 'default';

    function getVisibleProfileRecords() {
      return sortProfiles(
        filterProfiles(profiles, filter, query),
        sort,
        { runningIds, unknownIds },
      );
    }

    function retainVisibleSelections() {
      selectedIds = retainVisibleSelection(selectedIds, getVisibleProfileRecords());
    }

    retainVisibleSelections();

    function getSnapshot() {
      return {
        profiles: cloneProfiles(profiles),
        runningIds: [...runningIds],
        unknownIds: [...unknownIds],
        retryableCloseIds: [...retryableCloseIds],
        selectedIds: [...selectedIds],
        filter,
        query,
        sort,
      };
    }

    function setProfiles(nextProfiles) {
      profiles = cloneProfiles(nextProfiles);
      retainVisibleSelections();
    }

    function updateProfile(profileId, changes) {
      profiles = profiles.map((profile) => (
        profile.id === profileId ? { ...profile, ...changes } : profile
      ));
      retainVisibleSelections();
    }

    function setStatuses(statuses) {
      runningIds = new Set(statuses.runningIds || []);
      unknownIds = new Set(statuses.unknownIds || []);
      retryableCloseIds = new Set(statuses.retryableCloseIds || []);
    }

    function setFilter(nextFilter) {
      filter = nextFilter;
      retainVisibleSelections();
    }

    function setQuery(nextQuery) {
      query = nextQuery;
      retainVisibleSelections();
    }

    function setSort(nextSort) {
      sort = nextSort;
    }

    function toggleSelection(profileId) {
      if (selectedIds.has(profileId)) {
        selectedIds.delete(profileId);
        return;
      }
      if (getVisibleProfileRecords().some((profile) => profile.id === profileId)) {
        selectedIds.add(profileId);
      }
    }

    function clearSelection() {
      selectedIds.clear();
    }

    function getVisibleProfiles() {
      return cloneProfiles(getVisibleProfileRecords());
    }

    return {
      getSnapshot,
      setProfiles,
      updateProfile,
      setStatuses,
      setFilter,
      setQuery,
      setSort,
      toggleSelection,
      clearSelection,
      getVisibleProfiles,
    };
  }

  return { createProfileState };
}));
