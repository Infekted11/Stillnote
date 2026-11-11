# Stillnote log

## 2026-11-10

### Added:

- Added per-link preview suppression with <[!!!File.md]> while preserving navigation, renames, and backlinks. Graph, geometry, and 3D calculator links now show isolated graph-only previews without equation lists or editing controls. Updated the syntax guide and PDF rendering.

- Deleted vault files now stop rendering linked previews, including saved canvas image fallbacks. Broken file links appear red in notes, canvas text, spreadsheets, and Home citations. Directory watching and focus refresh keep links current after external changes; autosave cannot recreate deleted files.

- Replaced the default find-and-replace panel in note and code editors with an app-styled panel, live match counts, next/previous navigation, case and whole-word options, regex search, undoable replacement, and theme support. Ctrl/Cmd+F opens it; Escape closes it before other navigation.

- Sidebar AI now includes files directly linked from the current document as read-only context, including selectable PDF text. Context is bounded, deduplicated, and refreshed for each request; missing files, truncated content, and media-only references are marked.

- Added display-only file extensions for graphs (.grph), 3D calculators (.3d), canvases (.cnvs), geometry (.geom), task sheets (.task), and spreadsheets (.sht). File lists, search, link pickers, and location labels show the type while real Markdown filenames and links stay unchanged.

- Added Anthropic (Claude) as an optional AI provider for Home Ask/Work and file assistance, with separate encrypted API keys, paginated model discovery, validated structured responses, and saved provider/model preferences.

- Replaced FreeModel with Groq as the default free cloud AI provider, with daily-limit guidance, strict structured responses, compatible model discovery, separate encrypted keys, and a cancellable retry for short rate limits. OpenAI remains optional; updated setup instructions and website copy.

- Added FreeModel as the default cloud AI provider with its advertised recurring monthly free allowance, model discovery, separate encrypted keys, validated assistant responses, and quota errors. OpenAI remains selectable; updated setup instructions and website copy.

- Switched AI features from Nous to the OpenAI Responses API, with separate encrypted OpenAI API keys, supported-model discovery, structured responses, and updated app and website copy.

- Replaced Ollama Cloud with Nous Research for Home Ask/Work, note assistance, edits, and task assistance. Added Nous model discovery, separate encrypted Nous credentials, updated setup documentation, and website copy.

- Enter sends Home AI prompts in Ask and Work modes; Shift+Enter inserts a new line.

## 2026-11-09 

### Added:

- Escape now returns from any open file to Home when no other Escape action applies. Popups, menus, dialogs, fullscreen, and editor keyboard actions keep priority.

- Added separate Home AI Ask and Work buttons. Ask reads and compares notes, PDFs, data, and file relationships. Work plans multi-step requests, asks follow-up questions, creates and updates linked files, analyzes data, and creates and links Google Tasks, with visible progress, cancellation, and resumable conversations.

- PDF export now includes rendered images, canvases, spreadsheet ranges, 3D model snapshots, equations, task references, and highlights. Audio/video embeds and links are omitted. Export waits for images and fonts and supports larger illustrated notes.

- Made embedded audio players more compact and moved playback speed into each audio/video file’s playback settings. Speed is remembered per file and applied to note embeds.

- Replaced native audio/video controls with custom players for note embeds and file previews, including seeking, volume, playback speed, keyboard controls, and video fullscreen.

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
