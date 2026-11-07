# Stillnote

A local-first Markdown notes app starter built with Electron, Vite, and CodeMirror 6.

## Install the npm package

Stillnote is available from the public npm registry. Install Node.js and npm, then install and launch the app:

```sh
npm install --global @infekted11/stillnote@latest
stillnote
```

The first launch downloads the Electron binary for your platform and requires an internet connection. Later launches reuse that binary. See [Electron's installation notes](https://www.electronjs.org/docs/latest/tutorial/installation#binary-download-step).

To update Stillnote to the latest published version, run:

```sh
npm install --global @infekted11/stillnote@latest
```

Your vault notes and settings are stored outside the npm package and remain available when you update it.

## Run from source

To run or develop the app from a checkout, install the repository dependencies and start Electron:

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

The installers are written to `release/`. macOS creates a DMG and ZIP, Windows creates an NSIS installer, and Linux creates an AppImage and DEB package. `npm run dist` asks electron-builder to package for the host platform. Cross-platform builds are not equally reliable from every host. To create a GitHub release with installers for all three platforms, push a version tag matching the package version, such as `v1.1.0`. The workflow in `.github/workflows/release-app.yml` builds each platform on its native runner and attaches the installers to that release. Download an installer from the command line with GitHub CLI, for example:

```sh
gh release download --repo Infekted11/Stillnote --pattern '*.dmg'
```

Change the pattern to `*.exe`, `*.AppImage`, or `*.deb` for Windows or Linux. The latest release is used by default; add a tag such as `v1.1.0` before `--repo` to download from a specific release.

Unsigned macOS builds can be opened locally, but distributing them broadly requires Apple Developer signing and notarization to avoid Gatekeeper warnings. Windows builds can also be signed with a code-signing certificate; without one, Windows may show a reputation warning.

## Set up API keys and accounts

Open a vault before saving credentials. Stillnote encrypts API keys and Google OAuth credentials in a hidden `.stillnote-credentials.enc` file in that vault, using Electron's operating-system-backed encryption. The file can only be decrypted on the same device and operating-system account. Enter your credentials again if you move to another device.

### Ollama Cloud API key

1. Sign in to [Ollama](https://ollama.com/) or create an account.
2. Open [Ollama API keys](https://ollama.com/settings/keys), create a key, and copy it.
3. In Stillnote, open **Settings → AI settings**, paste the key, and click **Save key**. Choose a cloud model from the model menu.

Stillnote uses Ollama Cloud's `https://ollama.com/api/chat` endpoint. It sends the open note and your prompt to Ollama when you use the assistant.

### Desmos API key

1. Open [Desmos My API](https://www.desmos.com/my-api) and sign in or create an account.
2. Follow the page to get an API key for your project, then copy the key.
3. In Stillnote, open **Settings → Graphing**, paste the key, and click **Save key**.

Stillnote loads the Desmos Graphing Calculator from Desmos, so graph previews need an internet connection.

### Google Tasks OAuth credentials

1. Go to Google Cloud Console (console.cloud.google.com/). Create a Project and go to that project's dashboard.
2. Click "Library" in the left sidebar, search for "Google Tasks api", and enable it.
3. Back in the dashboard, click on credentials, then create credentials, then OAUTH Client ID. Set the application type to: “Desktop app”.
4. Copy the Client ID and Client Secret, you will need these and won't be able to view them again.
5. Under OAuth 2.0 Client IDs, find the one you created an click on it. Go to "Audience" and scroll down until you find "test users". Add the Gmail you intend to use as a test user.
6. Paste the Client ID and Client Secret into StillNote. Click save, then click "Connect Google Accout". Click on the Gmail that you added as a test user and click confirm. The app requests access only to your Google Tasks.

Task sheet files are Markdown with an embedded task list ID and a local task cache. Google Tasks is the source of truth; changes sync when you open or refresh a sheet.

The personal dictionary is stored separately in the encrypted `.stillnote-dictionary.enc` file in the selected vault. The explorer hides both files, and the DMG build explicitly excludes them and `.env` files. Do not share the vault folder if you want to keep its credentials or personal dictionary private. Existing Ollama and Google credentials migrate from the app data folder when a vault is opened, and an existing Desmos key migrates from local app storage.
