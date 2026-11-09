# Website content

Serve this directory with a static web server (for example, `python3 -m http.server 8000`). The log fetches its Markdown file over HTTP.

## Updating the log

Edit `changelog.md`. Put newest entries first. Use `## YYYY-MM-DD — Title` for each entry and `### Added`, `### Changed`, or `### Fixed` for subsections. Paragraphs, bullet and numbered lists, **bold**, *emphasis*, inline code, and Markdown links are supported. Raw HTML is displayed as text.

## Feature requests

Set `FEATURE_REQUEST_EMAIL` at the top of `feature-requests.js` to the receiving inbox. While empty, the mail app opens a draft with no recipient. The form never sends email automatically; visitors review and send it in their mail app. Copy draft provides a fallback.
