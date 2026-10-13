// A screen-reader announcer for an `aria-live` region (12 §12): moves,
// rollbacks and refusals are read out even when focus stays put.
import { useCallback, useState } from "react";

export function useAnnouncer() {
  const [message, setMessage] = useState("");
  const announce = useCallback((text: string) => {
    // A repeated message must still be read: alternate a trailing space.
    setMessage((previous) => (previous === text ? `${text}\u00a0` : text));
  }, []);
  return { message, announce };
}
