import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { normalizeTotpCode } from '../utils/mfaCode.js';

const MfaCodeInput = forwardRef(function MfaCodeInput({ onValueChange, ...inputProps }, forwardedRef) {
  const inputRef = useRef(null);
  const isComposing = useRef(false);
  const compositionTail = useRef(null);
  const compositionTailTimer = useRef(null);

  const clearCompositionTail = () => {
    if (compositionTailTimer.current) clearTimeout(compositionTailTimer.current);
    compositionTailTimer.current = null;
    compositionTail.current = null;
  };

  const commitValue = (nextValue) => {
    const normalized = normalizeTotpCode(nextValue);
    if (inputRef.current) inputRef.current.value = normalized;
    onValueChange?.(normalized);
    return normalized;
  };

  useImperativeHandle(forwardedRef, () => ({
    clear() {
      isComposing.current = false;
      clearCompositionTail();
      commitValue('');
    },
    focus() {
      inputRef.current?.focus();
    },
    getValue() {
      return normalizeTotpCode(inputRef.current?.value);
    },
  }));

  useEffect(() => () => clearCompositionTail(), []);

  return createElement('input', {
    ...inputProps,
    ref: inputRef,
    type: 'text',
    inputMode: 'numeric',
    autoComplete: 'one-time-code',
    onCompositionStart: () => {
      isComposing.current = true;
      clearCompositionTail();
    },
    onCompositionEnd: (event) => {
      isComposing.current = false;
      const committed = commitValue(event.currentTarget.value);
      compositionTail.current = { committed };
      compositionTailTimer.current = setTimeout(clearCompositionTail, 100);
    },
    onInput: (event) => {
      if (isComposing.current || event.nativeEvent?.isComposing) return;
      const candidate = normalizeTotpCode(event.currentTarget.value);
      const inputType = event.nativeEvent?.inputType || '';
      const tail = compositionTail.current;
      clearCompositionTail();

      if (
        tail
        && candidate.length < tail.committed.length
        && tail.committed.startsWith(candidate)
        && !inputType.startsWith('delete')
      ) {
        commitValue(tail.committed);
        return;
      }

      commitValue(candidate);
    },
    onPaste: (event) => {
      event.preventDefault();
      isComposing.current = false;
      clearCompositionTail();
      commitValue(event.clipboardData.getData('text'));
    },
  });
});

export default MfaCodeInput;
