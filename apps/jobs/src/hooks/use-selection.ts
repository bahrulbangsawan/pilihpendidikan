// Row selection for list screens with bulk actions. The selection only ever
// holds ids that are still visible: when a row disappears (deleted, filtered
// out, moved by a poll) it leaves the selection too, so a bulk action never
// acts on something the user can no longer see.

import { useCallback, useEffect, useMemo, useState } from "react";

export interface Selection {
  allSelected: boolean;
  clear: () => void;
  isSelected: (id: string) => boolean;
  /** Selected ids in the order of `visibleIds`. */
  selectedIds: string[];
  size: number;
  someSelected: boolean;
  toggle: (id: string, value: boolean) => void;
  toggleAll: (value: boolean) => void;
}

export function useSelection(visibleIds: readonly string[]): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const visibleKey = visibleIds.join("\u0000");

  // Drop ids that are no longer listed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids' content, not the array identity
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) {
        return current;
      }
      const visible = new Set(visibleIds);
      const kept = [...current].filter((id) => visible.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [visibleKey]);

  const toggle = useCallback((id: string, value: boolean) => {
    setSelected((current) => {
      if (current.has(id) === value) {
        return current;
      }
      const next = new Set(current);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids' content, not the array identity
  const toggleAll = useCallback(
    (value: boolean) => setSelected(value ? new Set(visibleIds) : new Set()),
    [visibleKey]
  );

  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(() => {
    const selectedIds = visibleIds.filter((id) => selected.has(id));
    const allSelected =
      visibleIds.length > 0 && selectedIds.length === visibleIds.length;
    return {
      selectedIds,
      size: selectedIds.length,
      allSelected,
      someSelected: selectedIds.length > 0 && !allSelected,
      isSelected: (id: string) => selected.has(id),
      toggle,
      toggleAll,
      clear,
    };
  }, [visibleIds, selected, toggle, toggleAll, clear]);
}
