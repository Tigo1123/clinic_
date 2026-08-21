import { createElement, useRef } from 'react';
import { normalizeTotpCode } from '../utils/mfaCode.js';

export default function MfaCodeInput({ value, onValueChange, ...inputProps }) {
  const isComposing = useRef(false);

  const commitValue = (nextValue) => {
    onValueChange(normalizeTotpCode(nextValue));
  };

  return createElement('input', {
    ...inputProps,
    type: 'text',
    inputMode: 'numeric',
    autoComplete: 'one-time-code',
    value,
    onCompositionStart: () => {
      isComposing.current = true;
    },
    onCompositionEnd: (event) => {
      isComposing.current = false;
      commitValue(event.currentTarget.value);
    },
    onInput: (event) => {
      if (isComposing.current || event.nativeEvent?.isComposing) return;
      commitValue(event.currentTarget.value);
    },
  });
}
