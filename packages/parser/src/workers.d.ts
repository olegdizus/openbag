// Cloudflare Workers globals
declare const HTMLRewriter: {
  new (): HTMLRewriterInstance;
};

interface HTMLRewriterInstance {
  on(selector: string, handlers: {
    text?: (this: any, el: { text: string; lastInTextNode: boolean }) => void;
    element?: (this: any, el: {
      getAttribute: (name: string) => string | null;
      hasAttribute: (name: string) => boolean;
      removeAttribute: (name: string) => void;
      remove(): void;
      replace(this: any, html: string, options?: { html?: boolean }): void;
      setInnerContent(this: any, html: string, options?: { html?: boolean }): void;
    }) => void;
  }): HTMLRewriterInstance;
  transform(response: Response): Response;
}
