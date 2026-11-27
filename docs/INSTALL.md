# Installing fribblr

fribblr runs one instance per project: its own app copy, port, boards and label.
It needs Node.js 22 or newer and macOS or Linux. It has no npm dependencies and no
build step.

There are no fribblr releases yet. fribblr is installed from a checkout of its
repository, https://github.com/elenaOnline/fribblr. The sections below are the whole
procedure.

## What a project gets

```text
PROJECT/
  AGENTS.md            a fribblr section between <!-- fribblr:start ... --> and <!-- fribblr:end -->
  FRIBBLR.md           how agents start fribblr, add work, share links and read comments
  fribblr/
    project.json       the pin: version, label, boards folder, repository, "source": "checkout"
    setup.mjs          the installer, for restoring from a release (none exist yet)
    .gitignore         ignores app/ and local/
    app/               the replaceable app (ignored)
    local/config.json  this computer's config: port, label, absolute boards path (ignored)
  design/boards/       the boards, with their metadata in design/boards/.tinka/
```

Commit `AGENTS.md`, `FRIBBLR.md`, `fribblr/project.json`, `fribblr/setup.mjs`,
`fribblr/.gitignore` and the boards folder. `fribblr/app/` and `fribblr/local/` stay
on this computer.

## Add fribblr to a project

1. Get a checkout, once per computer (any folder works; this one is used below):

   ```sh
   git clone https://github.com/elenaOnline/fribblr.git ~/fribblr
   ```

2. Run its installer with the project's absolute path:

   ```sh
   node ~/fribblr/scripts/install.mjs --project /absolute/path/to/project
   ```

   It packs the checkout's app files the way a release would, installs them into
   `PROJECT/fribblr/app/`, creates `PROJECT/fribblr/local/config.json` and the
   boards folder, writes `FRIBBLR.md` and the `AGENTS.md` section, and starts the
   instance. The last line is the project's URL:

   ```text
   fribblr / project started on http://127.0.0.1:45080/ (PID 12345)
   ```

3. Open that URL. Tell the project's agent to read `AGENTS.md` and `FRIBBLR.md`.

Options, all optional:

- `--port 47900` fixes the port. Without it the port is automatic: fribblr tries
  45080, then 45180, 45280 and so on (20 tries, up to 46980), uses the first free
  one and saves it in `fribblr/local/config.json`. Upstream Tinka uses 43821, 43921
  and on, so the two apps never take each other's ports.
- `--label "Project name"` sets the name shown as `fribblr / Project name`. The
  default is the project folder's name.
