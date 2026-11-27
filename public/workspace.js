import {writesReady} from './update-hold.js';
import {segmentedHTML,setSegmented,onSegmented} from './ui-segmented.js';
import {bindForm,restoreFocus,commitShortcutLabel,setCommitHint} from './interaction.js';
import {toast, dismissToast} from './toasts.js';
import './vendor/ui-sdk/web/dialog.js';
import './vendor/ui-sdk/web/alert-dialog.js';
// Small shared primitives for graph workspaces; the legacy board stays independent.
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function resourceURL(ref) {
  if (
    !ref?.rootId ||
    !ref.path ||
    ref.path.split("/").some((p) => !p || p.startsWith(".") || /[\\\0]/.test(p))
  )
    return null;
  return `/resources/${encodeURIComponent(ref.rootId)}/${ref.path.split("/").map(encodeURIComponent).join("/")}`;
}
export function remoteURL(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function contentURL(item, revision) {
  const c =
    revision?.content ||
    (revision?.resource || revision?.url ? revision : item.content);
  return remoteURL(c?.url) || resourceURL(c?.resource);
}
export class WorkspaceClient {
  constructor(config, revision = 0, {readOnly=false} = {}) {
    this.config = config;
    this.revision = revision;
    this.readOnly = readOnly;
    this.queue = Promise.resolve();
    this.pendingWrites = 0;
  }
  async get(url) {
    const r = await fetch(url, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }
  importFiles(files, metadata, signal) {
    if(this.readOnly)return Promise.reject(new Error("This board view is read-only."));
    const operationId = crypto.randomUUID();
    this.pendingWrites++;
    this.onState?.();
    const pending = this.queue.catch(()=>{}).then(async()=>{
      await writesReady();
      const body = new FormData();
      body.append("metadata",JSON.stringify({...metadata,expectedRevision:this.revision,operationId}));
      for (const file of files) body.append("files",file,file.name || "Pasted image");
      const response = await fetch("/api/imports",{method:"POST",headers:{"x-tinka-workspace":this.config.workspaceId},body,signal});
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || `Import failed (${response.status}).`);
        error.conflict = response.status === 409;
        error.rejected = true;
        throw error;
      }
      this.revision = data.revision;
      if (data.history) this.onHistory?.(data.history,{type:"importFiles",data:{files}});
      return data.result;
    }).finally(()=>{this.pendingWrites--;this.onState?.();this.onSettled?.();});
    this.queue = pending;
    return pending;
  }
  write(type, data = {}, {recordHistory = true,includeHistory = false,operationId = crypto.randomUUID(),expectedRevision} = {}) {
    if(this.readOnly)return Promise.reject(new Error("This board view is read-only."));
    this.pendingWrites++;
    this.onState?.();
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        await writesReady();
        const appendOnly=expectedRevision===undefined&&['addComment','replyComment','addHighlight'].includes(type);
        let d;
        for(let attempt=0;attempt<2;attempt++) {
          const r = await fetch("/api/operations", {
            method: "POST",
            headers: {"Content-Type":"application/json","x-tinka-workspace":this.config.workspaceId},
            body: JSON.stringify({type,...data,expectedRevision:expectedRevision??this.revision,operationId}),
          });
          d = await r.json();
          if(r.ok)break;
          const revisionOnly=r.status===409&&d.code==='WORKSPACE_REVISION_CHANGED'&&Number.isSafeInteger(d.revision)&&d.revision>=0;
          if(appendOnly&&revisionOnly&&attempt===0) {
            // The server checked identity and reports a revision-only rejection
            // before touching any target. Retain the payload/retry ID and mounted UI.
            this.revision=Math.max(this.revision,d.revision);continue;
          }
          const e=new Error(appendOnly&&revisionOnly
            ? 'Work changed again while posting. Your draft is retained; try Post again.'
            : r.status===409&&!appendOnly
              ? 'This workspace changed elsewhere. Reload the board, review the latest version, then retry your change.'
              : d.error||`Change failed (${r.status})`);
          e.conflict=r.status===409;e.rejected=r.status>=400&&r.status<500;e.code=d.code;e.revision=d.revision;throw e;
        }
        this.revision = Math.max(this.revision,d.revision);
        if (d.history && recordHistory && type !== "restoreMovement") this.onHistory?.(d.history,{type,data});
        return includeHistory ? {result:d.result || d,history:d.history || null,replayed:!!d.replayed} : d.result || d;
      }).finally(() => { this.pendingWrites--; this.onState?.();this.onSettled?.(); });
    this.queue = pending;
    return pending;
  }
  // Another writer advancing the workspace revision is not an arrangement
  // conflict. After a revision-only rejection, recheck(error) confirms that every
  // target still has the state the action started from and returns the revision
  // to retry at; the same operation and operationId are then submitted once more.
  // Any other result keeps the rejection, its visible rollback and reconcile.
  async writeRechecked(type, data, recheck, options = {}) {
    const operationId = options.operationId || crypto.randomUUID();
    try { return await this.write(type, data, {...options, operationId}); }
    catch (error) {
      if (error.code !== "WORKSPACE_REVISION_CHANGED") throw error;
      const revision = await Promise.resolve().then(() => recheck(error)).catch(() => null);
      if (!Number.isSafeInteger(revision) || revision < 0) throw error;
      this.revision = Math.max(this.revision, revision);
      return this.write(type, data, {...options, operationId});
    }
  }
}
export { toast, dismissToast };
export function showFailure(error) {
  const d = makeDialog(
    "Change not saved",
    `<p role="alert">${escape(error.message)}</p>${error.conflict ? '<button type="button" data-reload>Reload latest</button>' : ""}`,
  );
  d.querySelector("[data-reload]")?.addEventListener("click", () =>
    location.reload(),
  );
}
export function bindBackdropDismiss(dialog, dismiss = () => dialog.close()) {
  const outside = event => {
    if (event.target !== dialog) return false;
    const {left,right,top,bottom} = dialog.getBoundingClientRect();
    return event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom;
  };
  let press, backdropClick = false;
  dialog.addEventListener("pointerdown", event => {
    backdropClick = false;
    press = event.isPrimary && event.button === 0 && outside(event)
      ? {id:event.pointerId, x:event.clientX, y:event.clientY} : null;
  });
  dialog.addEventListener("pointerup", event => {
    backdropClick = press?.id === event.pointerId && outside(event) &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6;
    press = null;
  });
  dialog.addEventListener("pointercancel", () => { press = null; backdropClick = false; });
  dialog.addEventListener("click", event => {
    if (backdropClick && outside(event)) dismiss();
    backdropClick = false;
  });
}
// Dialogs and confirmations are UI SDK ui-dialog / ui-alert-dialog (modal: page inert, Tab wraps, Escape and a press
// on the backdrop close, focus returns to what had it). makeDialog keeps its shape: it returns the content element,
// which has the old dialog's close() and a "close" event.
// A dialog opened while another dialog is open goes inside it, so the first one's inert page doesn't include it.
function dialogHost() {
  const open = [...document.querySelectorAll('ui-dialog-content[data-open][aria-modal=true],ui-alert-dialog-content[data-open]')].pop();
  if (open) return open;
  return [...document.querySelectorAll('dialog[open]')].filter(d => d.matches(':modal')).pop() || document.body;
}
const FIRST_FIELD = 'input:not([type=hidden],[readonly],[disabled]),textarea:not([readonly],[disabled]),select:not([disabled])';
// The first field or choice a dialog shows: a field inside a hidden part (the Move dialog's New board name, until New
// board… is chosen) is skipped, and a radio group is entered on its checked radio, else its first (radio.md).
function firstField(root) {
  // (The dialog content itself is still hidden while it is built: only a hidden part inside it counts.)
  const field = [...root.querySelectorAll(FIRST_FIELD)].find(el => { const part = el.closest('[hidden]'); return !part || !root.contains(part) || part === root; });
  if (field?.type !== 'radio' || !field.name) return field;
  return [...root.querySelectorAll('input[type=radio]')].find(el => el.name === field.name && el.checked && !el.disabled) || field;
}
// Fields whose value is typed text (a discard question guards them in makeDialog).
const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);
export function makeDialog(title, body, onSubmit, {
  opener = document.activeElement, compact = false, shortcutHint, onDismiss, className = '',
} = {}) {
  const root = document.createElement('ui-dialog');
  root.innerHTML = `<ui-dialog-backdrop hidden></ui-dialog-backdrop><ui-dialog-content class="workspace-dialog ${className}" hidden><form><ui-dialog-close><button class="workspace-close" type="button" aria-label="Close dialog">×</button></ui-dialog-close><ui-dialog-title as-child><h2>${escape(title)}</h2></ui-dialog-title>${body}<p class="workspace-form-status" role="status"></p></form></ui-dialog-content>`;
  const d = root.querySelector('ui-dialog-content');
  d.classList.toggle('workspace-dialog-compact', compact);
  const form = d.querySelector('form'), status = d.querySelector('.workspace-form-status');
  // Focus opens on [autofocus], else the first field or choice of the form; with none, UI SDK's first focusable (the
  // close key).
  if (!d.querySelector('[autofocus]')) firstField(d)?.setAttribute('autofocus', '');
  const submit = onSubmit && form.querySelector('[type="submit"]');
  if (submit) {
    const hint = document.createElement('small');
    hint.className = 'workspace-submit-hint';
    // The commit shortcut prints as a keycap (fribblr); a dialog's own hint ("Enter to create") stays words.
    if (shortcutHint) hint.textContent = shortcutHint; else setCommitHint(hint, 'confirm');
    submit.setAttribute('aria-keyshortcuts', 'Meta+Enter Control+Enter');
    if (submit.parentElement === form) {
      const footer = document.createElement('footer');
      footer.className = 'workspace-dialog-actions';
      status.after(footer);
      footer.append(hint, submit);
    } else {
      // A custom form can place its own action row.
      status.before(hint);
    }
  }
  let controller, dirty = false, done = false, saved = false;
  const finish = () => {
    if (done) return; done = true;
    controller?.destroy(); d.dispatchEvent(new Event('close'));
  };
  d.close = () => { if (!controller?.pending || saved) root.api.close(); };
  // Only typed text makes a stray Escape or backdrop press ask before closing: a choice (a radio, a checkbox, a select, a
  // slider) costs one press to make again. Text back to what it was asks nothing. The close key never asks. A dialog
  // that keeps its draft (onDismiss) has nothing to lose, so it never asks.
  // Each field's value is noted just before the user's first edit to it (beforeinput), so text a caller fills in is not the user's.
  const typed = el => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type));
  const before = new Map();
  form.addEventListener('beforeinput', event => { if (typed(event.target) && !before.has(event.target)) before.set(event.target, event.target.value); });
  form.addEventListener('input', event => {
    if (!onSubmit || onDismiss || !typed(event.target)) return;
    if (!before.has(event.target)) before.set(event.target, event.target.defaultValue);
    dirty = [...before].some(([el, value]) => el.isConnected && el.value !== value);
    root.dismissible = !dirty;
  });
  root.addEventListener('dismissattempt', async () => {
    if (controller?.pending || !dirty) return;
    if (await confirmDialog({title: 'Discard the text you typed', description: `Nothing in “${title}” is saved yet.`, confirmLabel: 'Discard', cancelLabel: 'Keep editing'})) { root.dismissible = true; root.api.close(); }
  });
  root.addEventListener('openchange', event => {
    if (event.detail.value) return;
    // A save in flight holds the dialog open; a finished save is no longer pending from the dialog's side.
    if (controller?.pending && !saved) event.preventDefault();
  });
  root.addEventListener('openchangecomplete', event => {
    if (event.detail.value) return;
    // Our opener first, then the "close" listeners: a caller that wants focus elsewhere has the last word.
    root.remove();
    // A dismissed draft is kept at once, so the dialog reopened straight away (Enter on its opener) still has it.
    if (!saved) onDismiss?.(form);
    // After the SDK has put focus back (it runs after this event), so a caller's "close" listener has the last word.
    // A dialog opened in that frame (Enter on the opener again, at once) keeps its focus: the opener is behind it. (A
    // dialog this one was opened from contains the opener, so focus still goes back there.)
    requestAnimationFrame(() => {
      const other = document.activeElement?.closest?.('ui-dialog-content[data-open],ui-alert-dialog-content[data-open]');
      let target = opener; try { if (typeof target === 'function') target = target(); } catch { target = null; }
      if (!other || other === d || (target instanceof Node && other.contains(target))) restoreFocus(target);
      finish();
    });
  });
  controller = bindForm(form, {
    submit: async data => { await onSubmit?.(data, d); },
    onSuccess: () => { saved = true; if (!done) root.api.close(); },
    onError: error => {
      status.textContent = error.message; status.setAttribute("role", "alert");
      if (error.conflict && !d.querySelector("[data-reload]")) {
        const button = document.createElement("button"); button.type = "button";
        button.dataset.reload = ""; button.textContent = "Reload latest"; button.onclick = () => location.reload(); status.after(button);
      }
    },
  });
  dialogHost().append(root);
  // pending is the form's: the dialog can't be dismissed mid-save, so the close key is held too.
  root.api.open();
  return d;
}
// A question that needs an answer: ui-alert-dialog. Focus opens on Cancel (the least destructive answer), Escape means
// no, a press outside does nothing. confirmDialog resolves true for the confirming answer. With onConfirm (async), the
// confirming button stays pending while it runs and a failure shows in the dialog and keeps it open to retry.
export function confirmDialog({title, description = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, className = ''}) {
  const root = document.createElement('ui-alert-dialog');
  root.innerHTML = `<ui-alert-dialog-backdrop hidden></ui-alert-dialog-backdrop><ui-alert-dialog-content class="workspace-dialog workspace-alert ${className}" hidden><ui-alert-dialog-title as-child><h2></h2></ui-alert-dialog-title><ui-alert-dialog-description as-child><p></p></ui-alert-dialog-description><p class="workspace-form-status" role="status"></p><div class="workspace-alert-actions"><ui-alert-dialog-close><button type="button" class="workspace-alert-cancel"></button></ui-alert-dialog-close><ui-alert-dialog-close value="confirm"><button type="button" class="workspace-primary workspace-alert-confirm"></button></ui-alert-dialog-close></div></ui-alert-dialog-content>`;
  const d = root.querySelector('ui-alert-dialog-content');
  d.querySelector('h2').textContent = title;
  d.querySelector('p').textContent = description;
  d.querySelector('.workspace-alert-cancel').textContent = cancelLabel;
  d.querySelector('.workspace-alert-confirm').textContent = confirmLabel;
  const status = d.querySelector('.workspace-form-status');
  if (!description) d.querySelector('p').remove();
  if (onConfirm) d.querySelector('ui-alert-dialog-close[value=confirm]').action = async () => {
    status.textContent = ''; status.setAttribute('role', 'status');
    try { await onConfirm(); }
    catch (error) { status.textContent = error.message || 'Change not saved. Try again.'; status.setAttribute('role', 'alert'); throw error; }
  };
  root.addEventListener('openchangecomplete', event => { if (!event.detail.value) { d.dispatchEvent(new Event('close')); root.remove(); } });
  dialogHost().append(root);
  return root.api.open().then(result => result.returnValue === 'confirm');
}
// Keep the draft on this page if creation is dismissed before it succeeds.
const boardDrafts = new WeakMap();
export function newBoardDialog(client, {parentBoardId, opener, refresh}) {
  const draft = boardDrafts.get(client) || {title:""};
  boardDrafts.set(client, draft);
  return makeDialog("New board",
    `<label>Board name<input name="title" required maxlength="1000" autocomplete="off" autofocus value="${escape(draft.title)}"></label><button type="submit" class="workspace-primary">Create board</button>`,
    async data => {
      const title = data.get("title").trim();
      if (!title) throw new Error("Enter a name for this board.");
      if (draft.attempt?.title !== title) draft.attempt = {title, id:crypto.randomUUID()};
      await client.write("createBoard", {title, ...(parentBoardId ? {parentBoardId} : {})}, {operationId:draft.attempt.id});
      boardDrafts.delete(client);
      try {
        await refresh();
        toast("Board created.");
      } catch {
        toast("Board created. Reload to see it.");
      }
    }, {
      opener, compact:true, shortcutHint:"Enter to create",
      onDismiss: form => { draft.title = form.elements.title.value; },
    });
}
export async function enableOrganization(config) {
  confirmDialog({
    title: "Enable flexible boards",
    description: "Convert the existing board metadata to stable items and placements. Existing board files, prior rounds, revisions, stars and notes remain in place. New organization changes live beside your project data. This is an explicit workspace conversion. Resource files are not moved or deleted.",
    confirmLabel: "Enable organization",
    onConfirm: async () => {
      const r = await fetch("/api/workspace/migrate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tinka-workspace": config.workspaceId,
        },
        body: JSON.stringify({ dryRun: false }),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(data.error || "Could not enable organization.");
      location.reload();
    },
  });
}
function boardChoices(choices, current) {
  return `<fieldset class="workspace-board-choices"><legend class="sr-only">Destination</legend>${choices.map(({id,title}) =>
    `<label><input type="radio" name="target" value="${escape(id)}"${id === current ? " checked" : ""} required><span>${escape(title)}</span></label>`).join("")}</fieldset>`;
}
export async function destinationDialog(
  client,
  { sourceBoardId, placementIds, itemIds, kind = "move", refresh },
) {
  const ws = await client.get("/api/workspace?view=graph&covers=0");
  const source = ws.boards.find((b) => b.id === sourceBoardId),
    selectedItems =
      itemIds ||
      source?.placements
        .filter((p) => placementIds?.includes(p.id))
        .map((p) => p.itemId) ||
      [];
  const forbidden = new Set(),
    byItem = new Map(ws.items.map((i) => [i.id, i])),
    byBoard = new Map(ws.boards.map((b) => [b.id, b]));
  const visit = (id) => {
    const pending=[id];
    while(pending.length){const current=pending.pop();if(!current||forbidden.has(current))continue;forbidden.add(current);for(const p of byBoard.get(current)?.placements||[])if(!p.removedAt&&!p.deletedAt)pending.push(byItem.get(p.itemId)?.childBoardId);}
  };
  for (const id of selectedItems) visit(byItem.get(id)?.childBoardId);
  const boards = ws.boards.filter(
    (b) =>
      b.id !== sourceBoardId &&
      !forbidden.has(b.id) &&
      !byItem.get(b.ownerItemId)?.deletedAt &&
      !byItem.get(b.ownerItemId)?.archivedAt,
  );
  const isMove = kind === "move";
  const newBoard = "@new", home = "@home";
  const choices = [...boards, ...(itemIds ? [{id:home,title:"Home"}] : []), {id:newBoard,title:"New board…"}];
  const current = choices.length === 1 ? newBoard : null;
  const dialog = makeDialog(
    isMove ? "Move to a board" : "Add a reference",
    `<p>${isMove ? "Choose where the selected items should move." : "Choose where the same items should also appear."}</p>${boardChoices(choices, current)}<label data-new-title${current ? "" : " hidden"}>New board name<input name="title" maxlength="1000"${current ? " required" : ""}></label><button class="workspace-primary" type="submit">${isMove ? "Move items" : "Add references"}</button>`,
    async (f) => {
      const target = f.get("target");
      if (target === newBoard && !f.get("title").trim())
        throw new Error("Name the new board.");
      await client.write(kind, {
        ...(sourceBoardId ? { sourceBoardId } : {}),
        ...(placementIds ? { placementIds } : { itemIds }),
        ...(target === newBoard
          ? { newBoard: { title: f.get("title").trim() } }
          : target === home
            ? {}
            : { targetBoardId: target }),
      });
      await refresh();
      toast(
        isMove
          ? "Items moved. Resource files remain in place."
          : "References added. Original placements remain.",
      );
    },
  );
  const title = dialog.querySelector("[data-new-title]");
  dialog.querySelector(".workspace-board-choices").addEventListener("change", event => {
    title.hidden = event.target.value !== newBoard;
    title.querySelector("input").required = !title.hidden;
  });
  return dialog;
}

