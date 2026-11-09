# Stillnote log

## 2026-11-09 

### Added:

- Upgraded local transcription from Whisper Small to Whisper Medium while retaining 15-second recording intervals.

- Upgraded local transcription to Whisper Small and increased live transcription intervals to 15 seconds for more context. Stopping still transcribes the remaining audio.

- Fixed live local transcription: speech is appended to the current note in short chunks using Whisper Tiny, with remaining audio flushed on stop or navigation. Removed the automatic cloud summary and separate transcript file.

- Images now align to the top with text wrapping along their right side across multiple lines, then returning to full width below the image.

- Added bottom-right resize handles to embedded photos and 3D previews. Photos retain their aspect ratio; 3D previews resize freely.

- Added draggable spreadsheet row and column headers, keyboard reordering with Alt + arrow keys, and automatic formula reference updates to preserve calculations when cells move. Reordering supports undo and redo.

- Replaced the new-file dropdown with a compact grid of file-type icon buttons, with type labels on hover and keyboard focus.

- Added column renaming by double-click or F2. Custom names are saved, support undo/redo, and follow columns when reordered; letter-based formulas remain intact.

- Added feature requests; share an idea and prepare an email draft to review before sending.

- Created the log, a home for updates, written in Markdown.