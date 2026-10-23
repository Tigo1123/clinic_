import { readFile, writeFile, unlink } from 'node:fs/promises';
import { transformWithOxc } from 'vite';

// Exercise the real paging hook/component while injecting each component test's transport.
export async function pagingReplacements(source, requestName, globalName) {
  let hook = await readFile(new URL('../../src/hooks/useStaffPagedList.js', import.meta.url), 'utf8');
  hook = hook.replace(/import \{ fetchWithAuth \}[^;]+;/, `const fetchWithAuth = (...args) => globalThis.${requestName}(...args);`)
    .replace("'../services/pagedList.js'", JSON.stringify(new URL('../../src/services/pagedList.js', import.meta.url).href));
  const file = new URL(`.paging-${process.pid}-${globalName}.mjs`, import.meta.url);
  await writeFile(file, hook);
  try { globalThis[globalName] = (await import(file.href)).useStaffPagedList; } finally { await unlink(file); }
  const paging = await readFile(new URL('../../src/components/StaffListPaging.jsx', import.meta.url), 'utf8');
  await writeFile(file, (await transformWithOxc(paging, 'StaffListPaging.jsx', { jsx: { runtime: 'automatic' } })).code);
  try { globalThis[`${globalName}Controls`] = (await import(`${file.href}?controls`)).default; } finally { await unlink(file); }
  return source.replace(/import \{ useStaffPagedList \}[^;]+;/, `const useStaffPagedList = globalThis.${globalName};`)
    .replace(/import StaffListPaging[^;]+;/, `const StaffListPaging = globalThis.${globalName}Controls;`);
}
