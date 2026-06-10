import { JSDOM } from "jsdom";
import Readability from "@mozilla/readability";

export function parseArticle(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const result = reader.parse();
  return result || null;
}
