import { CODE_LENGTH, NAME_MAX_LENGTH, normaliseCode, sanitiseName } from '@topple/shared';
import { el } from '../schemes/types.js';

export interface JoinScreenOptions {
  initialCode: string;
  initialName: string;
  onSubmit(code: string, name: string): void;
}

export interface JoinScreenHandle {
  element: HTMLElement;
  setError(message: string): void;
  setBusy(busy: boolean): void;
}

/**
 * First screen. Scanning the QR fills the code in, so the common path is one
 * field and one tap; typing the code by hand stays available for anyone whose
 * camera app refuses to cooperate.
 */
export function joinScreen(options: JoinScreenOptions): JoinScreenHandle {
  const card = el('div', 'center-card');

  const title = el('h1', 'big', 'TOPPLE PARTY');
  const blurb = el('p', 'dim', 'Enter the code on the TV, pick a name, and hold on to your tower.');

  const code = el('input', 'field');
  code.type = 'text';
  code.inputMode = 'text';
  code.autocapitalize = 'characters';
  code.autocomplete = 'off';
  code.spellcheck = false;
  code.placeholder = 'CODE';
  code.maxLength = CODE_LENGTH;
  code.value = normaliseCode(options.initialCode);

  const name = el('input', 'field name');
  name.type = 'text';
  name.autocomplete = 'off';
  name.placeholder = 'NAME';
  name.maxLength = NAME_MAX_LENGTH;
  name.value = options.initialName;

  const error = el('div', 'err');
  const submit = el('button', 'btn primary', 'JOIN');
  submit.type = 'button';

  code.addEventListener('input', () => {
    const cleaned = normaliseCode(code.value);
    if (cleaned !== code.value) code.value = cleaned;
    error.textContent = '';
  });

  name.addEventListener('input', () => {
    error.textContent = '';
  });

  const go = (): void => {
    const roomCode = normaliseCode(code.value);
    if (roomCode.length !== CODE_LENGTH) {
      error.textContent = 'That code needs ' + CODE_LENGTH + ' characters.';
      code.focus();
      return;
    }
    const playerName = sanitiseName(name.value);
    if (name.value.trim().length === 0) {
      error.textContent = 'Pick a name so the TV can shout at you.';
      name.focus();
      return;
    }
    options.onSubmit(roomCode, playerName);
  };

  submit.addEventListener('click', go);
  for (const field of [code, name]) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') go();
    });
  }

  card.append(title, blurb, code, name, error, submit);

  // Scanned the QR? The code is already right, so start on the name.
  queueMicrotask(() => {
    if (code.value.length === CODE_LENGTH) name.focus();
    else code.focus();
  });

  return {
    element: card,
    setError(message) {
      error.textContent = message;
    },
    setBusy(busy) {
      submit.disabled = busy;
      submit.textContent = busy ? 'JOINING...' : 'JOIN';
    },
  };
}
