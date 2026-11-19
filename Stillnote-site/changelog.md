# Stillnote log

## 2026-11-19

- Fixed macOS release builds when signing secrets are absent and allowed retrying an existing version tag from the corrected workflow.

- Prepared version 1.5.1 for npm and GitHub release, including the pending app improvements and installer update support.

## 2026-11-18

- Hid canvas object options until Shift is tapped; Shift toggles color, shape, text size, and endpoint controls without affecting typing or Shift shortcuts.

- Restricted canvas selection and text editing to the Select tool, cleared selections when switching tools, and let drawing tools work over existing objects.

- Reproduced the Bambu Studio slicing error, removed a leftover microscopic object from a copy of the case project, and verified that all three intended parts slice successfully into 71 layers with the original settings.

- Proposed a keyboard command to toggle Markdown task checkboxes on the current line or selected task lines.

- Checked the millimetre STL case and button exports and verified that all three slice successfully in Bambu Studio at 0.20 mm; identified a separate floating-region warning on the case bottom.

## 2026-11-17

- Made canvases expand in every direction, added text size editing, and added grid and object snapping with center and edge alignment guides.

- Added “Reveal in File Manager” to note options and file context menus, with disabled unsaved-note actions and a clear message for moved or deleted files.

- Proposed an offline command to reveal the active Markdown file in the system file manager.

## 2026-11-16

- Added high-resolution PNG export for the full Gantt chart, including every task row, milestone, and dependency.

- Added Settings → Version to check GitHub and download updates for macOS and Windows, with verified installers for releases that need a manual update.

- Numbered Gantt tasks by their order and subtasks by their hierarchy, such as 2.4, while preserving existing task and instance links.

- Kept Gantt context menus open until dismissal, placed new instances at the clicked time, and added a compact editor for individual instances.

- Gave Gantt charts six pastel hues with three saturation levels and lighter subtasks. Added numbered, linkable task instances with separate dates.

- Added Cohere for personal AI evaluation with a free monthly API allowance and documented its setup and key limits.

- Added Mistral Studio as the default AI provider for new setups and updated the website and README with its Free mode monthly token limits and setup steps.

- Let Home Work create editable Stillnote documents and use the requested format for text and code files.

- Fixed Home AI requests that Groq rejects when the model tries to call a tool directly.

- Enabled AI task edits in Gantt charts from the chart sidebar and Home Work.

- Retried the v1.5.0 release from its version tag, reusing the successful Windows build.

- Restricted release publishing to version tags so manual runs on a branch only build installers.

- Checked the v1.5.0 release during a GitHub Actions incident. The Windows build succeeded while the macOS job waited for a hosted runner.

- Synced Markdown note titles and filenames in both directions, preserving YAML properties and note content.

- Made the first line of a Markdown note its H1 title without requiring heading syntax.

- Replaced the Markdown view dropdown with an icon slider and displayed each note’s filename as a heading above its content.

- Proposed restoring each note’s cursor and scroll position when returning to it during the same session.

## 2026-11-15

- Added Live Preview, Source mode, and Reading view to the Markdown editor, with wiki-link completion, table previews, callouts, and note bodies independent of filenames.

- Made Home Work and the note editor save AI-generated tables as linked Stillnote spreadsheets.

- Put AI requests on hold during rate limits or credit shortages, and switched both AI composers to one line with a shared Send/Stop button.

- Made Home retry Groq JSON generation failures once and validate the reply before running any actions.

- Fixed a Groq schema error that prevented Home Ask and Work from starting.

- Changed the display extension for Gantt charts to `.gnt`.

- Made Stillnote start with the file explorer hidden and all folders collapsed.

- Created a printable community service hours log with space for supervisor signatures and page totals.

## 2026-11-14

- Matched date pickers, checkboxes, and inline field errors to Stillnote’s light, sepia, and dark themes.

- Added a Gantt header status for the first task happening now or the next upcoming task in that chart.

- Added a Jump to today button to the Gantt toolbar.

- Applied 2-pixel scrollbar thumbs with transparent tracks across Stillnote on macOS and Windows.

- Replaced native Gantt scrollbars with matching 2-pixel overlay thumbs on macOS and Windows.

- Added year and month labels at the widest Gantt zoom and reduced the scrollbar thumbs to 3 pixels with tracks that blend into the chart.

- Added AI and Agenda tabs to Home, moved recent chats to the left, and added task schedules, elapsed Gantt progress, and expandable task links. Home AI reads the agenda, and sidebar AI gets relevant entries.

- Simplified the Gantt controls and calendar, switched to 24-hour time, and added copyable links to individual tasks by chart and task ID.

- Reworked the Gantt chart with a resizable task list, calendar grid, collapsible groups, progress bars, milestones, dependency arrows, task search, and zoom to fit.

## 2026-11-13

- Checked Stillnote’s macOS release against the official Homebrew cask requirements. The current release needs Apple Developer ID signing and notarization to pass Gatekeeper.

- Automated Homebrew cask updates using the latest stable GitHub release and its macOS installer checksum.

- Added a Homebrew cask for installing and upgrading Stillnote on macOS.

## 2026-11-12

- Added Unpack folder to the explorer’s right-click menu to move its contents into the parent folder.

- Hid the Gantt timeline scrollbar while keeping horizontal scrolling available.

- Made Gantt timelines scroll in both directions from the current time, added horizontal zoom, and kept active drags stable while scrolling.

- Replaced the four Gantt toolbar text buttons with icons and tooltips.

- Kept Gantt dates stable after dragging, added whole-task moves and inline names, and put twelve pastel swatches in the task context menu.

- Added pastel Gantt task colors, draggable start and end times, and a labeled timeline grid.

- Moved Gantt task editing into a popup opened from the timeline.

- Added Gantt chart files with editable task schedules, inline previews in notes, and Google Tasks links.

- Kept spreadsheet tables on their own line when note preview wrapping is enabled.

- Replaced the note preview wrapping checkbox with an animated switch.

- Added an Editor layout setting to wrap note text around images and other previews or place it below them.

- Removed the Web file type and kept webpage links and previews in notes. Existing Web files open as regular notes with their URL.

- Opened Web files in a compact app window and added the same window option to inline previews for sites that block embedding.

- Added Web files for saving a URL and previewing its page, and embedded linked URLs and Web files in notes.

- Shortened long file labels in the middle so the ending and extension remain visible.

- Added a hold-Alt or Option sidebar view for files linked from the current file, with text excerpts, image previews, and video thumbnails.

## 2026-11-11

- Saved image and 3D preview dimensions in their links so resizing survives a reload.

- Replaced the top-bar location label with the Stillnote logo and wordmark.

- Shared the full in-app note syntax guide with Home Ask, Home Work, and the file assistant.

- Gave Home and file assistants vault-relative file and folder names so they can link to files without reading their contents.

- Kept the cursor after the Markdown marker when applying H1 or H2 from the note toolbar.

- Fixed saving breadcrumb renames and made file extensions read-only in the breadcrumb editor.

- Made file and folder names editable in the note breadcrumbs.

- Added a drop target at the bottom of the file explorer for moving files and folders to the vault root.

## 2026-11-10

### Added:

- Updated the website homepage for linked previews, Ask/Work AI, file context, and current workspace tools. Added searchable Docs covering file types, link syntax, spreadsheet ranges, canvas editing, media, tasks, integrations and API keys, privacy, PDF export, and shortcuts.

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
