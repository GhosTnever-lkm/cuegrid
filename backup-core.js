(() => {
  'use strict';
  const FORMAT = 'cuegrid-workspace';
  const VERSION = 1;
  const MAX_BOARDS = 100;
  const MAX_PADS = 24;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const COLORS = new Set(['violet', 'cyan', 'amber', 'rose', 'lime']);

  function bytesToBase64(bytes) {
    let binary = '';
    const step = 0x8000;
    for (let start = 0; start < bytes.length; start += step) {
      binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + step, bytes.length)));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    if (typeof value !== 'string' || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throw new Error('An audio attachment is not valid base64');
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function validName(value, max, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is missing or too long`);
    return value.trim();
  }

  async function exportWorkspace(workspace, maxBytes = 50 * 1024 * 1024) {
    if (!workspace || !Array.isArray(workspace.boards) || !workspace.boards.length || workspace.boards.length > MAX_BOARDS) {
      throw new Error(`A backup must contain 1–${MAX_BOARDS} boards`);
    }
    let totalBytes = 0;
    const boards = [];
    for (const item of workspace.boards) {
      if (!Array.isArray(item.cues) || item.cues.length > MAX_PADS) throw new Error(`Each board can contain up to ${MAX_PADS} cues`);
      const cues = [];
      for (const cue of item.cues) {
        if (!(cue.blob instanceof Blob) || cue.blob.size === 0) throw new Error(`The audio for “${validName(cue.name, 48, 'Cue name')}” is unavailable or empty`);
        if (cue.blob.size > MAX_FILE_BYTES) throw new Error('An audio file exceeds the 25 MiB per-file limit');
        totalBytes += cue.blob.size;
        if (totalBytes > maxBytes) throw new Error('Total audio exceeds the 50 MiB backup limit');
        cues.push({
          name: validName(cue.name, 48, 'Cue name'), key: String(cue.key || '').slice(0, 1),
          color: COLORS.has(cue.color) ? cue.color : 'violet',
          volume: Math.max(0, Math.min(1, Number(cue.volume) || 0)), loop: Boolean(cue.loop),
          fileName: validName(cue.fileName || `${cue.name}.audio`, 255, 'Audio filename'),
          mimeType: cue.blob.type || 'application/octet-stream',
          audioBase64: bytesToBase64(new Uint8Array(await cue.blob.arrayBuffer()))
        });
      }
      boards.push({ name: validName(item.name, 32, 'Board name'), cues });
    }
    return JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), masterVolume: Math.max(0, Math.min(1, Number(workspace.masterVolume) || 0)), activeBoardIndex: Math.max(0, workspace.boards.findIndex((item) => item.id === workspace.activeBoardId)), boards });
  }

  async function importWorkspace(text, maxBytes = 50 * 1024 * 1024) {
    if (typeof text !== 'string' || text.length > Math.ceil(maxBytes * 1.4)) throw new Error('Backup file exceeds the 70 MiB limit');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Backup is not valid JSON'); }
    if (!data || data.format !== FORMAT || data.version !== VERSION || !Array.isArray(data.boards) || !data.boards.length || data.boards.length > MAX_BOARDS) {
      throw new Error('Unsupported or invalid CueGrid backup');
    }
    let totalBytes = 0;
    const boards = [];
    for (const item of data.boards) {
      if (!item || !Array.isArray(item.cues) || item.cues.length > MAX_PADS) throw new Error(`Each board can contain up to ${MAX_PADS} cues`);
      const keys = new Set();
      const cues = [];
      for (const cue of item.cues) {
        if (!cue || typeof cue !== 'object') throw new Error('Invalid cue entry');
        const name = validName(cue.name, 48, 'Cue name');
        const key = String(cue.key || '').slice(0, 1).toLowerCase();
        if (key && !/^[a-z0-9]$/.test(key)) throw new Error('Cue shortcuts must be one letter or number');
        if (key && keys.has(key)) throw new Error(`Shortcut “${key}” is repeated on a board`);
        if (key) keys.add(key);
        if (!COLORS.has(cue.color)) throw new Error('Cue color is invalid');
        if (typeof cue.volume !== 'number' || !Number.isFinite(cue.volume) || cue.volume < 0 || cue.volume > 1) throw new Error('Cue volume must be between 0 and 1');
        if (typeof cue.loop !== 'boolean') throw new Error('Cue loop setting is invalid');
        const fileName = validName(cue.fileName, 255, 'Audio filename');
        const audioBytes = base64ToBytes(cue.audioBase64);
        if (!audioBytes.byteLength) throw new Error('An audio attachment is empty');
        if (audioBytes.byteLength > MAX_FILE_BYTES) throw new Error('An audio file exceeds the 25 MiB per-file limit');
        totalBytes += audioBytes.byteLength;
        if (totalBytes > maxBytes) throw new Error('Total audio exceeds the 50 MiB backup limit');
        const mimeType = typeof cue.mimeType === 'string' && /^audio\/[a-z0-9.+-]+$/i.test(cue.mimeType) ? cue.mimeType : 'application/octet-stream';
        cues.push({ id: crypto.randomUUID(), name, key, color: cue.color, volume: cue.volume, loop: cue.loop, fileName, blob: new Blob([audioBytes], { type: mimeType }) });
      }
      boards.push({ id: crypto.randomUUID(), name: validName(item.name, 32, 'Board name'), cues });
    }
    const activeIndex = Number.isInteger(data.activeBoardIndex) ? Math.max(0, Math.min(boards.length - 1, data.activeBoardIndex)) : 0;
    const volume = typeof data.masterVolume === 'number' && Number.isFinite(data.masterVolume) ? Math.max(0, Math.min(1, data.masterVolume)) : 0.8;
    return { activeBoardId: boards[activeIndex].id, masterVolume: volume, boards };
  }

  const api = { exportWorkspace, importWorkspace };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CueGridBackup = api;
})();
