const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createProfileOperationCoordinator,
} = require('../lib/profile-operation-coordinator');

let createWorkspaceService;
try {
  ({ createWorkspaceService } = require('../lib/workspace-service'));
} catch {
  // The first TDD run intentionally exercises the missing service.
}

function createServiceFixture({ profiles = [], workspaces = [], rejectSplitWrites = false } = {}) {
  let storeState = {
    profiles: structuredClone(profiles),
    workspaces: structuredClone(workspaces),
  };
  let identifier = 0;
  const profileOperations = createProfileOperationCoordinator();
  const appStore = {
    getProfiles: () => structuredClone(storeState.profiles),
    setProfiles: (nextProfiles) => {
      if (rejectSplitWrites) throw new Error('Separate profile writes are not allowed');
      storeState.profiles = structuredClone(nextProfiles);
    },
    getWorkspaces: () => structuredClone(storeState.workspaces),
    setWorkspaces: (nextWorkspaces) => {
      if (rejectSplitWrites) throw new Error('Separate workspace writes are not allowed');
      storeState.workspaces = structuredClone(nextWorkspaces);
    },
    setProfilesAndWorkspaces: (nextProfiles, nextWorkspaces) => {
      storeState = {
        profiles: structuredClone(nextProfiles),
        workspaces: structuredClone(nextWorkspaces),
      };
    },
  };
  const service = createWorkspaceService({
    appStore,
    profileOperations,
    randomUUID: () => `workspace-${++identifier}`,
    now: () => '2026-08-30T00:00:00.000Z',
  });

  return {
    service,
    appStore,
    profileOperations,
    storeState: () => structuredClone(storeState),
  };
}

test('creates and lists uniquely named workspaces without filesystem-name restrictions', async () => {
  const fixture = createServiceFixture();

  const created = await fixture.service.create({ name: 'Release: Q3' });

  assert.deepEqual(created, {
    success: true,
    workspace: {
      id: 'workspace-1',
      name: 'Release: Q3',
      createdAt: '2026-08-30T00:00:00.000Z',
    },
  });
  assert.deepEqual(fixture.service.list(), [created.workspace]);
  assert.deepEqual(
    await fixture.service.create({ name: 'release: q3' }),
    { success: false, error: 'Workspace name already exists' },
  );
  assert.deepEqual(
    await fixture.service.create({ name: 'Café' }),
    {
      success: true,
      workspace: {
        id: 'workspace-2',
        name: 'Café',
        createdAt: '2026-08-30T00:00:00.000Z',
      },
    },
  );
  assert.deepEqual(
    await fixture.service.create({ name: 'Cafe\u0301' }),
    { success: false, error: 'Workspace name already exists' },
  );
  assert.deepEqual(
    await fixture.service.create({ name: ' '.repeat(81) }),
    { success: false, error: 'Invalid workspace name' },
  );
  assert.deepEqual(
    await fixture.service.create({ name: ' Release: Q4' }),
    { success: false, error: 'Invalid workspace name' },
  );
});

test('removing a workspace only clears profile membership', async () => {
  const fixture = createServiceFixture({
    profiles: [{ id: 'profile-1', workspaceId: 'w1', favorite: false }],
    workspaces: [{ id: 'w1', name: 'Work', createdAt: '2026-08-30T00:00:00.000Z' }],
  });

  assert.deepEqual(await fixture.service.remove({ workspaceId: 'w1' }), { success: true });
  assert.equal(fixture.storeState().profiles[0].workspaceId, null);
  assert.equal(fixture.storeState().profiles.length, 1);
  assert.deepEqual(fixture.storeState().workspaces, []);
});

test('removing a workspace persists membership cleanup with one atomic store update', async () => {
  const fixture = createServiceFixture({
    profiles: [{ id: 'profile-1', workspaceId: 'w1', favorite: false }],
    workspaces: [{ id: 'w1', name: 'Work', createdAt: '2026-08-30T00:00:00.000Z' }],
    rejectSplitWrites: true,
  });

  assert.deepEqual(await fixture.service.remove({ workspaceId: 'w1' }), { success: true });
  assert.deepEqual(fixture.storeState(), {
    profiles: [{ id: 'profile-1', workspaceId: null, favorite: false }],
    workspaces: [],
  });
});

