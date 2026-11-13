# Stillnote

A local-first Markdown notes app starter built with Electron, Vite, and CodeMirror 6.

## Download and install

Download the latest installer from [GitHub Releases](https://github.com/Infekted11/Stillnote/releases/latest). Choose the `.dmg` for macOS or the `.exe` for Windows. To update, download and install the latest release; your vault files are stored separately from the app.

The installers are not code-signed or notarized, so macOS Gatekeeper or Windows SmartScreen may show a warning on first launch.

### macOS

To install with Homebrew, add the Stillnote tap and trust the Stillnote cask once:

```sh
brew tap infekted11/stillnote https://github.com/Infekted11/Stillnote.git
brew trust --cask infekted11/stillnote/stillnote
brew install stillnote
```

Run `brew update && brew upgrade stillnote` to install the latest release. If you downloaded the DMG directly, drag **Stillnote** to **Applications**. The same first-launch steps apply to both install methods.

1. If macOS says it cannot verify the developer or check the app for malicious software, first try Control-clicking **Stillnote** in Applications and choosing **Open**, then confirm **Open**.
2. If macOS still blocks it, try opening Stillnote once, then go to **System Settings → Privacy & Security** and select **Open Anyway** in the Security section.

If you trust that the DMG came from the official Stillnote GitHub Releases page, you can also remove its quarantine attribute in Terminal:

```sh
xattr -dr com.apple.quarantine /Applications/Stillnote.app
```

If that does not clear the block, the broader command below removes all extended attributes from the app bundle:

```sh
xattr -cr /Applications/Stillnote.app
```

### Windows

If SmartScreen displays **Windows protected your PC** for the installer, verify that you downloaded the `.exe` from the official Stillnote GitHub Releases page. Select **More info → Run anyway** to continue. This applies to the SmartScreen reputation warning; do not allow an installer that Windows Security identifies as malware.

### Download from the command line

Install [GitHub CLI](https://cli.github.com/), then download the latest macOS installer with:

```sh
gh release download --repo Infekted11/Stillnote --pattern '*.dmg'
```

Change the pattern to `*.exe` to download the Windows installer. The latest release is used by default; add a release tag before `--repo` to download a specific version.

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
- Link to any supported vault file from notes or canvas text with `<[relative/path.ext]>`; add `#heading` or `#L24` to open a heading or exact line. Existing `[[...]]` links remain supported.
- Linked graphs, geometry, and 3D calculators show graph-only previews using your Desmos API key. Prefix a file link with `!!!`, such as `<[!!!Image.png]>`, to keep that occurrence as a text link. Missing files show red links and do not use saved preview copies.
- Type `;;List name/Task name;;` in a note to append a `stillnote://` link to that Google Task’s Details. Opening it returns to the line containing the reference in the same vault.
- Edit with CodeMirror 6 live Markdown rendering, including unordered and ordered lists. Formatting appears on lines outside the caret, while the active line keeps its Markdown syntax visible for editing.
- Restore the last open vault and note on launch, and choose Light, Sepia, or Dark from the settings menu.
- Use the right-side note assistant to ask questions about the open note or request a complete Markdown edit. AI edits are previewed and applied only when you choose **Apply to note**.
- Sidebar AI also receives files linked directly from the current document, using the current unsaved links. Text and structured files contribute bounded excerpts, PDFs contribute selectable text, and other media contributes reference metadata. Linked files are read-only context; missing or truncated content is marked and links are not followed recursively.
- Use Groq's free cloud API tier or choose OpenAI or Anthropic, with separate API keys encrypted using Electron's OS-backed secure storage.
- Create task sheets linked to Google Tasks lists. Tasks sync when opened or when you press **Sync**.
- Create Geometry files with the Desmos Geometry Tool and 3D Calculator files with the Desmos 3D Calculator. Their Desmos states are saved in the Markdown file; the API key must have Geometry Tool and 3D Calculator access enabled.
- Search note titles with `⌘K` / `Ctrl+K`.
- Electron context isolation and a narrow preload API for vault file access.

## Shortcuts

| Action | macOS | Windows |
| --- | --- | --- |
| Search notes | `⌘K` | `Ctrl+K` |
| Find and replace in file | `⌘F` | `Ctrl+F` |
| New note | `⌘N` | `Ctrl+N` |
| Save now | `⌘S` | `Ctrl+S` |

## Build installers

Install dependencies with `npm install`, then run the packaging command for your current operating system:

```sh
npm run dist:mac
npm run dist:win
```

The installers are written to `release/`. macOS creates a universal DMG and ZIP for Intel and Apple Silicon, and Windows creates an x64 NSIS installer. Build each installer on its matching operating system; the release workflow uses native macOS and Windows runners.

The **Update Homebrew Cask** workflow keeps the tap in sync with the latest stable GitHub release. It reads the universal DMG’s SHA-256 from GitHub and commits the new version and checksum to the default branch. You can also run it manually from the Actions tab.

## Set up API keys and accounts

Open a vault before saving credentials. Stillnote encrypts API keys and Google OAuth credentials in a hidden `.stillnote-credentials.enc` file in that vault, using Electron's operating-system-backed encryption. The file can only be decrypted on the same device and operating-system account. If Stillnote reports that it cannot decrypt the file, use **Settings → AI settings → Reset unreadable credentials**; it archives the unreadable file and lets you enter new credentials.

### Groq API key (default)

[Groq](https://console.groq.com/docs/billing-faqs) offers a Free API plan with recurring [daily and per-minute limits](https://console.groq.com/docs/rate-limits). Exact limits vary by model and organization; check your account's **Settings → Limits** rather than treating a published limit as guaranteed. Multi-step Work requests make multiple model calls and consume the allowance faster.

1. Sign up at [Groq Console](https://console.groq.com), keep the account on the **Free** plan, and create an API key at [API Keys](https://console.groq.com/keys).
2. In Stillnote, open a vault, then **Settings → AI settings**. Choose **Groq**, paste the key, and click **Save key**.
3. Select an available model. Stillnote prefers `openai/gpt-oss-120b`; `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` are also supported when available to your account. The `openai/` model names identify open-weight models hosted by Groq; they use your Groq key.

Home Ask/Work, note questions, edits, and task assistance use Groq's Chat Completions API at `https://api.groq.com/openai/v1/chat/completions`. Only models documented to support [strict structured outputs](https://console.groq.com/docs/structured-outputs) are shown. Responses are also validated locally before any actions are returned. Your prompts and relevant file content are sent directly to Groq when you use the assistant.

On the Free plan, exceeding a limit returns a rate-limit error. Stillnote waits and retries a rejected model request once if Groq supplies a retry time of at most 60 seconds; stopping Home work cancels that wait. Longer waits or further failures display an error and keep completed Work steps. Stillnote does not upgrade your plan or switch providers. Large notes or conversations can exceed a free account's per-minute token limit even if they fit the model's context window. Paid Developer accounts are subject to Groq's normal billing.

### OpenAI API key (optional)

1. Create an API key in the [OpenAI developer platform](https://platform.openai.com/api-keys).
2. In **Settings → AI settings**, choose **OpenAI**, paste the key, and save it.
3. Select a supported text model available to your API project. Stillnote prefers `gpt-6.1-sol` when available.

OpenAI requests use the Responses API at `https://api.openai.com/v1/responses`, with structured JSON outputs and `store: false`. OpenAI API usage is billed separately from ChatGPT subscriptions. Your prompts and relevant file content are sent to OpenAI when it is selected.

### Anthropic API key (optional)

1. Create an API key in the [Claude Console](https://platform.claude.com/settings/keys) and set up API billing for that account.
2. In **Settings → AI settings**, choose **Anthropic (Claude)**, paste the key, and click **Save key**.
3. Select an available Claude model. Stillnote prefers `claude-sonnet-5-5` when available. The model list includes models reporting structured-output support and loads all pages of your account's model catalog.

Home Ask/Work, note questions, edits, and task assistance use Anthropic's [Messages API](https://platform.claude.com/docs/en/api/messages/create) at `https://api.anthropic.com/v1/messages`, with JSON schema outputs validated locally before any actions are returned. Only final text is used; thinking blocks are not displayed or saved in the conversation. Your prompts and relevant file content are sent directly to Anthropic when selected. [API usage is billed separately from Claude subscriptions](https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan).

Each provider has separate encrypted credentials and model preferences. Existing OpenAI credentials are preserved; switching to Groq requires a Groq key. Existing FreeModel preferences switch to Groq, while stored FreeModel credentials remain unused. Keys from previous providers are never reused for a different service.

### Desmos API key

1. Open [Desmos My API](https://www.desmos.com/my-api) and sign in or create an account.
2. Follow the page to get an API key for your project, then copy the key.
3. In Stillnote, open **Settings → Graphing**, paste the key, and click **Save key**.

Stillnote loads the Desmos Graphing Calculator, Geometry Tool, and 3D Calculator from Desmos, so these tools need an internet connection. Geometry Tool and 3D Calculator access must be enabled for the API key.

### Google Tasks OAuth credentials

1. Go to Google Cloud Console (console.cloud.google.com/). Create a Project and go to that project's dashboard.
2. Click "Library" in the left sidebar, search for "Google Tasks api", and enable it.
3. Back in the dashboard, click on credentials, then create credentials, then OAUTH Client ID. Set the application type to: “Desktop app”.
4. Copy the Client ID and Client Secret, you will need these and won't be able to view them again.
5. Under OAuth 2.0 Client IDs, find the one you created an click on it. Go to "Audience" and scroll down until you find "test users". Add the Gmail you intend to use as a test user.
6. Paste the Client ID and Client Secret into StillNote. Click save, then click "Connect Google Accout". Click on the Gmail that you added as a test user and click confirm. The app requests access only to your Google Tasks.

Task sheet files are Markdown with an embedded task list ID and a local task cache. Google Tasks is the source of truth; changes sync when you open or refresh a sheet.

The personal dictionary is stored separately in the encrypted `.stillnote-dictionary.enc` file in the selected vault. The explorer hides both files, and the DMG build explicitly excludes them and `.env` files. Do not share the vault folder if you want to keep its credentials or personal dictionary private. Legacy Google credentials migrate from the app data folder when a vault is opened, and an existing Desmos key migrates from local app storage.
