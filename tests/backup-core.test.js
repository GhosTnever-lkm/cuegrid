const test = require('node:test');
const assert = require('node:assert/strict');
const { exportWorkspace, importWorkspace } = require('../backup-core.js');

function sampleWorkspace() {
  const audio = new Blob([Uint8Array.from([0, 1, 2, 127, 128, 255])], { type: 'audio/wav' });
  return {
    activeBoardId: 'board-b',
    masterVolume: 0.65,
    boards: [
      { id: 'board-a', name: 'Warm-up', cues: [{ id: 'cue-a', name: 'Intro', key: 'i', color: 'cyan', volume: 0.4, loop: false, fileName: 'intro.wav', blob: audio }] },
      { id: 'board-b', name: 'Main', cues: [{ id: 'cue-b', name: 'Loop', key: '2', color: 'rose', volume: 0.9, loop: true, fileName: 'loop.wav', blob: new Blob([Uint8Array.from([10, 20, 30])], { type: 'audio/ogg' }) }] }
    ]
  };
}

test('backup round-trip preserves boards, settings, audio bytes, and active board', async () => {
  const encoded = await exportWorkspace(sampleWorkspace());
  const restored = await importWorkspace(encoded);
  assert.equal(restored.boards.length, 2);
  assert.equal(restored.boards[0].name, 'Warm-up');
  assert.equal(restored.boards[1].cues[0].loop, true);
  assert.equal(restored.boards[1].cues[0].blob.type, 'audio/ogg');
  assert.deepEqual([...new Uint8Array(await restored.boards[0].cues[0].blob.arrayBuffer())], [0, 1, 2, 127, 128, 255]);
  assert.equal(restored.masterVolume, 0.65);
  assert.equal(restored.activeBoardId, restored.boards[1].id);
});

test('rejects malformed JSON and unsupported formats', async () => {
  await assert.rejects(importWorkspace('{'), /valid JSON/);
  await assert.rejects(importWorkspace(JSON.stringify({ format: 'other', version: 1, boards: [{}] })), /Unsupported or invalid/);
});

test('rejects repeated shortcuts before returning any workspace', async () => {
  const source = JSON.parse(await exportWorkspace(sampleWorkspace()));
  source.boards[0].cues.push({ ...source.boards[0].cues[0], name: 'Duplicate' });
  await assert.rejects(importWorkspace(JSON.stringify(source)), /repeated on a board/);
});

test('rejects excess board, pad, and audio limits', async () => {
  const state = sampleWorkspace();
  await assert.rejects(exportWorkspace({ ...state, boards: Array.from({ length: 101 }, (_, id) => ({ id: String(id), name: 'Board', cues: [] })) }), /1–100 boards/);
  const fullBoard = { ...state.boards[0], cues: Array(25).fill(state.boards[0].cues[0]) };
  await assert.rejects(exportWorkspace({ ...state, boards: [fullBoard] }), /up to 24 cues/);
  const tooLarge = new Blob([new Uint8Array(11)], { type: 'audio/wav' });
  await assert.rejects(exportWorkspace({ ...state, boards: [{ id: 'one', name: 'One', cues: [{ ...state.boards[0].cues[0], blob: tooLarge }] }] }, 10), /Total audio exceeds/);
});

test('rejects empty, malformed, and unsupported audio attachments', async () => {
  const source = JSON.parse(await exportWorkspace(sampleWorkspace()));
  source.boards[0].cues[0].audioBase64 = '%%%';
  await assert.rejects(importWorkspace(JSON.stringify(source)), /not valid base64/);
  source.boards[0].cues[0].audioBase64 = '';
  await assert.rejects(importWorkspace(JSON.stringify(source)), /empty/);
});

test('does not preserve executable markup from board or cue names as HTML', async () => {
  const state = sampleWorkspace();
  state.boards[0].name = '<img src=x>';
  state.boards[0].cues[0].name = '<script>alert(1)</script>';
  const restored = await importWorkspace(await exportWorkspace(state));
  assert.equal(restored.boards[0].name, '<img src=x>');
  assert.equal(restored.boards[0].cues[0].name, '<script>alert(1)</script>');
});
