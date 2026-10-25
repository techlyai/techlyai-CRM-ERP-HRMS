export async function readChat<T>(
  url: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (response.redirected || response.status === 401) {
    throw Error("Your session has expired. Sign in again to continue.");
  }
  if (!response.ok)
    throw Error("Chat could not refresh. Check your connection and try again.");
  const data = await response.json();
  if (data.error) throw Error(data.error);
  return data as T;
}
