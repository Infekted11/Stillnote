# Stillnote

A local-first Markdown notes app starter built with Electron, Vite, and CodeMirror 6.

## Run it

```sh
npm install
npm start
```

`npm start` builds the renderer and opens it in Electron. `npm run dev` runs Vite and Electron together for development. `npm run build` creates the renderer bundle in `dist/`.

## Included

- Open any folder as a vault. Notes remain ordinary `.md` files in that folder.
- Browse a collapsible folder tree, including empty folders, create notes, and save edits automatically.
- Use the sidebar as a file explorer: create folders and notes from the toolbar, or right-click an item to create inside a folder, rename, or delete it.
- Create code files in common languages from the new-file menu. Code opens in a monospace editor with line numbers, folding, bracket matching, indentation, and syntax highlighting for JavaScript/TypeScript, Python, HTML/XML, CSS, and JSON.
- Link to any supported vault file from notes or canvas text with `<[relative/path.ext]>`; note links without an extension still resolve to Markdown notes. Existing `[[...]]` links remain supported.
- Edit with CodeMirror 6 live Markdown rendering, including unordered and ordered lists. Formatting appears on lines outside the caret, while the active line keeps its Markdown syntax visible for editing.
- Restore the last open vault and note on launch, and choose Light, Sepia, or Dark from the settings menu.
- Use the right-side note assistant to ask questions about the open note or request a complete Markdown edit. AI edits are previewed and applied only when you choose **Apply to note**.
- Store an Ollama Cloud API key encrypted with Electron's OS-backed secure storage.
- Create task sheets linked to Google Tasks lists. Tasks sync when opened or when you press **Sync**.
- Search note titles with `⌘K` / `Ctrl+K`.
- Electron context isolation and a narrow preload API for vault file access.

## Shortcuts

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Search notes | `⌘K` | `Ctrl+K` |
| New note | `⌘N` | `Ctrl+N` |
| Save now | `⌘S` | `Ctrl+S` |

## Build installers

Install dependencies with `npm install`, then run the packaging command for your current operating system:

```sh
npm run dist:mac
npm run dist:win
npm run dist:linux
```

The installers are written to `release/`. macOS creates a DMG and ZIP, Windows creates an NSIS installer, and Linux creates an AppImage and DEB package. `npm run dist` asks electron-builder to package for the host platform. Cross-platform builds are not equally reliable from every host. The GitHub Actions workflow in `.github/workflows/package.yml` builds each platform on its native runner; run it manually from the Actions tab or push a version tag such as `v0.1.0` to create downloadable artifacts.

Unsigned macOS builds can be opened locally, but distributing them broadly requires Apple Developer signing and notarization to avoid Gatekeeper warnings. Windows builds can also be signed with a code-signing certificate; without one, Windows may show a reputation warning.

The assistant uses Ollama Cloud's `https://ollama.com/api/chat` endpoint. Configure the API key and cloud model in **Settings → AI settings**. The app sends the current note and your request to Ollama when you submit a prompt.

Google Tasks needs credentials for an OAuth **Desktop app**. In Google Cloud Console, enable the Google Tasks API, create a Desktop app OAuth client, then save its client ID and client secret in **Settings → Google Tasks** and connect your account. Task sheet files are Markdown with an embedded task list ID and a local task cache; the Google Tasks list is the source of truth and changes sync from Google when you open or refresh the sheet.

Each person using Stillnote enters their own Ollama Cloud and Desmos API keys, and their own Google Tasks OAuth Desktop app credentials, in Settings. Those credentials are encrypted together in the hidden `.stillnote-credentials.enc` file at the root of the selected vault. Electron encrypts the file with the operating system account, so it can be decrypted on the same device and account only; users should enter their keys again on another device. The personal dictionary is stored separately in the encrypted `.stillnote-dictionary.enc` file in the selected vault. The explorer hides both files, and the DMG build explicitly excludes them and `.env` files. Do not share the vault folder if you want to keep its credentials or personal dictionary private. Existing Ollama and Google credentials migrate from the app data folder when a vault is opened, and an existing Desmos key migrates from local app storage.
