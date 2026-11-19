// "Where you are" for an opened Tinka: the path from Home down to this Tinka and its own board, then a numbered list
// of what sits beside it on this board. A UI SDK Menu (popups.js; board.html #reader-path-menu): each row is a place
// to go, so it is a list of actions, as in a Finder path menu or an editor's breadcrumb menu, not a Popover (it holds
// no field) nor a Hover Card (its triggers are buttons, not links, and touch must reach it). Pressing the title or the
// ‹ n / N › count opens it (Enter, Space or ↓ at the first row, ↑ at the last); arrows, Home/End and typeahead move
// through the rows; a row navigates; Escape, a press outside or Tab closes it and focus returns to the button.
// Menus open on a press, not on hover (the SDK has no hover-open menu), so the old hover delay is gone.
import {guardMenu} from './popups.js';

export class ReaderPath {
  constructor(root, {render, go}) {
    Object.assign(this, {root, render, go});
    guardMenu(root);
    this.content = root.querySelector('ui-menu-content');
    root.addEventListener('openchange', event => { if (event.detail.value) this.fill(); });
    root.addEventListener('action', event => this.go(event.detail.value));
  }
  get isOpen() { return !!this.root.open; }
  fill() {
    this.content.innerHTML = this.render();
    requestAnimationFrame(() => this.content.querySelector('[aria-current="true"]')?.scrollIntoView?.({block: 'nearest'}));
  }
  // Re-render in place, for example after stepping or after "… n more" unfolds the path. Keeps the highlighted row.
  refresh() {
    if (!this.isOpen) return;
    const value = this.content.querySelector('[data-highlighted]')?.getAttribute('value');
    this.content.innerHTML = this.render();
    if (value) [...this.content.querySelectorAll('[value]')].find(row => row.getAttribute('value') === value)?.focus({preventScroll: true});
  }
  close() {
    if (!this.isOpen) return false;
    this.root.api.close({reason: 'imperative'});
    return true;
  }
}
