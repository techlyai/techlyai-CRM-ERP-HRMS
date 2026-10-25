type ReadResult = { ok: boolean; error?: string };

type NotificationHeadRow = { id: string; created_at: string };

/** Resume after a changed head so bursts cannot leave a gap in older history. */
export function reconcileNotificationHead(
  previous: NotificationHeadRow[],
  next: NotificationHeadRow[],
  pageSize: number,
): { offset: number; exhausted: boolean } | null {
  const timestamps = new Map(previous.map((row) => [row.id, row.created_at]));
  const changed =
    previous.length !== next.length ||
    next.some((row) => timestamps.get(row.id) !== row.created_at);
  // Read acknowledgements and equal-timestamp reordering do not move the
  // coverage boundary and must not restart completed pagination.
  return changed
    ? { offset: next.length, exhausted: next.length < pageSize }
    : null;
}

/** Only acknowledge IDs from batches that the server has actually saved. */
export async function readNotificationsInBatches(
  ids: string[],
  action: (batch: string[]) => Promise<ReadResult>,
): Promise<{ readIds: string[]; error?: string }> {
  const unique = Array.from(new Set(ids));
  const readIds: string[] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    try {
      const result = await action(batch);
      if (!result.ok)
        return {
          readIds,
          error:
            result.error || "Could not update notifications. Please try again.",
        };
      readIds.push(...batch);
    } catch {
      return {
        readIds,
        error:
          "Could not update notifications. Check your connection and try again.",
      };
    }
  }
  return { readIds };
}

/** The badge covers all notifications, including rows not loaded by the page. */
export async function refreshUnreadCount() {
  const response = await fetch("/api/notifications?limit=1", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not refresh unread count");
  const value = response.headers.get("X-Techly-Unread");
  if (value === null || !Number.isFinite(Number(value))) return;
  const count = Math.max(0, Math.min(100, Number(value)));
  window.dispatchEvent(new CustomEvent("techly:unread", { detail: count }));
}