export async function featureOnParentDialog(client, {sourceBoardId, placementIds, refresh}) {
  const ws = await client.get('/api/workspace?view=graph&covers=0');
  const source = ws.boards.find(board => board.id === sourceBoardId);
  const owners = new Map(ws.items.map(item => [item.id,item]));
  const parents = source ? ws.boards.filter(board => board.id !== sourceBoardId &&
    !owners.get(board.ownerItemId)?.deletedAt && !owners.get(board.ownerItemId)?.archivedAt &&
    board.placements.some(p => !p.removedAt && !p.deletedAt && !p.archivedAt && p.itemId === source.ownerItemId)) : [];
  if (!parents.length) {
    makeDialog('No parent board', '<p>This board is not currently placed on another board. Add it to a parent before featuring its work there.</p>');
    return;
  }
  const from = new URLSearchParams(location.search).get('from');
  const current = parents.find(board => board.id === from)?.id || parents[0].id;
  let attempt = null;
  const dialog = makeDialog('Show on parent board',
    `<p>Place the same items beside this board on a parent.</p>${boardChoices(parents, current)}<button class="workspace-primary" type="submit">Show on parent</button>`,
    async (_form, currentDialog) => {
      const choices = currentDialog.querySelector('.workspace-board-choices');
      const targetBoardId = choices.querySelector('[name=target]:checked').value;
      if (!attempt || attempt.targetBoardId !== targetBoardId) attempt = {targetBoardId,operationId:crypto.randomUUID()};
      try {
        await client.write('reference',{sourceBoardId,placementIds,targetBoardId,featureOnParent:true},{operationId:attempt.operationId});
      } catch (error) {
        if (!error.rejected) {
          choices.disabled = true;
          throw new Error('Could not confirm the save. Try again for this same parent to check the result.');
        }
        choices.disabled = false;
        attempt = null;
        throw error;
      }
      try {
        await refresh();
        toast('Work added to the parent board. Original placements remain here.');
      } catch {
        toast('Work was added to the parent. Reload this board to see the latest state.');
      }
    });
  return dialog;
}
const itemStatuses = [
  ["draft", "Draft"], ["reserved", "Reserved"], ["building", "Taking shape"],
  ["review", "Ready to review"], ["ready", "Ready"], ["complete", "Complete"], ["blocked", "Blocked"],
];
const itemKinds = [
  ["", "None"], ["text", "Text"], ["note", "Note"], ["html", "HTML"], ["image", "Image"],
  ["video", "Video"], ["audio", "Audio"], ["pdf", "PDF"], ["markdown", "Markdown"], ["url", "Link"], ["file", "File"],
];
const itemOpeningModes = [
  ["", "Automatic"], ["inline", "Inline"], ["preview", "Preview"], ["standalone", "Standalone"],
  ["external", "External tab"], ["download", "Download"],
];