- `--boards design/boards` sets the boards folder, relative to the project. The
  default is `design/boards`; when that folder already holds something (another
  app's boards, for example), the default is `design/fribblr-boards` instead.

The installer runs whatever the checkout holds, including uncommitted changes. Its
first line names the branch and commit and says when there are uncommitted changes.

A second project is the same command with the other project's path. It gets its own
app copy, port, boards and label; stopping or updating one never touches the other.

## Start and stop

From the project root:

```sh
node fribblr/app/cli.mjs start --config fribblr/local/config.json
node fribblr/app/cli.mjs stop --config fribblr/local/config.json
```

`start` prints the URL and does nothing else when the instance is already running.

## Update

Bring the checkout up to date, then run the same install command again:

```sh
git -C ~/fribblr pull
node ~/fribblr/scripts/install.mjs --project /absolute/path/to/project
```

It replaces `fribblr/app/` (the old copy is kept beside it as
`fribblr/.app.backup-DATE-ID/`), keeps the boards, notes and config, and restarts
the instance if it was running. When the checkout has not changed, nothing is
replaced. `node fribblr/app/cli.mjs update status --config fribblr/local/config.json`
prints the exact command for this project, with the checkout it came from. An app
installed from a checkout never checks GitHub for updates.

## Restore after cloning a project

`fribblr/app/` and `fribblr/local/` are not in Git. On another computer, clone the
project, then run the install command from a fribblr checkout there:

```sh
git clone https://github.com/elenaOnline/fribblr.git ~/fribblr
node ~/fribblr/scripts/install.mjs --project /absolute/path/to/project
```

It reads the label and boards folder from `fribblr/project.json` and recreates the
local config. `node fribblr/setup.mjs` restores only from a release, and says so.

## A project that already has upstream Tinka

<!-- rebrand:off -->
fribblr installs beside it. fribblr never reads, changes or removes `tinka/`,
`TINKA.md` or the Tinka section of `AGENTS.md`; Tinka never touches `fribblr/`,
`FRIBBLR.md` or the fribblr section. Tinka's boards are usually in `design/boards`,
so fribblr's go in `design/fribblr-boards`. fribblr's section in `AGENTS.md` tells
agents that each app has its own boards and to use the app the user names.

To open Tinka's boards in fribblr instead, pass `--boards design/boards`. Both apps
then write the same boards; what only fribblr has (whiteboards, pointing messages)
does not work in Tinka. Run one of the two at a time on those boards.
<!-- rebrand:on -->

## Pictures: pointing crops, item shot and board overview

Three features render pages in a headless Chrome-family browser on this computer:
the pictures attached to pointing-mode messages, `item shot` and `board overview`.
fribblr looks for a browser in this order and uses the first it finds:

1. `CHROMIUM_EXECUTABLE`, an environment variable naming an executable.
2. `"browser"` in the instance's config (`fribblr/local/config.json`), an absolute
   path to an executable: `"browser": "/absolute/path/to/headless_shell"`.
3. The fribblr browsers folder, for every instance on this computer:
   `~/Library/Application Support/fribblr/browsers/` on macOS,
   `~/.local/share/fribblr/browsers/` on Linux (or `$XDG_DATA_HOME/fribblr/browsers/`).
   It holds browsers in Playwright's layout, such as
   `chromium_headless_shell-1194/chrome-mac/headless_shell`. A headless shell is
   preferred over a full Chromium, and the newest revision over older ones.
4. Playwright's own browsers: `PLAYWRIGHT_BROWSERS_PATH`, then
   `~/Library/Caches/ms-playwright/` (macOS) or `~/.cache/ms-playwright/` (Linux).
5. An installed Google Chrome, Chromium, Microsoft Edge or Brave
   (`/Applications` or `~/Applications` on macOS, the usual command names on Linux).

A headless shell never opens a window or shows a Dock icon. To put one in the
fribblr browsers folder on macOS (about 180 MB on disk, needs npm):

```sh
PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Application Support/fribblr/browsers" npx -y playwright@1.56.1 install --only-shell chromium
```

On Linux, use `PLAYWRIGHT_BROWSERS_PATH="$HOME/.local/share/fribblr/browsers"`.

Without any browser: pointing messages still send, with their regions and the
objects they point at, and say there is no picture. `item shot` and
`board overview` stop with a message naming the page to open and screenshot by hand.
Everything else works.

## The whiteboard (proof of concept)

The whiteboard is drawn by the Iron Drawxide engine, compiled to WebAssembly and
shipped in the app (`fribblr/app/public/drawxide/`). There is no whiteboard tool in
the app yet: a whiteboard is an HTML item whose file opens the engine's page. To add
one named `sketch` to board `BOARD_ID`, run from the project root:

```sh
mkdir -p design/whiteboards
cat > design/whiteboards/sketch.html <<'EOF'
<!doctype html>
<meta charset="utf-8">
<title>Whiteboard</title>
<script>location.replace('/app/drawxide/index.html?doc=sketch' + (location.search ? '&' + location.search.slice(1) : ''));</script>
EOF
node fribblr/app/cli.mjs tools call workspace.update --config fribblr/local/config.json \
  --json '{"patch":{"resourceRoots":{"whiteboards":{"path":"../../whiteboards"}}}}'
node fribblr/app/cli.mjs tools call item.create --config fribblr/local/config.json \
  --json '{"boardId":"BOARD_ID","item":{"title":"Sketch","content":{"kind":"html","resource":{"rootId":"whiteboards","path":"sketch.html"}}},"placement":{"x":0,"y":0,"width":960,"height":600,"presentation":{"mode":"panel"}}}'
```

`x` and `y` are its place on the board: pick a spot clear of the board's other items
(`tools call board.geometry --json '{"boardId":"BOARD_ID"}'` lists where they are).
The resource root path is relative to the boards' metadata folder
(`design/boards/.tinka`, or `design/fribblr-boards/.tinka`), so `../../whiteboards`
is `design/whiteboards` in both cases. For another whiteboard, copy the file under a
new name and change `doc=sketch` to the new name (lowercase letters, digits and
dashes). Open the item to draw; click once inside it before using keys. The drawing
is saved in the metadata folder as `drawxide/sketch.json`. The panel on the board
shows the drawing but cannot be drawn in.

## An instance outside a project

An instance can also run straight from a checkout, with its config and boards
anywhere outside the checkout:

```sh
node ~/fribblr/cli.mjs init --config /absolute/instances/notes/config.json --boards /absolute/instances/notes/boards --label notes --port 47910
node ~/fribblr/cli.mjs start --config /absolute/instances/notes/config.json
```

It runs the checkout's code as it is, so it updates with `git pull` and a
`stop`/`start`. Existing configs of this kind keep working unchanged.

## Releases

None are published. `node scripts/package.mjs --out /absolute/empty/folder` builds
what a release would contain: `fribblr-vX.Y.Z.zip` (the app, under a `fribblr/`
root), `fribblr-skill.zip`, the standalone `fribblr-install.mjs`,
`fribblr-vX.Y.Z.compatibility.json`, and a `.sha256` file for each. Once a release
is published at https://github.com/elenaOnline/fribblr/releases,
`node fribblr-install.mjs --project /absolute/path/to/project` installs it and
`node fribblr/setup.mjs` restores it from the pin; until then both say there is no
release and point here. To try the update path against a local folder of those
files, set `FRIBBLR_UPDATE_FEED=/absolute/folder` (`TINKA_UPDATE_FEED` also works).
See [RELEASE.md](RELEASE.md).
