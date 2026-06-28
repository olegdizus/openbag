export function extractMetadata(article: { title?: string; byline?: string; length?: number; excerpt?: string; siteName?: string }) {
  return {
    title: article.title || "",
    authors: article.byline ? article.byline.split(",").map((a) => a.trim()).join(",") : "",
    preview_picture: "",
    language: "en",
    reading_time: Math.max(1, Math.ceil((article.length || 0) / 200)),
  };
}