function itemChoices(name, label, choices, selected) {
  return `<fieldset class="workspace-choice-pills"><legend>${label}</legend>${choices.map(([value, title]) =>
    `<label><input type="radio" name="${name}" value="${value}"${selected === value ? " checked" : ""}><span>${title}</span></label>`).join("")}</fieldset>`;
}

export function itemForm(client, { item, boardId, refresh, opener }) {
  const c = item?.content || {}, p = item?.preview || {};
  const sectionChoices = [["details", "Details"], ["content", "Content"], ["preview", "Preview"]];
  // Details, Content and Preview: one choice of which fields show, a segmented control (arrows choose as they move).
  const sections = segmentedHTML({ label: "Item editor sections", className: "workspace-item-sections", value: "details",
    items: sectionChoices.map(([id, text]) => ({ value: id, label: text, attrs: { "data-item-section": id } })) });
  const dialog = makeDialog(item ? "Edit item" : "Add an idea", `${sections}
    <div data-item-fields="details">
      <label>Title<input name="title" required maxlength="1000" value="${escape(item?.title)}" autofocus></label>
      <label>Description<textarea name="description" rows="2">${escape(item?.description)}</textarea></label>
      ${itemChoices("status", "Status", itemStatuses, item?.build?.state || "ready")}
    </div>
    <div data-item-fields="content" hidden>
      ${itemChoices("kind", "Content type", itemKinds, c.kind || "")}
      <div data-item-source hidden>
        <label>Text or transcript<textarea name="text" rows="2">${escape(c.text)}</textarea></label>
        <label>Web or local app address<input name="url" type="url" value="${escape(c.url)}"></label>
        <div class="workspace-item-resource">
          <label>Resource root<input name="rootId" value="${escape(c.resource?.rootId)}"></label>
          <label>Resource path<input name="path" value="${escape(c.resource?.path)}"></label>
        </div>
        ${itemChoices("openMode", "Open content", itemOpeningModes, c.openMode || "")}
        <label>App start instructions<textarea name="startInstructions" rows="2">${escape(c.startInstructions)}</textarea></label>
      </div>
    </div>
    <div data-item-fields="preview" hidden>
      <label>Preview text<textarea name="previewText" rows="2">${escape(p.text)}</textarea></label>
      <div class="workspace-item-resource">
        <label>Image root<input name="previewRoot" value="${escape(p.resource?.rootId)}"></label>
        <label>Image path<input name="previewPath" value="${escape(p.resource?.path)}"></label>
      </div>
    </div>
    <button type="submit" class="workspace-primary">${item ? "Save item" : "Add idea"}</button>`, async data => {
      const value = key => data.get(key).trim();
      const title = value("title");
      if (!title) throw new Error("Enter a title for this item.");
      const patch = {title, description:data.get("description"), build:{...(item?.build || {message:""}), state:data.get("status")}};
      const kind = value("kind");
      if (kind) {
        const content = {...c, kind};
        for (const key of ["text", "url", "openMode", "startInstructions"]) {
          if (data.get(key) === (c[key] ?? "")) continue;
          if (value(key)) content[key] = key === "text" || key === "startInstructions" ? data.get(key) : value(key);
          else delete content[key];
        }
        if (data.get("rootId") !== (c.resource?.rootId ?? "") || data.get("path") !== (c.resource?.path ?? "")) {
          if (value("rootId") || value("path")) content.resource = {rootId:value("rootId"), path:value("path")};
          else delete content.resource;
        }
        patch.content = content;
      } else if (item?.content) patch.content = null;
      const preview = {...p};
      if (data.get("previewText") !== (p.text ?? "")) {
        if (value("previewText")) preview.text = data.get("previewText");
        else delete preview.text;
      }
      if (data.get("previewRoot") !== (p.resource?.rootId ?? "") || data.get("previewPath") !== (p.resource?.path ?? "")) {
        if (value("previewRoot") || value("previewPath")) preview.resource = {rootId:value("previewRoot"), path:value("previewPath")};
        else delete preview.resource;
      }
      if (Object.keys(preview).length || item?.preview) patch.preview = preview;
      await client.write(item ? "updateItem" : "createItem", item ? {itemId:item.id, patch} : {boardId, item:patch});
      await refresh();
      toast(item ? "Item updated." : "Idea added.");
    }, {opener});
  const showSection = id => {
    setSegmented(dialog.querySelector(".workspace-item-sections"), id);
    for (const fields of dialog.querySelectorAll("[data-item-fields]")) fields.hidden = fields.dataset.itemFields !== id;
  };
  onSegmented(dialog.querySelector(".workspace-item-sections"), showSection);
  dialog.addEventListener("invalid", event => {
    const fields = event.target.closest("[data-item-fields]");
    if (fields) showSection(fields.dataset.itemFields);
  }, true);
  const source = dialog.querySelector("[data-item-source]");
  const updateSource = () => {
    source.hidden = dialog.querySelector("[name=kind]:checked").value === "";
    source.querySelector("[name=url]").disabled = source.hidden;
  };
  dialog.addEventListener("change", event => { if (event.target.name === "kind") updateSource(); });
  updateSource();
  return dialog;
}
