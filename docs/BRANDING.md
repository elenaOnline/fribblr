# Branding: what still says tinka, and why

fribblr is a fork of [Tinka](https://github.com/bladnman/tinka) by bladnman (MIT). Everything a person or an
agent reads says fribblr. The name is written `fribblr`, in lower case, also at the start of a sentence. A thing
on a board is an **item** (upstream calls it "a Tinka").

The old name is still in the places below. They are not left over: renaming them would break existing boards and
saved settings, or turn each upstream merge into hundreds of conflicts, and nothing a person sees would change.
`tests/brand.test.mjs` allows exactly these and fails on any other "Tinka".

## What still says tinka

- **The boards' metadata folder `.tinka/`** (`boardsRoot/.tinka`) and the schema and resource-root names inside it.
  It is the on-disk format, so a folder of boards opens in either app.
- **The package identity `board-room`** (`package.json`, the archive root).
- **Browser storage keys** such as `tinka/ground`, `tinka/appearance` and `tinka/<workspace>/…`. Renaming them
  would drop every saved preference.
- **Names inside the code:** DOM ids, CSS classes, data attributes, container and keyframe names
  (`tinka-card`, `.tinka-overview`), custom events (`tinka:selection`), `postMessage` types
  (`tinka-document-edit`), functions and variables (`focusTinka`, `keepTinkaFocus`), and test file and fixture
  names (`tests/tinka-view-browser.mjs`).
- **The wire format between the page and the server:** the `x-tinka-workspace` request header, the
  `application/x-tinka-placements+json` clipboard type and the `TINKA_CLIPBOARD_V1` prefix, the
  `<meta name="tinka-return">` and `?tinka=off` opt-outs of the "Back to fribblr" mark.
- **Internal environment variables** (`TINKA_OPERATION_TOKEN`, the `TINKA_*` switches the tests use).
- **Code comments.** They are developer notes; renaming them would conflict with most upstream changes.
- **Credit and history:** the licence, the README's note that fribblr is a fork, "upstream Tinka", upstream's
  release numbers ("Tinka 1.3") and links to `github.com/bladnman/tinka`.
- **Vendored files** (`public/vendor/`, `public/drawxide/`, `public/fonts/`) are not edited.

## After merging upstream

Upstream's new copy says Tinka. A small script renames it again, and a test fails until it has.

```sh
git fetch upstream
git merge upstream/main
# Conflicts that are only about the name: take upstream's text. The script renames it in the next step.
node scripts/rebrand.mjs               # dry run: every change it would make
node scripts/rebrand.mjs --write       # apply
node scripts/rebrand.mjs --residual    # lines that still mention tinka and no rule could decide
npm test                               # includes tests/brand.test.mjs
```

The script is idempotent: a second `--write` changes nothing. Its rules are an ordered list in
`scripts/rebrand.mjs` (a thing on a board becomes "item", the host project's `tinka/…` paths and `TINKA.md`
become `fribblr/…` and `FRIBBLR.md`, then every remaining "Tinka" becomes "fribblr"). It skips code comments and
leaves identifiers, keys and the other names above alone.

Whatever it prints under `--residual` is for a hand edit, unless it is plumbing or a credit: then add it to
`ALLOWED` in `tests/brand.test.mjs`, with the reason, and to the list above. A "Tinka" that means the product or a
thing on a board is never allowed: change the text, or add a rule to the script so the next merge does it too.

Do not rename the plumbing above to finish the job. Changing it is a separate decision with a migration path for
existing boards.
