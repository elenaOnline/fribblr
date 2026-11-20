// The board's keyboard focus helpers that need no DOM (public/board-focus.js): container membership, where an
// Option-arrow takes a container member (UI SDK reorder keys on the move chord), and spoken names for drawn elements.
import test from 'node:test';
import assert from 'node:assert/strict';
import {childKey, refOfKey, containerMembers, reorderIndex, decorationLabel} from '../public/board-focus.js';

test('container members are keyed like the roving group, with their parent and place', () => {
  assert.equal(childKey('t1'), 'decoration:t1');
  assert.equal(childKey({placementId: 'p1'}), 'placement:p1');
  assert.deepEqual(refOfKey('placement:p1'), {placementId: 'p1'});
  assert.deepEqual(refOfKey('decoration:t1'), {decorationId: 't1'});
  assert.equal(refOfKey(null), null);
  const board = {decorations: [
    {id: 'stack', container: {layout: 'vertical', children: ['t1', {placementId: 'p1'}, 't2']}},
    {id: 't1'}, {id: 't2'}, {id: 'loose'},
  ]};
  const members = containerMembers(board);
  assert.equal(members.size, 3);
  assert.equal(members.get('placement:p1').parent.id, 'stack');
  assert.equal(members.get('placement:p1').index, 1);
  assert.equal(members.get('decoration:t2').count, 3);
  assert.equal(members.has('decoration:loose'), false);
  assert.equal(containerMembers({}).size, 0);
});

test('Option-arrow moves a container member along its layout: one place, or with Shift to an end', () => {
  const stack = {layout: 'vertical'}, row = {layout: 'horizontal'}, grid = {layout: 'grid', columns: 2};
  const [up, down, left, right] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  assert.equal(reorderIndex(stack, 1, 3, up), 0);
  assert.equal(reorderIndex(stack, 1, 3, down), 2);
  assert.equal(reorderIndex(stack, 1, 3, left), null, 'a stack does not move sideways');
  assert.equal(reorderIndex(stack, 0, 3, up), null, 'already first');
  assert.equal(reorderIndex(stack, 2, 3, down), null, 'already last');
  assert.equal(reorderIndex(stack, 1, 3, down, true), 2);
  assert.equal(reorderIndex(stack, 2, 3, up, true), 0, 'Shift goes to the first place');
  assert.equal(reorderIndex(row, 0, 3, right), 1);
  assert.equal(reorderIndex(row, 0, 3, down), null, 'a row does not move up or down');
  assert.equal(reorderIndex(grid, 0, 4, right), 1);
  assert.equal(reorderIndex(grid, 0, 4, down), 2, 'down a row in a two-column grid');
  assert.equal(reorderIndex(grid, 3, 4, up), 1);
  assert.equal(reorderIndex(grid, 2, 4, down), null, 'no row below');
  assert.equal(reorderIndex({layout: 'grid', columns: 4}, 0, 3, down), null, 'columns wider than the members: one row');
  assert.equal(reorderIndex(undefined, 1, 2, up), 0, 'a container without settings is a stack');
});

test('drawn elements have short spoken names', () => {
  assert.equal(decorationLabel({sticker: true, text: '🚀'}), 'Sticker 🚀');
  assert.equal(decorationLabel({type: 'text', text: '## Heading\nbody'}), 'Heading');
  assert.equal(decorationLabel({type: 'text', text: '- [ ] A task'}), 'A task');
  assert.equal(decorationLabel({type: 'region', container: {children: []}, text: ''}), 'Container');
  assert.equal(decorationLabel({type: 'line', text: ''}), 'Arrow');
  assert.equal(decorationLabel({type: 'region', shape: 'ellipse'}), 'ellipse');
  assert.equal(decorationLabel(null), 'Item');
});
