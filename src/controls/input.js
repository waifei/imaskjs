// @flow
import {objectIncludes, DIRECTION, type Selection} from '../core/utils.js';
import ActionDetails from '../core/action-details.js';
import MaskedDate from '../masked/date.js';
import createMask, {maskedClass} from '../masked/factory.js';
import type Masked from '../masked/base.js';
import {type Mask} from '../masked/base.js';


interface UIElement {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange (number, number): void;
  addEventListener(string, Function): void;
  removeEventListener(string, Function): void;
}

export default
class InputMask {
  el: UIElement;
  masked: Masked<*>;
  alignCursor: () => void;
  alignCursorFriendly: () => void;

  _listeners: {[string]: Array<Function>};
  _value: string;
  _changingCursorPos: number;
  _unmaskedValue: string;
  _saveSelection: (?Event) => void;
  _selection: Selection;
  _onInput: (Event) => void;
  _onChange: () => void;
  _onDrop: (Event) => void;
  _cursorChanging: number;

  constructor (el: UIElement, opts: any) {
    this.el = el;
    this.masked = createMask(opts);

    this._listeners = {};
    this._value = '';
    this._unmaskedValue = '';

    this._saveSelection = this._saveSelection.bind(this);
    this._onInput = this._onInput.bind(this);
    this._onChange = this._onChange.bind(this);
    this._onDrop = this._onDrop.bind(this);
    this.alignCursor = this.alignCursor.bind(this);
    this.alignCursorFriendly = this.alignCursorFriendly.bind(this);

    this.bindEvents();

    // refresh
    this.updateValue();
    this._onChange();
  }

  get mask (): Mask {
    return this.masked.mask;
  }
  set mask (mask: Mask) {
    if (mask == null || mask === this.masked.mask) return;

    if (this.masked.constructor === maskedClass(mask)) {
      this.masked.mask = mask;
      return;
    }

    const masked = createMask({mask});
    masked.unmaskedValue = this.masked.unmaskedValue;
    this.masked = masked;
  }

  get value (): string {
    return this._value;
  }

  set value (str: string) {
    this.masked.value = str;
    this.updateControl();
    this.alignCursor();
  }

  get unmaskedValue (): string {
    return this._unmaskedValue;
  }

  set unmaskedValue (str: string) {
    this.masked.unmaskedValue = str;
    this.updateControl();
    this.alignCursor();
  }

  bindEvents () {
    this.el.addEventListener('keydown', this._saveSelection);
    this.el.addEventListener('input', this._onInput);
    this.el.addEventListener('drop', this._onDrop);
    this.el.addEventListener('click', this.alignCursorFriendly);
    this.el.addEventListener('change', this._onChange);
  }

  unbindEvents () {
    this.el.removeEventListener('keydown', this._saveSelection);
    this.el.removeEventListener('input', this._onInput);
    this.el.removeEventListener('drop', this._onDrop);
    this.el.removeEventListener('click', this.alignCursorFriendly);
    this.el.removeEventListener('change', this._onChange);
  }

  fireEvent (ev: string) {
    const listeners = this._listeners[ev] || [];
    listeners.forEach(l => l());
  }

  get selectionStart (): number {
    return this._cursorChanging ?
      this._changingCursorPos :

      this.el.selectionStart;
  }

  get cursorPos (): number {
    return this._cursorChanging ?
      this._changingCursorPos :

      this.el.selectionEnd;
  }

  set cursorPos (pos: number) {
    if (this.el !== document.activeElement) return;

    this.el.setSelectionRange(pos, pos);
    this._saveSelection();
  }

  _saveSelection (/* ev */) {
    if (this.value !== this.el.value) {
      console.warn('Uncontrolled input change, refresh mask manually!'); // eslint-disable-line no-console
    }
    this._selection = {
      start: this.selectionStart,
      end: this.cursorPos
    };
  }

  updateValue () {
    this.masked.value = this.el.value;
  }

  updateControl () {
    const newUnmaskedValue = this.masked.unmaskedValue;
    const newValue = this.masked.value;
    const isChanged = (this.unmaskedValue !== newUnmaskedValue ||
      this.value !== newValue);

    this._unmaskedValue = newUnmaskedValue;
    this._value = newValue;

    if (this.el.value !== newValue) this.el.value = newValue;
    if (isChanged) this._fireChangeEvents();
  }

  updateOptions (opts: any) {
    opts = Object.assign({}, opts);  // clone
    if (opts.mask === Date && this.masked instanceof MaskedDate) delete opts.mask;

    // check if changed
    if (objectIncludes(this.masked, opts)) return;

    this.masked.updateOptions(opts);
    this.updateControl();
  }

  updateCursor (cursorPos: number) {
    if (cursorPos == null) return;
    this.cursorPos = cursorPos;

    // also queue change cursor for mobile browsers
    this._delayUpdateCursor(cursorPos);
  }

  _delayUpdateCursor (cursorPos: number) {
    this._abortUpdateCursor();
    this._changingCursorPos = cursorPos;
    this._cursorChanging = setTimeout(() => {
      if (!this.el) return; // if was destroyed
      this.cursorPos = this._changingCursorPos;
      this._abortUpdateCursor();
    }, 10);
  }

  _fireChangeEvents () {
    this.fireEvent('accept');
    if (this.masked.isComplete) this.fireEvent('complete');
  }

  _abortUpdateCursor () {
    if (this._cursorChanging) {
      clearTimeout(this._cursorChanging);
      delete this._cursorChanging;
    }
  }

  alignCursor () {
    this.cursorPos = this.masked.nearestInputPos(this.cursorPos, DIRECTION.LEFT);
  }

  alignCursorFriendly () {
    if (this.selectionStart !== this.cursorPos) return;
    this.alignCursor();
  }

  on (ev: string, handler: Function) {
    if (!this._listeners[ev]) this._listeners[ev] = [];
    this._listeners[ev].push(handler);
    return this;
  }

  off (ev: string, handler: Function) {
    if (!this._listeners[ev]) return;
    if (!handler) {
      delete this._listeners[ev];
      return;
    }
    const hIndex = this._listeners[ev].indexOf(handler);
    if (hIndex >= 0) this._listeners[ev].splice(hIndex, 1);
    return this;
  }

  _onInput () {
    this._abortUpdateCursor();

    const details = new ActionDetails(
      // new state
      this.el.value, this.cursorPos,
      // old state
      this.value, this._selection);

    const offset = this.masked.splice(
      details.startChangePos,
      details.removed.length,
      details.inserted,
      details.removeDirection).offset;


    const cursorPos = this.masked.nearestInputPos(details.startChangePos + offset);

    this.updateControl();
    this.updateCursor(cursorPos);
  }

  _onChange () {
    if (this.value !== this.el.value) {
      this.updateValue();
    }
    this.masked.doCommit();
    this.updateControl();
  }

  _onDrop (ev: Event) {
    ev.preventDefault();
    ev.stopPropagation();
  }

  destroy () {
    this.unbindEvents();
    // $FlowFixMe why not do so?
    this._listeners.length = 0;
    delete this.el;
  }
}
