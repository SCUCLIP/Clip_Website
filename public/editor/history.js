/* Undo and redo, per doc. Each entry is a JSON snapshot taken before a change. Changes made in quick
   succession with the same key (typing in one field, nudging with the arrow keys) count as one step. */

const LIMIT = 150;
const MERGE_MS = 700;

export class History {
  constructor() { this.stacks = new Map(); }
  stack(id) {
    if (!this.stacks.has(id)) this.stacks.set(id, { undo: [], redo: [], lastKey: null, lastAt: 0 });
    return this.stacks.get(id);
  }
  /** Call before changing doc `id`. */
  record(id, doc, key = null) {
    const s = this.stack(id);
    const now = Date.now();
    if (key && key === s.lastKey && now - s.lastAt < MERGE_MS) { s.lastAt = now; return; }
    s.undo.push(JSON.stringify(doc));
    if (s.undo.length > LIMIT) s.undo.shift();
    s.redo = [];
    s.lastKey = key;
    s.lastAt = now;
  }
  undo(id, current) {
    const s = this.stack(id);
    if (!s.undo.length) return null;
    s.redo.push(JSON.stringify(current));
    s.lastKey = null;
    return JSON.parse(s.undo.pop());
  }
  redo(id, current) {
    const s = this.stack(id);
    if (!s.redo.length) return null;
    s.undo.push(JSON.stringify(current));
    s.lastKey = null;
    return JSON.parse(s.redo.pop());
  }
  canUndo(id) { return this.stack(id).undo.length > 0; }
  canRedo(id) { return this.stack(id).redo.length > 0; }
  clear(id) { this.stacks.delete(id); }
}
