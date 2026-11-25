const pendingForms = new WeakSet();

// Lock synchronously because a second submit can fire before React disables controls.
export async function guardFormSubmit(event, submit) {
  event.preventDefault();
  const form = event.currentTarget;
  if (pendingForms.has(form)) return;

  pendingForms.add(form);
  try {
    return await submit(event);
  } finally {
    pendingForms.delete(form);
  }
}
