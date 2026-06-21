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
  private recorder: ((event: DomainEvent) => void) | undefined;

  constructor(onError: (e: HandlerError) => void = () => {}) {
    this.onError = onError;
  }

  on<T extends EventType>(type: T, handler: Handler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as AnyHandler);
    this.handlers.set(type, list);
  }

  // Records every published event (the outbox / durable event log). Set once at wiring time.
  onPublish(recorder: (event: DomainEvent) => void): void {
    this.recorder = recorder;
  }

  // Publish and await all handlers. Sequential for deterministic tests; isolation means a
  // thrown handler is captured (and reported) rather than rejecting the publish. Every event is
  // first appended to the outbox so it survives restart and a future relay can replay it.
  async publish(event: DomainEvent): Promise<void> {
    try {
      this.recorder?.(event);
    } catch (error) {
      this.onError({ event, error });
    }
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
