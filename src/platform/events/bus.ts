// In-process event bus — the seam that becomes Kafka/Pub-Sub later (docs/ARCHITECTURE.md §2).
// Consumers are idempotent and isolated: one failing handler is recorded but does not stop
// the others, mirroring how a real broker delivers independently to each consumer group.

import type { DomainEvent, EventOf, EventType } from "./events.ts";

export type Handler<T extends EventType> = (event: EventOf<T>) => void | Promise<void>;

type AnyHandler = (event: DomainEvent) => void | Promise<void>;

export type HandlerError = { event: DomainEvent; error: unknown };

export class EventBus {
  private readonly handlers = new Map<EventType, AnyHandler[]>();
  private readonly onError: (e: HandlerError) => void;

  constructor(onError: (e: HandlerError) => void = () => {}) {
    this.onError = onError;
  }

  on<T extends EventType>(type: T, handler: Handler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as AnyHandler);
    this.handlers.set(type, list);
  }

  // Publish and await all handlers. Sequential for deterministic tests; isolation means a
  // thrown handler is captured (and reported) rather than rejecting the publish.
  async publish(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.type) ?? [];
    for (const handler of list) {
      try {
        await handler(event);
      } catch (error) {
        this.onError({ event, error });
      }
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