test('renames an existing workspace with validation and duplicate protection', async () => {
  const fixture = createServiceFixture({
    workspaces: [
      { id: 'w1', name: 'Work', createdAt: '2026-08-30T00:00:00.000Z' },
      { id: 'w2', name: 'Personal', createdAt: '2026-08-30T00:00:00.000Z' },
    ],
  });

  assert.deepEqual(
    await fixture.service.rename({ workspaceId: 'w1', name: 'Projects' }),
    {
      success: true,
      workspace: { id: 'w1', name: 'Projects', createdAt: '2026-08-30T00:00:00.000Z' },
    },
  );
  assert.deepEqual(
    await fixture.service.rename({ workspaceId: 'w2', name: 'projects' }),
    { success: false, error: 'Workspace name already exists' },
  );
  assert.deepEqual(
    await fixture.service.rename({ workspaceId: 'missing', name: 'Other' }),
    { success: false, error: 'Workspace not found' },
  );
});

test('assigns, ungroups, and favorites known profiles with strict input validation', async () => {
  const fixture = createServiceFixture({
    profiles: [{ id: 'profile-1', workspaceId: null, favorite: false }],
    workspaces: [{ id: 'w1', name: 'Work', createdAt: '2026-08-30T00:00:00.000Z' }],
  });

  assert.deepEqual(
    await fixture.service.assign({ profileId: 'profile-1', workspaceId: 'w1' }),
    { success: true, profile: { id: 'profile-1', workspaceId: 'w1', favorite: false } },
  );
  assert.deepEqual(
    await fixture.service.assign({ profileId: 'profile-1', workspaceId: null }),
    { success: true, profile: { id: 'profile-1', workspaceId: null, favorite: false } },
  );
  assert.deepEqual(
    await fixture.service.assign({ profileId: 'profile-1', workspaceId: 'missing' }),
    { success: false, error: 'Workspace not found' },
  );
  assert.deepEqual(
    await fixture.service.setFavorite({ profileId: 'profile-1', favorite: true }),
    { success: true, profile: { id: 'profile-1', workspaceId: null, favorite: true } },
  );
  assert.deepEqual(
    await fixture.service.setFavorite({ profileId: 'profile-1', favorite: 'true' }),
    { success: false, error: 'Invalid favorite value' },
  );
});

test('serializes workspace assignment and favorite updates with global profile mutations', async () => {
  const fixture = createServiceFixture({
    profiles: [{ id: 'profile-1', workspaceId: null, favorite: false }],
    workspaces: [{ id: 'w1', name: 'Work', createdAt: '2026-08-30T00:00:00.000Z' }],
  });
  let releaseConcurrentMutation;
  const concurrentMutation = fixture.profileOperations.runGlobalMutation(async () => {
    const profiles = fixture.storeState().profiles;
    await new Promise((resolve) => {
      releaseConcurrentMutation = resolve;
    });
    profiles[0].favorite = true;
    fixture.appStore.setProfiles(profiles);
  });

  await new Promise((resolve) => setImmediate(resolve));
  const assignment = fixture.service.assign({ profileId: 'profile-1', workspaceId: 'w1' });
  releaseConcurrentMutation();
  await Promise.all([concurrentMutation, assignment]);

  assert.deepEqual(fixture.storeState().profiles, [
    { id: 'profile-1', workspaceId: 'w1', favorite: true },
  ]);

  let releaseConcurrentWorkspaceMutation;
  const concurrentWorkspaceMutation = fixture.profileOperations.runGlobalMutation(async () => {
    const profiles = fixture.storeState().profiles;
    await new Promise((resolve) => {
      releaseConcurrentWorkspaceMutation = resolve;
    });
    profiles[0].workspaceId = null;
    fixture.appStore.setProfiles(profiles);
  });

  await new Promise((resolve) => setImmediate(resolve));
  const favorite = fixture.service.setFavorite({ profileId: 'profile-1', favorite: false });
  releaseConcurrentWorkspaceMutation();
  await Promise.all([concurrentWorkspaceMutation, favorite]);

  assert.deepEqual(fixture.storeState().profiles, [
    { id: 'profile-1', workspaceId: null, favorite: false },
  ]);
});
