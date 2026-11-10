# Stillnote log

## 2026-11-09 

### Added:

- Linked spreadsheets render as tables in notes with internal grid lines and stronger first-row/column separators. Previews fit populated cells by default; add a cell endpoint such as #D8 to show A1 through D8. Documented the syntax in the existing guide.

- Removed canvas selection glow and soft shadows from canvas tools, text fields, and menus while preserving selection outlines and handles.

- Fixed canvas text editing so clicking and selecting text preserves the caret, multiline text survives blur, pasted content stays plain, and text undo works without replacing the canvas. New text fields enter editing immediately; Alt-drag moves text fields.

- Canvas image insertion now opens a link field and searchable vault image list. Vault image references follow renames and moves, including undo history, and retain a saved image if the source is deleted.

- Expanded the existing syntax guide with spreadsheet formulas, calculation rules, supported logic, and error explanations.

- Added an image button to canvases. Images are embedded in the canvas file behind existing elements, with support for moving, resizing, rotating, and undo/redo.

- Linked canvases now render read-only previews inside notes. Added audio and video file viewing and inline playback controls for linked media.

- Matched website icons to the app’s custom outline SVGs across the demo, feature cards, integrations, and workspace tools.

- Changed the header title and navigation text to invert the colors behind them.

- Made the site menu bar nearly transparent while retaining its background blur.

- Fixed live local transcription: speech is appended to the current note in short chunks using Whisper Medium in 15-second recording intervals, with remaining audio transcribed after stopping. Removed the automatic cloud summary and separate transcript file.

- Images now align to the top with text wrapping along their right side across multiple lines, then returning to full width below the image.

- Added bottom-right resize handles to embedded photos and 3D previews. Photos retain their aspect ratio; 3D previews resize freely.

- Added draggable spreadsheet row and column headers, keyboard reordering with Alt + arrow keys, and automatic formula reference updates to preserve calculations when cells move. Reordering supports undo and redo.

- Replaced the new-file dropdown with a compact grid of file-type icon buttons, with type labels on hover and keyboard focus.

- Added column renaming by double-click or F2. Custom names are saved, support undo/redo, and follow columns when reordered; letter-based formulas remain intact.

- Added feature requests; share an idea and prepare an email draft to review before sending.

- Created the log, a home for updates, written in Markdown.