import { createElement, forwardRef, useImperativeHandle, useRef } from 'react';
import { normalizeTotpCode } from '../utils/mfaCode.js';

const MfaCodeInput = forwardRef(function MfaCodeInput(inputProps, forwardedRef) {
  const inputRef = useRef(null);

  useImperativeHandle(forwardedRef, () => ({
    clear() {
      if (inputRef.current) inputRef.current.value = '';
    },
    focus() {
      inputRef.current?.focus();
    },
    getValue() {
      return normalizeTotpCode(inputRef.current?.value);
    },
  }));

  return createElement('input', {
    ...inputProps,
    ref: inputRef,
    type: 'text',
    inputMode: 'numeric',
    autoComplete: 'one-time-code',
  });
});

export default MfaCodeInput;
