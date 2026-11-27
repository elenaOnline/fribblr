import {mkdir,readFile,writeFile,appendFile,realpath,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {VERSION,loadConfig} from './config.mjs';
import {isInside} from './paths.mjs';
import {DEFAULT_REPO,defaultProjectBoards} from '../scripts/install.mjs';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function readOptional(file){try{return await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function createOnly(file,content){try{await writeFile(file,content,{flag:'wx'});return true;}catch(error){if(error.code==='EEXIST')return false;throw error;}}
async function existingAncestor(file){try{return await realpath(file);}catch(error){if(error.code!=='ENOENT')throw error;return existingAncestor(path.dirname(file));}}

// The fribblr-managed block in the project-root AGENTS.md, which Codex, Claude Code
// and other agents read. fribblr never writes any other instruction file. Setup,
// installs, updates and portable starts replace everything between the markers;
// bytes outside them are never changed. A project may also hold upstream Tinka,
// whose own block sits between <!-- tinka:start ... --> and <!-- tinka:end -->:
// fribblr never reads, moves or replaces that block, its tinka/ folder or TINKA.md.
export const FRIBBLR_START='<!-- fribblr:start - managed by fribblr; changes between these markers are replaced -->';
export const FRIBBLR_END='<!-- fribblr:end -->';
// When the section changes, give FRIBBLR_SECTION a new literal; marked blocks are
// replaced whole, so no earlier text needs to be listed.
export const FRIBBLR_SECTION=`## fribblr

Visual work in this project belongs on its fribblr boards, where it can be found again. When you
make something for the user to look at (designs, mockups, images, illustrations, diagrams,
prototypes, alternatives to compare, screenshots for review), add it to a board as well as showing
it the way you otherwise would, such as sending the same image or file in the conversation. Always
give the user the fribblr link to exactly what you added or changed (the \`link\` in each tool
result), not just the board or Home; it lets them review and decide fast. Board links open only on
this computer, so when the user may be away (on a phone, say) or just needs to see it, consider
also sending a picture with the link (\`item shot\` or \`board overview\`; see the agent guide).
If this file also has a section for another board app, each app has its own boards: use the one
the user names, and ask when it is unclear.
Read [FRIBBLR.md](FRIBBLR.md) for where the boards are, how to add work and how to start fribblr.`;
export const fribblrBlock=(eol='\n')=>[FRIBBLR_START,FRIBBLR_SECTION,FRIBBLR_END].join('\n').replaceAll('\n',eol);
async function readOptionalBytes(file){try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const START_LINE=/^<!-- fribblr:start\b[^\r\n]*/m,END_LINE=/^<!-- fribblr:end -->[ \t]*(?=\r?\n|$)/m;
// Adds or replaces the managed block, preserving every byte outside it.
// With write:false it only reports what it would do.
async function applySection(file,{write=true}={}){
  const bytes=await readOptionalBytes(file);
  const save=async content=>{if(write)await writeFile(file,content);};
  if(bytes===null||!bytes.length){await save(`${fribblrBlock()}\n`);return 'added';}
  const text=bytes.toString('latin1'); // one character per byte keeps offsets exact
  const start=START_LINE.exec(text);
  if(start){
    const end=END_LINE.exec(text.slice(start.index));
    if(!end)return 'unmatched';
    const from=start.index,to=start.index+end.index+end[0].length;
    const block=Buffer.from(fribblrBlock(text[from+start[0].length]==='\r'?'\r\n':'\n'));
    if(bytes.subarray(from,to).equals(block))return 'current';
    await save(Buffer.concat([bytes.subarray(0,from),block,bytes.subarray(to)]));
    return 'updated';
  }
  if(END_LINE.test(text))return 'unmatched';
  const eol=text.includes('\r\n')?'\r\n':'\n';
  const ending=bytes.at(-1)===10?'':eol;
  await save(Buffer.concat([bytes,Buffer.from(`${ending}${eol}${fribblrBlock(eol)}${eol}`)]));
  return 'added';
}
const NOTICES={
  added:'Added the fribblr section to AGENTS.md.',
  updated:'Updated the fribblr section in AGENTS.md.',
  unmatched:'AGENTS.md has an unmatched fribblr marker; left unchanged. Fix or remove it so fribblr can manage its section.'
};
// Refreshes the project-root AGENTS.md block. Returns its outcome and notice.
export async function refreshProjectInstructions(root,{write=true}={}){
  const outcome=await applySection(path.join(root,'AGENTS.md'),{write});
  return {outcome,notice:NOTICES[outcome]||''};
}
export async function projectInstructions(options){
  if(!options.project)throw new Error('Provide --project /absolute/project.');
  const root=await realpath(path.resolve(options.project));
  if(await readOptional(path.join(root,'fribblr/project.json'))===null)throw new Error('No fribblr/project.json in this project; use project init.');
  return (await refreshProjectInstructions(root)).notice||'fribblr project instructions are current.';
}

export async function addBoardGuide(directory){
  return createOnly(path.join(directory,'AGENTS.md'),await readFile(path.join(appRoot,'docs/BOARD.md'),'utf8'));
}

// Durable project metadata uses relative paths. Machine-specific config and the
// replaceable app are reconstructed by the checked-in, standalone setup script,
// or, for an app installed from a checkout, by installing from a checkout again.
export async function initializeProject(options,initializeConfig){
  if(!options.project)throw new Error('Provide --project /absolute/project.');
  const root=await realpath(path.resolve(options.project));
  const directory=path.join(root,'fribblr');
  if(isInside(appRoot,directory))throw new Error('Project data must live outside the application folder.');
  await mkdir(directory,{recursive:true});
  if(await realpath(directory)!==directory)throw new Error('The project fribblr folder must not be a symlink.');
  const manifestPath=path.join(directory,'project.json');
  const previousText=await readOptional(manifestPath);
  const previous=previousText===null?null:JSON.parse(previousText);
  if(previous&&(previous.schemaVersion!==1||typeof previous.boards!=='string'||typeof previous.projectLabel!=='string'))throw new Error('Invalid fribblr/project.json.');
  const local=path.join(directory,'local');
  const configPath=path.join(local,'config.json');
  const existingConfig=await readOptional(configPath);
  const configBoards=(()=>{if(!existingConfig)return null;const value=JSON.parse(existingConfig).boardsRoot;return typeof value==='string'&&isInside(root,value)?path.relative(root,value):null;})();
  const boards=options.boards||previous?.boards||configBoards||await defaultProjectBoards(root);
  const boardsPath=path.resolve(root,boards);
  if(path.isAbsolute(boards)||!isInside(root,boardsPath)||isInside(directory,boardsPath)||isInside(boardsPath,directory))throw new Error('Project boards must use a relative path inside the project, outside fribblr/. Use init --config for external boards.');
  const label=(options.label||previous?.projectLabel||path.basename(root)).trim();
  if(!label)throw new Error('Project label must be nonempty.');
  if(previous&&(previous.boards!==boards||previous.projectLabel!==label))throw new Error('Existing project settings differ; edit fribblr/project.json deliberately before changing them.');
  if(!isInside(root,await existingAncestor(boardsPath)))throw new Error('Project boards must remain inside this checkout, outside fribblr/.');
  await mkdir(boardsPath,{recursive:true});
  const canonicalBoards=await realpath(boardsPath);
  if(!isInside(root,canonicalBoards)||isInside(directory,canonicalBoards))throw new Error('Project boards must remain inside this checkout, outside fribblr/.');
  await mkdir(local,{recursive:true});
  if(await realpath(local)!==local)throw new Error('The local config folder must not be a symlink.');
  if(existingConfig){
    const config=JSON.parse(existingConfig);
    if(config.boardsRoot!==canonicalBoards||config.projectLabel!==label)throw new Error('Local config belongs to another location or project. Keep fribblr/local untracked; inspect it before restoring this checkout.');
    // Validate an optional custom metadata root but retain the user's config
    // byte-for-byte. Portable setup restores the default under boardsRoot;
    // arbitrary custom absolute roots need their own deliberate restoration.
    const loaded=await loadConfig(configPath);
    const replaceable=path.join(directory,'app');
    if(isInside(replaceable,loaded.workspaceRoot)||isInside(loaded.workspaceRoot,replaceable))throw new Error('Workspace metadata must remain outside the replaceable app directory.');
  }else await initializeConfig({config:configPath,boards:canonicalBoards,label,...(options.port?{port:options.port}:{})});
  const repo=options.repo||previous?.repo||DEFAULT_REPO;
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new Error('Project repository must be OWNER/REPO.');
  // An app installed from a checkout says so in its receipt; setup then knows
  // there is no release to restore and says how to install from a checkout.
  const receipt=await readOptional(path.join(appRoot,'INSTALLATION.json')).then(text=>text&&JSON.parse(text)).catch(()=>null);
  const fromCheckout=receipt?.source?.kind==='checkout';
  const manifest={schemaVersion:1,version:VERSION,projectLabel:label,boards,repo,...(fromCheckout?{source:'checkout'}:{})};
  if(previousText!==`${JSON.stringify(manifest,null,2)}\n`){
    const temporary=`${manifestPath}.${randomUUID()}.tmp`;
    try{await writeFile(temporary,`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx'});await rename(temporary,manifestPath);}finally{await rm(temporary,{force:true});}
  }
  await createOnly(path.join(directory,'setup.mjs'),await readFile(path.join(appRoot,'scripts/install.mjs')));
  const ignoreFile=path.join(directory,'.gitignore');
  const ignores=await readOptional(ignoreFile)||'';
  const missing=['/app/','/local/','/.app.backup-*/','/.app.stage-*/','/.app.operation-lock/','/.app.operation-lock.recovery/'].filter(rule=>!ignores.split('\n').includes(rule));
  if(missing.length)await appendFile(ignoreFile,`${ignores&&!ignores.endsWith('\n')?'\n':''}${missing.join('\n')}\n`);
  await createOnly(path.join(root,'FRIBBLR.md'),guide(boards));
  const {notice}=await refreshProjectInstructions(root);
  return [`fribblr project prepared. Commit FRIBBLR.md, AGENTS.md, fribblr/project.json, fribblr/setup.mjs, fribblr/.gitignore and ${boards}/ (including disk notes).`,...(notice?[notice]:[]),fromCheckout?`Restore on another computer: install from a fribblr checkout again (see FRIBBLR.md).`:`Restore: node ${path.join(directory,'setup.mjs')}`,`Start: node ${path.join(directory,'app/cli.mjs')} start --config ${configPath}`].join('\n');
}

// FRIBBLR.md, written once into the project root; an existing one is kept.
const guide=boards=>`# fribblr in this project

fribblr is this project's local board app. Its boards are in \`${boards}\`. Their
manifests, experiments, assets, handoffs and disk notes are durable project
material. Keep them in version control, including each board's
\`.state/notes.json\`. Check your project's ignore rules. The boards can be read
and edited without running fribblr.

## Start

With Node.js 22 or newer, run from the project root:

\`\`\`sh
node fribblr/app/cli.mjs start --config fribblr/local/config.json
\`\`\`

It prints this project's URL. Run it whenever you return to the boards, also when
fribblr is already running: it then prints the URL again and changes nothing.
Stop it with \`node fribblr/app/cli.mjs stop --config fribblr/local/config.json\`.

## Work on the boards

Before editing boards, read the installed app's
[agent guide](fribblr/app/docs/AGENT.md) and [protocol](fribblr/app/docs/PROTOCOL.md),
and a board folder's own \`AGENTS.md\` where one exists.
The agent guide explains how to create boards, add items and show visual work at a
useful size, including how to show representative work from a nested board on its
parent. In a new project the boards folder starts empty: create the first board
with
\`node fribblr/app/cli.mjs tools call board.create --config fribblr/local/config.json --json '{"id":"first-ideas","title":"First ideas"}'\`.
Files you show on a board live in a project folder registered as a resource root;
its \`path\` is relative to the boards' metadata folder \`${boards}/.tinka\`, so a
project folder \`design/mockups\` is \`${path.posix.relative(`${boards}/.tinka`,'design/mockups')}\`. Preserve earlier rounds, stable IDs, assets and notes. Record actual
project requirements, such as which board is the accepted style guide, in project
guidance.

## Share what you add or change

Give the user the fribblr link to exactly what you added or changed. Tool results
that change a board carry it as \`link\`; it opens that item on its board, so the
user can review and decide fast. Board links open only on this computer, so when
the user may be away (on a phone, say) or just needs to see the work, also send a
picture with the link:

\`\`\`sh
node fribblr/app/cli.mjs item shot ITEM_ID --config fribblr/local/config.json --out /absolute/shot.png
node fribblr/app/cli.mjs board overview BOARD_ID --config fribblr/local/config.json --out /absolute/board.png
\`\`\`

\`item shot\` saves one item's own content (\`--width 390\` for a phone-sized page) and
prints its link; \`board overview\` saves a whole board. Both need fribblr running and
a Chrome-family browser on this computer; the installed
[install guide](fribblr/app/docs/INSTALL.md) says where fribblr looks for one.

## Comments for you

People leave comments for you on the boards. When the user mentions notes,
comments, feedback or a review, or pastes a "Send to agent" line, run:

\`\`\`sh
node fribblr/app/cli.mjs inbox --config fribblr/local/config.json
\`\`\`

Work each thread: read it, use its \`refs\` to find what it points at, make the change,
then reply with what changed and mark it addressed (or ask a question). Never resolve
a person's comment; they resolve it. The agent guide's "Working your comment inbox"
has the exact calls. Before finishing any fribblr task, check the inbox once. For live
pickup, run \`inbox --watch\` in the background: it returns when a comment arrives.

## What travels with Git

Commit \`FRIBBLR.md\`, the project's \`AGENTS.md\` fribblr section, \`fribblr/project.json\`,
\`fribblr/setup.mjs\`, \`fribblr/.gitignore\`, and all of \`${boards}/\`, including disk
notes. Browser-only view preferences are local. \`fribblr/app/\` and \`fribblr/local/\`
are ignored: they hold the replaceable app, this computer's config, logs and process
state. A dot folder is not automatically ignored by Git; verify the actual staged files.

## Install, update and restore

\`node fribblr/app/cli.mjs update status --config fribblr/local/config.json\` says how
this copy was installed and how to update it.

When \`fribblr/project.json\` has \`"source": "checkout"\`, the app was installed from a
fribblr checkout. Update it by running the same install again from that checkout
(\`update status\` prints the exact command); it replaces \`fribblr/app/\`, keeps the
boards, notes and config, and restarts fribblr if it was running. On another
computer, install it the same way from a checkout there.

Otherwise the app came from a fribblr release. Restore it on a new computer with
\`node fribblr/setup.mjs\`, then start it. Setup installs the version pinned in
\`fribblr/project.json\` and verifies its checksum. Upgrade deliberately with
\`node fribblr/setup.mjs --version X.Y\`, then review and commit the changed pin.
When fribblr reports a major update, tell the user and ask before installing; only
after they agree, run the \`update now --major\` command the notice gives.
Do not copy version numbers or checksums into this file: \`fribblr/project.json\`
is the record.
`;
