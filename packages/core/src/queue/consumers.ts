// Queue consumer dispatcher

export type QueueHandler = (messages: { body: any }[], env: any) => Promise<void>;

export function createDispatcher(handlers: Record<string, QueueHandler>) {
  return async (batch: { body: { type: string } }[], env: any): Promise<void> => {
    for (const msg of batch) {
      const handler = handlers[msg.body.type];
      if (handler) {
        await handler([msg], env);
      } else {
        console.log(`No handler for queue message type: ${msg.body.type}`);
      }
    }
  };
}
