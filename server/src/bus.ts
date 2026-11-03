import Redis from "ioredis";

/**
 * Fan-out between app pods. Every event is published to Redis and each pod delivers it to the
 * sockets it holds, so any pod can serve any Visitor or Operator (the app tier stays stateless).
 */
export type BusEvent =
  | { to: "visitor"; visitorId: string; payload: unknown }
  | { to: "operators"; merchantId: string; payload: unknown };

const CHANNEL = "pearl:events";
const url = process.env.REDIS_URL ?? "redis://localhost:6379";
const pub = new Redis(url);
const sub = new Redis(url);

export function publish(event: BusEvent): void {
  pub.publish(CHANNEL, JSON.stringify(event)).catch((err) => console.error("bus publish failed", err));
}

export async function subscribe(handler: (event: BusEvent) => void): Promise<void> {
  await sub.subscribe(CHANNEL);
  sub.on("message", (_channel, raw) => {
    try {
      handler(JSON.parse(raw) as BusEvent);
    } catch (err) {
      console.error("bad bus event", err);
    }
  });
}
