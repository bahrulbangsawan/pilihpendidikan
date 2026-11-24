// Switches the UI language: saves it to the locale cookie and the account
// settings (setLocale), then updates the cached session so every string
// re-renders without a reload. Used by Settings and the profile dropdown.

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { SessionState } from "@/functions/session.functions";
import { setLocale } from "@/functions/session.functions";
import { queryKeys } from "@/lib/query";

export function useChangeLocale(): (locale: Locale) => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    async (locale: Locale) => {
      const record = queryClient.getQueryData<UserSettingsRecord>(
        queryKeys.settings
      );
      await setLocale({
        data: {
          locale,
          ...(record ? { base_revision: record.revision } : {}),
        },
      });
      queryClient.setQueryData<SessionState>(queryKeys.session, (state) =>
        state ? { ...state, locale } : state
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
    [queryClient]
  );
}
