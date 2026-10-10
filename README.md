# CueGrid

**A local cue board for live shows, streams, tabletop sessions, and presentations.**

CueGrid keeps short audio cues in a fast, touch-friendly grid. Add your own files, arrange them into boards, assign optional keys, set individual volume and loop behavior, and stop every sound instantly. Your audio stays in this browser profile; there is no account or upload service.

## Use

Open `index.html` in a modern browser. Add MP3, WAV, OGG, or other audio supported by your browser. Click a pad or press its displayed shortcut while the CueGrid tab is focused. Use **Stop all** to silence all active cues. Boards and audio are stored locally in IndexedDB.

Keyboard shortcuts only work while this page has focus. This web edition does not provide system-wide hotkeys, virtual microphone routing, or OBS integration.

## Included

- Multiple named boards with 24 pads each.
- Local audio import, rename, remove, per-pad volume and loop.
- Simultaneous cue playback, pad activity state, and a global stop control.
- Focus-aware keyboard shortcuts and large touch targets.
- No third-party libraries, remote fonts, trackers, or network requests.

## Privacy and storage

Audio files and board settings remain in the browser's local IndexedDB database. Clearing site data removes them. Keep separate backups of source audio. CueGrid does not read files until you select them and does not transmit them.

## Roadmap

- Export/import portable board bundles.
- Optional local-network remote control for a second screen.
- Native desktop edition with global hotkeys and audio routing.

## License

MIT. See [LICENSE](LICENSE).
