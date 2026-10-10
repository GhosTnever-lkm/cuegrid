(() => {
  'use strict';

  const DB_NAME = 'cuegrid-local';
  const DB_VERSION = 1;
  const MAX_PADS = 24;
  const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
  const COLORS = ['violet', 'cyan', 'amber', 'rose', 'lime'];
  const $ = (selector) => document.querySelector(selector);
  const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  let state = null;
  let editingId = null;
  let activeBoardId = null;
  let backupMode = 'replace';
  let toastTimer = 0;
  const playing = new Map();

  const freshState = () => {
    const id = crypto.randomUUID();
    return { activeBoardId: id, masterVolume: 0.8, boards: [{ id, name: 'Main board', cues: [] }] };
  };

  async function readState() {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const request = db.transaction('state', 'readonly').objectStore('state').get('workspace');
      request.onsuccess = () => resolve(request.result || freshState());
      request.onerror = () => reject(request.error);
    });
  }

  async function saveState() {
    try {
      const db = await dbPromise;
      await new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(state, 'workspace');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
      });
      return true;
    } catch (error) {
      showToast(`Couldn't save locally: ${error.message || 'browser storage is unavailable'}`);
      return false;
    }
  }

  function board() { return state.boards.find((item) => item.id === activeBoardId) || state.boards[0]; }
  function safeText(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function showToast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
  }

  function render() {
    activeBoardId = state.activeBoardId;
    const current = board();
    const tabs = $('#boardTabs');
    tabs.replaceChildren();
    for (const item of state.boards) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `board-tab${item.id === current.id ? ' active' : ''}`;
      button.textContent = item.name;
      button.setAttribute('aria-current', item.id === current.id ? 'page' : 'false');
      button.title = 'Double-click to rename this board';
      button.addEventListener('click', () => { state.activeBoardId = item.id; activeBoardId = item.id; saveState(); render(); });
      button.addEventListener('dblclick', () => renameBoard(item));
      tabs.append(button);
    }
    $('#boardCount').textContent = `${state.boards.length} board${state.boards.length === 1 ? '' : 's'}`;
    $('#masterVolume').value = Math.round(state.masterVolume * 100);
    $('#masterValue').textContent = `${Math.round(state.masterVolume * 100)}%`;

    const grid = $('#cueGrid');
    grid.replaceChildren();
    for (let index = 0; index < MAX_PADS; index += 1) {
      const cue = current.cues[index];
      const pad = document.createElement('button');
      pad.className = `cue-pad${cue ? '' : ' empty'}${cue && playing.has(cue.id) ? ' playing' : ''}`;
      pad.dataset.index = String(index);
      pad.dataset.color = cue?.color || 'violet';
      pad.setAttribute('role', 'group');
      if (cue) {
        const key = cue.key ? `<span class="pad-key">${safeText(cue.key.toUpperCase())}</span>` : '';
        pad.innerHTML = `<button class="cue-activate" type="button" data-activate="${cue.id}" aria-label="Play ${safeText(cue.name)}">${key}<span class="pad-icon" aria-hidden="true">${playing.has(cue.id) ? '♫' : '▶'}</span><span class="pad-name">${safeText(cue.name)}</span><span class="pad-meta">${cue.loop ? 'LOOPING' : 'PLAY CUE'} · ${Math.round(cue.volume * 100)}%</span></button><button class="edit-pad" type="button" data-edit="${cue.id}" aria-label="Edit ${safeText(cue.name)}">•••</button>`;
        pad.setAttribute('aria-label', `${cue.name}${cue.key ? `, shortcut ${cue.key}` : ''}${cue.loop ? ', loops' : ''}`);
      } else {
        const shortcut = defaultKey(index);
        pad.innerHTML = `<button class="cue-activate" type="button" data-activate-empty="${index}" aria-label="Add a sound to pad ${index + 1}"><span class="pad-key">${shortcut.toUpperCase()}</span><span class="pad-icon" aria-hidden="true">＋</span><span class="pad-name">Empty pad</span><span class="pad-meta">ADD A SOUND</span></button>`;
        pad.setAttribute('aria-label', `Empty pad ${index + 1}, add a sound`);
      }
      grid.append(pad);
    }
    $('#cueCount').textContent = String(current.cues.length);
  }

  function defaultKey(index) { return index < 9 ? String(index + 1) : 'abcdefghijklmno'[index - 9] || ''; }
  function renameBoard(item) {
    const name = prompt('Rename cue board', item.name);
    if (name === null) return;
    const trimmed = name.trim().slice(0, 32);
    if (!trimmed) return showToast('Board name cannot be empty');
    item.name = trimmed;
    saveState(); render();
  }

  function addFiles(files, padIndex = null) {
    const current = board();
    const accepted = [...files].filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm)$/i.test(file.name));
    if (!accepted.length) return showToast('Choose audio files supported by your browser');
    const room = MAX_PADS - current.cues.length;
    const selected = accepted.slice(0, room);
    if (!selected.length) return showToast('This board is full. Create another board to add more cues.');
    for (const [offset, file] of selected.entries()) {
      const stem = file.name.replace(/\.[^.]+$/, '').slice(0, 48) || `Cue ${current.cues.length + 1}`;
      const index = padIndex === null ? current.cues.length : padIndex + offset;
      const cue = { id: crypto.randomUUID(), name: stem, key: defaultKey(index), color: COLORS[index % COLORS.length], volume: 1, loop: false, blob: file, fileName: file.name };
      current.cues.splice(Math.min(index, current.cues.length), 0, cue);
    }
    if (accepted.length > selected.length) showToast(`Added ${selected.length}; create another board for the remaining files`);
    else showToast(`Added ${selected.length} cue${selected.length === 1 ? '' : 's'}`);
    saveState(); render();
  }

  function editCue(id) {
    const cue = board().cues.find((item) => item.id === id);
    if (!cue) return;
    editingId = id;
    $('#dialogTitle').textContent = cue.name;
    $('#cueName').value = cue.name;
    $('#cueKey').value = cue.key || '';
    $('#cueColor').value = cue.color;
    $('#cueVolume').value = Math.round(cue.volume * 100);
    $('#padValue').textContent = `${Math.round(cue.volume * 100)}%`;
    $('#cueLoop').checked = cue.loop;
    $('#editDialog').showModal();
  }

  function stopCue(id) {
    const entries = id ? [playing.get(id)].filter(Boolean) : [...playing.values()];
    for (const entry of entries) {
      entry.audio.pause();
      entry.audio.currentTime = 0;
      URL.revokeObjectURL(entry.url);
      playing.delete(entry.id);
    }
    render();
  }

  function playCue(cue) {
    if (playing.has(cue.id)) {
      stopCue(cue.id);
      if (cue.loop) return;
    }
    if (!cue.blob) return showToast('This cue has no stored audio file');
    const audio = new Audio();
    const url = URL.createObjectURL(cue.blob);
    audio.src = url;
    audio.loop = cue.loop;
    audio.volume = Math.max(0, Math.min(1, cue.volume * state.masterVolume));
    const entry = { id: cue.id, audio, url };
    playing.set(cue.id, entry);
    audio.addEventListener('ended', () => { if (playing.get(cue.id) === entry) { playing.delete(cue.id); URL.revokeObjectURL(url); render(); } });
    audio.addEventListener('error', () => { if (playing.get(cue.id) === entry) stopCue(cue.id); showToast(`Couldn't play ${cue.name}; format may not be supported`); });
    audio.play().then(render).catch((error) => { stopCue(cue.id); showToast(`Playback failed: ${error.message}`); });
    render();
  }

  $('#importButton').addEventListener('click', () => $('#fileInput').click());
  $('#exportBackup').addEventListener('click', async () => {
    try {
      const payload = await window.CueGridBackup.exportWorkspace(state, MAX_BACKUP_BYTES);
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `cuegrid-backup-${new Date().toISOString().slice(0, 10)}.cuegrid.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Backup downloaded with boards and audio');
    } catch (error) {
      showToast(`Backup failed: ${error.message}`);
    }
  });
  $('#importBackup').addEventListener('click', () => { backupMode = 'replace'; $('#backupInput').click(); });
  $('#importPack').addEventListener('click', () => { backupMode = 'merge'; $('#backupInput').click(); });
  $('#backupInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES * 1.4) return showToast('Backup file exceeds the 70 MiB limit');
    try {
      const restored = await window.CueGridBackup.importWorkspace(await file.text(), MAX_BACKUP_BYTES);
      const cueCount = restored.boards.reduce((total, item) => total + item.cues.length, 0);
      const previousState = state;
      if (backupMode === 'merge') {
        if (state.boards.length + restored.boards.length > 100) throw new Error('Adding this pack would exceed the 100-board limit');
        if (!confirm(`Add ${restored.boards.length} board(s) and ${cueCount} cue(s) to the current library?`)) return;
        const names = new Set(state.boards.map((item) => item.name.toLowerCase()));
        for (const item of restored.boards) {
          const baseName = item.name.slice(0, 26);
          let name = baseName;
          let suffix = 2;
          while (names.has(name.toLowerCase())) {
            const ending = ` (${suffix})`;
            name = `${baseName.slice(0, 32 - ending.length)}${ending}`;
            suffix += 1;
          }
          item.name = name;
          names.add(name.toLowerCase());
        }
        state = { ...state, boards: [...state.boards, ...restored.boards], activeBoardId: restored.boards[0].id };
      } else {
        if (!confirm(`Replace the current CueGrid library with ${restored.boards.length} board(s) and ${cueCount} cue(s)?`)) return;
        state = restored;
      }
      stopCue();
      activeBoardId = state.activeBoardId;
      const saved = await saveState();
      if (!saved) {
        state = previousState;
        activeBoardId = state.activeBoardId;
        render();
        return;
      }
      render();
      showToast(backupMode === 'merge' ? `Added ${restored.boards.length} board(s) and ${cueCount} cue(s)` : `Restored ${state.boards.length} board(s) and ${cueCount} cue(s)`);
    } catch (error) {
      showToast(`Restore failed: ${error.message}`);
    }
  });
  $('#newBoard').addEventListener('click', () => {
    if (state.boards.length >= 100) return showToast('CueGrid supports up to 100 boards');
    const name = prompt('Name this cue board', `Board ${state.boards.length + 1}`);
    if (name === null) return;
    const trimmed = name.trim().slice(0, 32);
    if (!trimmed) return showToast('Board name cannot be empty');
    const created = { id: crypto.randomUUID(), name: trimmed, cues: [] };
    state.boards.push(created); state.activeBoardId = created.id; activeBoardId = created.id;
    saveState(); render();
  });
  $('#stopAll').addEventListener('click', () => { stopCue(); showToast('All cues stopped'); });
  $('#masterVolume').addEventListener('input', (event) => {
    state.masterVolume = Number(event.target.value) / 100;
    $('#masterValue').textContent = `${event.target.value}%`;
    for (const entry of playing.values()) {
      const cue = board().cues.find((item) => item.id === entry.id);
      entry.audio.volume = Math.max(0, Math.min(1, (cue?.volume || 0) * state.masterVolume));
    }
    saveState();
  });
  $('#cueVolume').addEventListener('input', (event) => { $('#padValue').textContent = `${event.target.value}%`; });
  $('#editForm').addEventListener('submit', (event) => {
    const cue = board().cues.find((item) => item.id === editingId);
    if (!cue) return;
    const name = $('#cueName').value.trim();
    if (!name) { event.preventDefault(); return showToast('Enter a pad name'); }
    const key = $('#cueKey').value.trim().slice(0, 1).toLowerCase();
    const duplicate = key && board().cues.some((item) => item.id !== cue.id && item.key === key);
    if (duplicate) { event.preventDefault(); return showToast('That shortcut is already assigned on this board'); }
    cue.name = name.slice(0, 48);
    cue.key = key;
    cue.color = COLORS.includes($('#cueColor').value) ? $('#cueColor').value : 'violet';
    cue.volume = Number($('#cueVolume').value) / 100;
    cue.loop = $('#cueLoop').checked;
    const entry = playing.get(cue.id);
    if (entry) { entry.audio.loop = cue.loop; entry.audio.volume = cue.volume * state.masterVolume; }
    saveState();
  });
  $('#editDialog').addEventListener('close', () => { editingId = null; render(); });
  $('#removeCue').addEventListener('click', () => {
    const cue = board().cues.find((item) => item.id === editingId);
    if (!cue || !confirm(`Remove “${cue.name}” from this board?`)) return;
    stopCue(cue.id);
    board().cues = board().cues.filter((item) => item.id !== cue.id);
    $('#editDialog').close(); saveState(); render();
  });
  $('#clearBoard').addEventListener('click', () => {
    const current = board();
    if (!current.cues.length || !confirm(`Remove every cue from “${current.name}”?`)) return;
    for (const cue of current.cues) stopCue(cue.id);
    current.cues = []; saveState(); render();
  });

  $('#cueGrid').addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit]');
    if (editButton) { event.stopPropagation(); return editCue(editButton.dataset.edit); }
    const activate = event.target.closest('[data-activate]');
    if (activate) { const cue = board().cues.find((item) => item.id === activate.dataset.activate); if (cue) playCue(cue); return; }
    const empty = event.target.closest('[data-activate-empty]');
    if (empty) { $('#fileInput').dataset.padIndex = empty.dataset.activateEmpty; $('#fileInput').click(); }
  });
  $('#fileInput').addEventListener('change', (event) => {
    const index = event.target.dataset.padIndex;
    addFiles(event.target.files, index === undefined ? null : Number(index));
    delete event.target.dataset.padIndex;
    event.target.value = '';
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || $('#editDialog').open) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;
    if (event.key === 'Escape') { stopCue(); return; }
    const key = event.key.toLowerCase();
    const cue = board().cues.find((item) => item.key && item.key.toLowerCase() === key);
    if (cue) { event.preventDefault(); playCue(cue); }
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm)$/i.test(file.name));
    if (files.length) addFiles(files);
  });
  window.addEventListener('beforeunload', () => stopCue());

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch(() => showToast('Offline cache is unavailable in this browser'));
  }

  readState().then((loaded) => {
    state = loaded;
    if (!Array.isArray(state.boards) || !state.boards.length) state = freshState();
    for (const item of state.boards) if (!Array.isArray(item.cues)) item.cues = [];
    if (!state.boards.some((item) => item.id === state.activeBoardId)) state.activeBoardId = state.boards[0].id;
    activeBoardId = state.activeBoardId;
    render(); saveState();
  }).catch((error) => {
    state = freshState(); activeBoardId = state.activeBoardId; render();
    showToast(`Local storage could not be opened: ${error.message}`);
  });
})();
