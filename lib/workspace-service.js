const MAX_WORKSPACE_NAME_LENGTH = 80;

function validateWorkspaceName(name) {
  if (
    typeof name !== 'string'
    || name.length === 0
    || name.length > MAX_WORKSPACE_NAME_LENGTH
    || name !== name.trim()
  ) {
    throw new Error('Invalid workspace name');
  }
  return name;
}

function areWorkspaceNamesEqual(leftName, rightName) {
  return leftName.normalize('NFC').toLocaleLowerCase()
    === rightName.normalize('NFC').toLocaleLowerCase();
}

function isDuplicateWorkspaceName(workspaces, name, excludedId = null) {
  return workspaces.some((workspace) => (
    workspace.id !== excludedId
    && areWorkspaceNamesEqual(workspace.name, name)
  ));
}

function createWorkspaceService({ appStore, profileOperations, randomUUID, now }) {
  function list() {
    return appStore.getWorkspaces();
  }

  function create({ name } = {}) {
    return profileOperations.runGlobalMutation(async () => {
      try {
        validateWorkspaceName(name);
      } catch (error) {
        return { success: false, error: error.message };
      }

      const workspaces = appStore.getWorkspaces();
      if (isDuplicateWorkspaceName(workspaces, name)) {
        return { success: false, error: 'Workspace name already exists' };
      }

      const workspace = {
        id: randomUUID(),
        name,
        createdAt: now(),
      };
      workspaces.push(workspace);
      appStore.setWorkspaces(workspaces);
      return { success: true, workspace };
    });
  }

  function rename({ workspaceId, name } = {}) {
    return profileOperations.runGlobalMutation(async () => {
      const workspaces = appStore.getWorkspaces();
      const workspaceIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
      if (workspaceIndex === -1) return { success: false, error: 'Workspace not found' };

      try {
        validateWorkspaceName(name);
      } catch (error) {
        return { success: false, error: error.message };
      }
      if (isDuplicateWorkspaceName(workspaces, name, workspaceId)) {
        return { success: false, error: 'Workspace name already exists' };
      }

      const workspace = { ...workspaces[workspaceIndex], name };
      workspaces[workspaceIndex] = workspace;
      appStore.setWorkspaces(workspaces);
      return { success: true, workspace };
    });
  }

  function remove({ workspaceId } = {}) {
    return profileOperations.runGlobalMutation(async () => {
      const workspaces = appStore.getWorkspaces();
      if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
        return { success: false, error: 'Workspace not found' };
      }

      const profiles = appStore.getProfiles();
      appStore.setProfilesAndWorkspaces(profiles.map((profile) => (
        profile.workspaceId === workspaceId ? { ...profile, workspaceId: null } : profile
      )), workspaces.filter((workspace) => workspace.id !== workspaceId));
      return { success: true };
    });
  }

  function assign({ profileId, workspaceId } = {}) {
    return profileOperations.runGlobalMutation(async () => {
      if (workspaceId !== null && typeof workspaceId !== 'string') {
        return { success: false, error: 'Invalid workspace ID' };
      }
      const profiles = appStore.getProfiles();
      const profileIndex = profiles.findIndex((profile) => profile.id === profileId);
      if (profileIndex === -1) return { success: false, error: 'Profile not found' };
      if (
        workspaceId !== null
        && !appStore.getWorkspaces().some((workspace) => workspace.id === workspaceId)
      ) {
        return { success: false, error: 'Workspace not found' };
      }

      const profile = { ...profiles[profileIndex], workspaceId };
      profiles[profileIndex] = profile;
      appStore.setProfiles(profiles);
      return { success: true, profile };
    });
  }

  function setFavorite({ profileId, favorite } = {}) {
    return profileOperations.runGlobalMutation(async () => {
      if (typeof favorite !== 'boolean') {
        return { success: false, error: 'Invalid favorite value' };
      }
      const profiles = appStore.getProfiles();
      const profileIndex = profiles.findIndex((profile) => profile.id === profileId);
      if (profileIndex === -1) return { success: false, error: 'Profile not found' };

      const profile = { ...profiles[profileIndex], favorite };
      profiles[profileIndex] = profile;
      appStore.setProfiles(profiles);
      return { success: true, profile };
    });
  }

  return {
    list,
    create,
    rename,
    remove,
    assign,
    setFavorite,
  };
}

module.exports = {
  createWorkspaceService,
};
