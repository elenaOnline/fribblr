import {writesReady} from './update-hold.js';
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
  constructor(config, revision = 0) {
    this.config = config;
    this.revision = revision;
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
  write(type, data = {}, {recordHistory = true,includeHistory = false,operationId = crypto.randomUUID()} = {}) {
    this.pendingWrites++;
    this.onState?.();
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        await writesReady();
        const appendOnly=['addComment','replyComment','addHighlight'].includes(type);
        let d;
        for(let attempt=0;attempt<2;attempt++) {
          const r = await fetch("/api/operations", {
            method: "POST",
            headers: {"Content-Type":"application/json","x-tinka-workspace":this.config.workspaceId},
            body: JSON.stringify({type,...data,expectedRevision:this.revision,operationId}),
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
    `<p role="alert">${escape(error.message)}</p><p>Your resource files have not been removed. A conflicting change is never silently overwritten.</p>${error.conflict ? '<button type="button" data-reload>Reload latest</button>' : ""}`,
  );
  d.querySelector("[data-reload]")?.addEventListener("click", () =>
    location.reload(),
  );
}
// Dialogs and confirmations are UI SDK ui-dialog / ui-alert-dialog (modal: page inert, Tab wraps, Escape and a press
// on the backdrop close, focus returns to what had it). makeDialog keeps its old shape: it returns the content
// element, which has the old dialog's close() and a "close" event.
// A dialog opened while another dialog is open goes inside it, so the first one's inert page doesn't include it.
function dialogHost() {
  const open = [...document.querySelectorAll('ui-dialog-content[data-open],ui-alert-dialog-content[data-open]')].pop();
  if (open) return open;
  return [...document.querySelectorAll('dialog[open]')].filter(d => d.matches(':modal')).pop() || document.body;
}
const FIRST_FIELD = 'input:not([type=hidden],[type=checkbox],[type=radio],[readonly],[disabled]),textarea:not([readonly],[disabled]),select:not([disabled])';
export function makeDialog(title, body, onSubmit, {className = ''} = {}) {
  const root = document.createElement('ui-dialog');
  root.innerHTML = `<ui-dialog-backdrop hidden></ui-dialog-backdrop><ui-dialog-content class="workspace-dialog ${className}" hidden><form><ui-dialog-close><button class="workspace-close" type="button" aria-label="Close dialog">×</button></ui-dialog-close><ui-dialog-title as-child><h2>${escape(title)}</h2></ui-dialog-title>${body}<p class="workspace-form-status" role="status"></p></form></ui-dialog-content>`;
  const d = root.querySelector('ui-dialog-content');
  const form = d.querySelector('form');
  // Focus opens on the first field of a form; with no field, UI SDK's first focusable (the close key).
  d.querySelector(FIRST_FIELD)?.setAttribute('autofocus', '');
  if (onSubmit && d.querySelector('[type=submit]')) {
    const hint = document.createElement('small'); hint.className = 'workspace-submit-hint';
    setCommitHint(hint, 'save');
    d.querySelector('.workspace-form-status').before(hint);
  }
  let controller, dirty = false, done = false, saved = false;
  const finish = () => {
    if (done) return; done = true;
    controller?.destroy(); d.dispatchEvent(new Event('close'));
  };
  d.close = () => { if (!controller?.pending || saved) root.api.close(); };
  // A form with typed-in changes asks before a stray Escape or backdrop press throws them away; the close key doesn't ask.
  form.addEventListener('input', () => { if (onSubmit && !dirty) { dirty = true; root.dismissible = false; } });
  form.addEventListener('change', () => { if (onSubmit && !dirty) { dirty = true; root.dismissible = false; } });
  root.addEventListener('dismissattempt', async () => {
    if (controller?.pending || !dirty) return;
    if (await confirmDialog({title: 'Discard your changes?', description: 'What you typed in this dialog has not been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing'})) { root.dismissible = true; root.api.close(); }
  });
  root.addEventListener('openchange', event => {
    if (event.detail.value) return;
    // A save in flight holds the dialog open; a finished save is no longer pending from the dialog's side.
    if (controller?.pending && !saved) event.preventDefault();
  });
  root.addEventListener('openchangecomplete', event => { if (!event.detail.value) { finish(); root.remove(); } });
  controller = bindForm(form, {
    submit: async data => { await onSubmit?.(data, d); },
    onSuccess: () => { saved = true; if (!done) root.api.close(); },
    onError: error => {
      const status = d.querySelector(".workspace-form-status");
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
export async function enableOrganization(config) {
  confirmDialog({
    title: "Enable flexible boards?",
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
      !byItem.get(b.ownerItemId)?.deletedAt,
  );
  const isMove = kind === "move";
  const dialog = makeDialog(
    isMove ? "Move to a board" : "Add a reference",
    `<p>${isMove ? "Replace the selected placements with placements in the destination." : "Keep these placements and add references to the same items in the destination."} Content, stars and notes stay with each item.</p><label>Destination<select name="target"><option value="new">＋ Create a new board</option>${boards.map((b) => `<option value="${escape(b.id)}">${escape(b.title)}</option>`).join("")}${itemIds ? '<option value="home">Home</option>' : ""}</select></label><label data-new-title>New board title<input name="title" maxlength="1000" placeholder="A new series"></label><p class="workspace-scope">A reference shares the item. A duplicate makes a separate item.</p><button class="workspace-primary" type="submit">${isMove ? "Move items" : "Add references"}</button>`,
    async (f) => {
      const target = f.get("target");
      if (target === "new" && !f.get("title").trim())
        throw new Error("Name the new board.");
      await client.write(kind, {
        ...(sourceBoardId ? { sourceBoardId } : {}),
        ...(placementIds ? { placementIds } : { itemIds }),
        ...(target === "new"
          ? { newBoard: { title: f.get("title").trim() } }
          : target === "home"
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
  dialog.querySelector("[name=target]").onchange = (e) =>
    (dialog.querySelector("[data-new-title]").hidden =
      e.target.value !== "new");
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
  let attempt = null;
  const dialog = makeDialog('Show on parent board',
    `<p>Add the selected work beside this board on a parent. The same items, notes and stars stay shared; the original placements remain here.</p><label>Parent board<select name="target">${parents.map(board => `<option value="${escape(board.id)}" ${board.id === from ? 'selected' : ''}>${escape(board.title)}</option>`).join('')}</select></label><p class="workspace-scope">The parent placements can be moved or removed without changing this board.</p><button class="workspace-primary" type="submit">Show on parent</button>`,
    async (_form, currentDialog) => {
      const select = currentDialog.querySelector('select[name=target]');
      const targetBoardId = select.value;
      if (!attempt || attempt.targetBoardId !== targetBoardId) attempt = {targetBoardId,operationId:crypto.randomUUID()};
      try {
        await client.write('reference',{sourceBoardId,placementIds,targetBoardId,featureOnParent:true},{operationId:attempt.operationId});
      } catch (error) {
        if (!error.rejected) {
          select.disabled = true;
          throw new Error('Could not confirm the save. Try again for this same parent to check the result.');
        }
        select.disabled = false;
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
export function itemForm(client, { item, boardId, refresh }) {
  const c = item?.content || {},
    p = item?.preview || {};
  makeDialog(
    item ? "Edit item" : "Add an idea",
    `<label>Title<input name="title" required maxlength="1000" value="${escape(item?.title || "")}" placeholder="A title is enough to begin"></label><label>Description<textarea name="description" rows="3">${escape(item?.description || "")}</textarea></label><label>Status<select name="status">${[
      ["draft", "Draft"],
      ["reserved", "Reserved"],
      ["building", "Taking shape"],
      ["review", "Ready to review"],
      ["ready", "Ready"],
      ["complete", "Complete"],
      ["blocked", "Blocked"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${(item?.build?.state || "ready") === value ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Primary content<select name="kind">${["text", "note", "html", "image", "video", "audio", "pdf", "markdown", "url", "file"].map((k) => `<option ${c.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label><label>Text or transcript<textarea name="text" rows="4">${escape(c.text || "")}</textarea></label><label>External or local application URL<input name="url" type="url" value="${escape(c.url || "")}" placeholder="https://… or http://127.0.0.1:…"></label><label>Open content<select name="openMode"><option value="inline" ${c.openMode === "inline" ? "selected" : ""}>Preview inside Tinka</option><option value="external" ${c.openMode === "external" || c.kind === "url" ? "selected" : ""}>Open externally</option></select></label><details><summary>Project resource & saved representation</summary><p>Resources stay in folders managed by your project. Ask your agent to register a resource root; use its root ID and relative path here.</p><label>Resource root ID<input name="rootId" value="${escape(c.resource?.rootId || "")}"></label><label>Resource path<input name="path" value="${escape(c.resource?.path || "")}" placeholder="ideas/first-video.mp4"></label><label>Preview image root ID<input name="previewRoot" value="${escape(p.resource?.rootId || "")}"></label><label>Preview image path<input name="previewPath" value="${escape(p.resource?.path || "")}"></label><label>Preview text<textarea name="previewText" rows="2">${escape(p.text || "")}</textarea></label><label>Start instructions<textarea name="startInstructions" rows="3">${escape(c.startInstructions || "")}</textarea></label></details><button type="submit" class="workspace-primary">${item ? "Save item" : "Add idea"}</button>`,
    async (f) => {
      const content = { kind: f.get("kind"), openMode: f.get("openMode") };
      for (const key of ["text", "url", "startInstructions"])
        if (f.get(key).trim()) content[key] = f.get(key).trim();
      if (f.get("rootId") || f.get("path"))
        content.resource = {
          rootId: f.get("rootId").trim(),
          path: f.get("path").trim(),
        };
      const preview = {};
      if (f.get("previewText").trim())
        preview.text = f.get("previewText").trim();
      if (f.get("previewRoot") || f.get("previewPath"))
        preview.resource = {
          rootId: f.get("previewRoot").trim(),
          path: f.get("previewPath").trim(),
        };
      const patch = {
        title: f.get("title").trim(),
        description: f.get("description"),
        content,
        preview,
        build: { ...(item?.build || { message: "" }), state: f.get("status") },
      };
      await client.write(
        item ? "updateItem" : "createItem",
        item ? { itemId: item.id, patch } : { boardId, item: patch },
      );
      await refresh();
      toast(item ? "Item updated." : "Idea added.");
    },
  );
}
