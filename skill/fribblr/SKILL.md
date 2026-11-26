---
name: fribblr
description: Show visual work on this project's fribblr boards. Use when creating or showing designs, mockups, images, illustrations, diagrams, prototypes, visual comparisons or screenshots in a project that has fribblr (a FRIBBLR.md or fribblr/project.json), and whenever the user mentions fribblr. fribblr also works without this optional skill.
---

# fribblr

In a project with fribblr, visual work for the user goes on a board, where it can
be found again: add it there and give the user the board link, as well as showing
it the way you otherwise would, such as sending the same image or file in the
conversation. Board links open only on this computer.

Always give the user the fribblr link to exactly what you added or changed (the
`link` in each tool result), not just the board; it lets them review and decide
fast. When the user may be away from this computer (on a phone, say) or just
needs to see the work, consider also sending a picture of it with that link
(`item shot` or `board overview`, described in the app's agent guide).

Read the project's `AGENTS.md` and `FRIBBLR.md` to locate its boards and
installation. Follow the installed app's `fribblr/app/docs/AGENT.md` and
`fribblr/app/docs/PROTOCOL.md`, plus the board's own instructions. Those files
carry the guidance for that installed version.

When the user mentions comments, notes or feedback on the boards, run the inbox
(`node fribblr/app/cli.mjs inbox --config fribblr/local/config.json`; see `FRIBBLR.md`).

If the app is missing, `FRIBBLR.md` says how to install or restore it. A project
can also have upstream Tinka (a `tinka/` folder and `TINKA.md`); that is a
separate app with its own boards. Use fribblr's only when the user means fribblr.

If no setup exists, `docs/INSTALL.md` in https://github.com/elenaOnline/fribblr
says how to add fribblr to a project. Preserve existing boards, earlier rounds,
stable IDs and notes. Keep durable project content outside the replaceable app.
No skill is required by fribblr.
