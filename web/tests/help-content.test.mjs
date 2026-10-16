import test from 'node:test';
import assert from 'node:assert/strict';
import {
  helpChapters,
  helpTopics,
  quickStartCards,
  searchTopics,
  topicForPage,
  topicsFor,
} from '../src/help-content.mjs';
import { navigationPages } from '../src/page-access.mjs';

test('help: every topic is complete, in a known chapter, with unique ids and real page names', () => {
  const ids = new Set();
  for (const t of helpTopics) {
    assert.ok(!ids.has(t.id), `duplicate ${t.id}`);
    ids.add(t.id);
    assert.ok(
      helpChapters.some((c) => c.id === t.chapter),
      t.id,
    );
    assert.ok(t.title && t.summary && t.steps.length >= 2, t.id);
    for (const page of t.pages) assert.ok(navigationPages.includes(page), `${t.id}: ${page}`);
  }
  for (const card of Object.values(quickStartCards)) for (const id of card.topics) assert.ok(ids.has(id), id);
});

test('help: a page opens its topic, and search finds by words', () => {
  assert.equal(topicForPage('Point of Service', 1).id, 'new-job');
  assert.equal(topicForPage('Users', 1), null);
  assert.equal(searchTopics(topicsFor(1), 'receipt pdf')[0].id, 'receipts');
  assert.equal(searchTopics(topicsFor(1), 'zzzz').length, 0);
});

test('help: every video belongs to real topics, and a video id shows on its topics', async () => {
  const { helpVideos, videoFor } = await import('../src/help-videos.mjs');
  const { videos } = await import('../scripts/tutorials/videos.mjs');
  const ids = new Set(helpTopics.map((t) => t.id));
  for (const [file, v] of Object.entries(helpVideos))
    for (const topic of v.topics) assert.ok(ids.has(topic), `${file}: ${topic}`);
  // Every recorded video has a place in Help.
  for (const v of videos) assert.ok(helpVideos[v.id], v.id);
  assert.equal(videoFor('new-job'), '');
  helpVideos['02-taking-a-job'].youtube = 'abc123';
  assert.equal(videoFor('new-job'), 'abc123');
  helpVideos['02-taking-a-job'].youtube = '';
});
