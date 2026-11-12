import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import AnyListClient from '../src/anylist-client.js';

// Fake anylist-js client: records the refreshCache flag passed to each
// full-account-download method so we can assert how often we re-download.
function makeFakeLib() {
  const calls = { getRecipes: [], getMealPlanningCalendarEvents: [], _getUserData: [] };
  const recipe = { identifier: 'r1', name: 'Chili', ingredients: [], preparationSteps: [], delete: async () => {} };
  const event = { identifier: 'e1', date: new Date('2026-11-12T12:00:00'), delete: async () => {} };
  return {
    calls,
    mealPlanningCalendarEventLabels: [],
    async getRecipes(refresh) { calls.getRecipes.push(refresh); return [recipe]; },
    async getMealPlanningCalendarEvents(refresh) { calls.getMealPlanningCalendarEvents.push(refresh); return [event]; },
    async _getUserData(refresh) { calls._getUserData.push(refresh); return { recipeDataResponse: { recipeCollections: [{ identifier: 'c1', name: 'Soups', recipeIds: ['r1'] }] } }; },
    async createRecipe(obj) { return { ...obj, identifier: 'new', save: async () => {} }; },
    async createEvent(obj) { return { ...obj, identifier: 'ev', save: async () => {} }; },
    createRecipeCollection(obj) { return { ...obj, identifier: 'col', save: async () => {}, delete: async () => {} }; },
  };
}

describe('AnyListClient account snapshot reuse', () => {
  let client, lib;

  beforeEach(() => {
    client = new AnyListClient({ username: 'u', password: 'p', defaultListName: 'Groceries' });
    lib = makeFakeLib();
    client.client = lib; // bypass connect(); snapshot starts stale
  });

  it('downloads once, then reuses the snapshot for repeated recipe reads', async () => {
    await client.getRecipes();
    await client.getRecipeDetails('Chili');
    await client.getRecipeDetails('Chili');
    assert.deepEqual(lib.calls.getRecipes, [true, false, false]);
  });

  it('shares one snapshot across recipes, meal plan and collections', async () => {
    await client.getRecipes();
    await client.getMealPlanEvents();
    await client.getMealPlanLabels();
    await client.getRecipeCollections();
    assert.deepEqual(lib.calls.getRecipes, [true, false]);
    assert.deepEqual(lib.calls.getMealPlanningCalendarEvents, [false, false]);
    assert.deepEqual(lib.calls._getUserData, [false]);
  });

  it('re-downloads once the snapshot is older than the TTL', async () => {
    await client.getRecipes();
    client._userDataFetchedAt = Date.now() - 6 * 60 * 1000;
    await client.getRecipes();
    assert.deepEqual(lib.calls.getRecipes, [true, true]);
  });

  it('re-downloads after a write that changes the snapshot', async () => {
    await client.getRecipes();
    await client.createRecipe({ name: 'New' });
    await client.getRecipes();
    await client.createMealPlanEvent({ date: '2026-11-13', title: 'Tacos' });
    await client.getMealPlanEvents();
    await client.createRecipeCollection('Weeknight', ['Chili']);
    await client.getRecipeCollections();
    await client.deleteRecipe('Chili'); // reuses the snapshot getRecipeCollections just refreshed
    await client.getRecipes();
    assert.deepEqual(lib.calls.getRecipes, [true, true, false, false, false, true]);
    assert.deepEqual(lib.calls.getMealPlanningCalendarEvents, [true]);
    assert.deepEqual(lib.calls._getUserData, [true]);
  });
});
