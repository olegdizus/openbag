export async function fetchUrl(url: string): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  return { html, finalUrl: res.url };
}
