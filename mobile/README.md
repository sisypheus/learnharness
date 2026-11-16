# Flashcards on iPhone

A home-screen web app for reviewing and practising your LearnHarness flashcards
on the go. It syncs with the Mac through the private GitHub repository that
[learnharness-git](https://github.com/heohlee/learnharness-git) backs your
learning data up to.

- **Review and practice only.** Creating, editing or deleting cards, AI
  generation and statistics stay on the Mac.
- **Works offline.** Ratings are saved on the phone first. The app pulls when
  opened, and pushes 30 seconds after your last rating or when you leave it.
- **Same rules as the Mac.** It uses the plugin's own scheduler, queue order,
  daily new-card limits and Markdown rendering (math, code, Mermaid).
- **Archived cards are not hidden.** The phone cannot see the knowledge graph,
  so cards archived on the Mac (their proposition was removed from the graph)
  can still come up for review on the phone.
- **Private data.** The app is public static code with no data in it. Your
  cards are read from your private repository with a token that is stored
  only on the phone and sent only to `api.github.com`.

## How sync works

The phone reads and writes one file, `core-plugin-data/flashcards/flashcards.json`,
through the GitHub API. Before pushing, it merges its ratings into the latest
version on GitHub with the plugin's `src/merge.cjs`, and commits on top of it.

On the Mac, learnharness-git pulls those commits. Without extra setup, a
conflict on that file keeps only the newest version and drops the other
side's ratings. Register the flashcards merge driver (below) so git combines
both sides instead. The Flashcards plugin reloads the file when a pull
replaces it.

## Setup

### 1. Mac: back up your learning data with learnharness-git

Requires LearnHarness 0.6.1 or newer.

1. Create a **private**, empty GitHub repository.
2. Install learnharness-git (see its README) and enable it.
3. In Settings → Git, set the repository URL and press Sync now.
4. Turn on an auto sync interval with automatic pull and push.

### 2. Mac: register the flashcards merge driver

Run from this repository's root, once per backup repository:

```sh
REPO="$HOME/Library/Application Support/LearnHarness/data"
git -C "$REPO" config merge.flashcards.name "LearnHarness flashcards ratings"
git -C "$REPO" config merge.flashcards.driver "'$(command -v node)' '$PWD/plugins/flashcards/scripts/git-merge-flashcards.cjs' %O %A %B"
echo 'core-plugin-data/flashcards/flashcards.json merge=flashcards' >> "$REPO/.git/info/attributes"
```

The driver config stores absolute paths to `node` and to this checkout. Run
the commands again if either moves (for example after an nvm Node upgrade).
If the driver cannot run, git reports a normal conflict and learnharness-git
falls back to keeping the newest file.

### 3. GitHub: create a token for the phone

github.com → Settings → Developer settings → Fine-grained personal access
tokens → Generate new token:

- Repository access: **Only select repositories** → your backup repository.
- Permissions: **Contents: Read and write**. Nothing else.

### 4. iPhone: install the app

1. Open `https://<your GitHub user>.github.io/learnharness/` in Safari.
2. Share → Add to Home Screen.
3. Open it from the home screen and enter the repository (`owner/name`),
   the branch (usually `main`), and the token.

## Build and publish

```sh
npm run mobile:build   # writes mobile/dist
```

`.github/workflows/mobile-pages.yml` builds and publishes `mobile/dist` to
GitHub Pages on every push to `main`. Enable it once in the repository's
Settings → Pages → Source: **GitHub Actions**.

The first install downloads about 15 MB (mostly code-highlighting grammars
and Mermaid), so that every card renders offline.
