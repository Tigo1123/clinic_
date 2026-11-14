/**
 * StaffShellContext — shared context between StaffShell and each dashboard.
 *
 * Usage in a dashboard:
 *   useStaffNav({ items, activeId, onSelect, roleLabel })
 *
 * items = [{ id, label, icon: LucideComponent, count?: number|string }]
 *
 * The hook registers nav on mount/update and clears on unmount.
 * Until a dashboard calls useStaffNav the rail shows no nav items.
 */
import { createContext, useContext, useEffect, useRef, useCallback } from 'react';

export const StaffShellContext = createContext(null);

function buildNavKey(items, activeId, roleLabel) {
  const itemsPart = (items || [])
    .map((item) => `${item?.id ?? ''}:${item?.label ?? ''}:${item?.count ?? ''}`)
    .join('|');
  return `${roleLabel ?? ''}::${activeId ?? ''}::${itemsPart}`;
}

/**
 * useStaffNav({ items, activeId, onSelect, roleLabel })
 *
 * @param {object} opts
 * @param {Array<{ id: string, label: string, icon: React.ComponentType, count?: string|number }>} opts.items
 * @param {string} opts.activeId - id of the currently active nav item
 * @param {function} opts.onSelect - called with item id when nav item clicked
 * @param {string} [opts.roleLabel] - optional role sub-label shown in rail brand
 */
export function useStaffNav({ items, activeId, onSelect, roleLabel }) {
  const ctx = useContext(StaffShellContext);
  const onSelectRef = useRef(onSelect);
  const lastKeyRef = useRef(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const handleSelect = useCallback((id) => {
    onSelectRef.current?.(id);
  }, []);

  const navKey = buildNavKey(items, activeId, roleLabel);

  useEffect(() => {
    if (!ctx) return;
    if (lastKeyRef.current !== navKey) {
      lastKeyRef.current = navKey;
      ctx.setNav({ items, activeId, onSelect: handleSelect, roleLabel });
    }
  }, [ctx, navKey, items, activeId, handleSelect, roleLabel]);

  useEffect(() => {
    if (!ctx) return undefined;
    return () => {
      lastKeyRef.current = null;
      ctx.setNav(null);
    };
  }, [ctx]);
}
