import http from "http";
import path from "path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { initDb } from "./db";
import { subscribe } from "./bus";
import { listProducts } from "./crossSell";
import { isAutomatedTraffic } from "./automatedTraffic";
import { aiAgentMode, proactiveOffer, respond } from "./aiAgent";
import {
  addMessage,
  closeConversation,
  conversationContext,
  customerNameFor,
  DomainError,
  ensureVisitor,
  findOpenConversation,
  getConversation,
  handoff,
  identify,
  listConversations,
  listMessages,
  openConversation,
  operatorSend,
  setViewing,
  take,
} from "./conversations";

const PORT = Number(process.env.PORT ?? 3000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
app.get("/", (_req, res) => res.redirect("/store/"));
app.get("/healthz", (_req, res) => res.json({ ok: true, aiAgent: aiAgentMode }));
app.get("/api/merchants/:merchantId/products", async (req, res) => {
  res.json(await listProducts(req.params.merchantId));
});
app.use(express.static(path.join(process.cwd(), "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Sockets held by this pod. Events from any pod arrive through the bus.
const visitorSockets = new Map<string, Set<WebSocket>>();
const operatorSockets = new Map<string, Set<WebSocket>>();

function track(map: Map<string, Set<WebSocket>>, key: string, ws: WebSocket) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(ws);
  ws.on("close", () => {
    map.get(key)?.delete(ws);
    if (map.get(key)?.size === 0) map.delete(key);
  });
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

/**
 * Listens immediately (so nothing sent right after connect is lost) and handles each socket's
 * messages one at a time, in order, once `ready` has resolved.
 */
function onJson(ws: WebSocket, ready: Promise<unknown>, handler: (msg: any) => Promise<void>) {
  let chain: Promise<unknown> = ready;
  ws.on("message", (raw) => {
    chain = chain.then(async () => {
      try {
        await handler(JSON.parse(raw.toString()));
      } catch (err) {
        if (err instanceof DomainError) send(ws, { type: "error", error: err.message });
        else {
          console.error(err);
          send(ws, { type: "error", error: "Something went wrong" });
        }
      }
    });
  });
}

const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const id = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const merchantId = url.searchParams.get("merchant") ?? "demo";

  if (url.pathname === "/ws/visitor") {
    const visitorId = url.searchParams.get("visitorId") ?? "";
    if (!UUID.test(visitorId)) return ws.close(1008, "bad visitorId");
    const userAgent = req.headers["user-agent"];
    track(visitorSockets, visitorId, ws);
    const ready = (async () => {
      await ensureVisitor(visitorId, merchantId);
      const conversation = await findOpenConversation(visitorId);
      send(ws, {
        type: "hello",
        customerName: await customerNameFor(visitorId),
        conversation,
        messages: conversation ? await listMessages(conversation.id) : [],
      });
    })();
    ready.catch((err) => {
      console.error(err);
      ws.close(1011, "init failed");
    });

    onJson(ws, ready, async (msg) => {
      switch (msg.type) {
        case "identify":
          send(ws, { type: "identified", customerName: await identify(visitorId, text(msg.externalId, 100)) });
          break;
        case "viewing":
          await setViewing(visitorId, id(msg.productId));
          break;
        case "proactive": {
          const productId = id(msg.productId);
          const signals = { interacted: msg.signals?.interacted === true, webdriver: msg.signals?.webdriver !== false };
          if (!productId) break;
          if (isAutomatedTraffic(userAgent, signals)) {
            console.log(`Proactive Trigger suppressed: Automated traffic (visitor ${visitorId})`);
            break;
          }
          await proactiveOffer(visitorId, productId);
          break;
        }
        case "message": {
          const body = text(msg.body);
          if (!body) break;
          const conversation = await openConversation(visitorId);
          await addMessage(conversation.id, "visitor", body);
          await respond(conversation.id, body);
          break;
        }
        case "request_human": {
          const conversation = await openConversation(visitorId);
          await handoff(conversation.id, "the Visitor asked for a human.");
          break;
        }
      }
    });
    return;
  }

  if (url.pathname === "/ws/operator") {
    track(operatorSockets, merchantId, ws);
    const ready = listConversations(merchantId).then((conversations) =>
      send(ws, { type: "conversations", conversations, aiAgent: aiAgentMode }),
    );
    ready.catch((err) => {
      console.error(err);
      ws.close(1011, "init failed");
    });

    onJson(ws, ready, async (msg) => {
      const conversationId = id(msg.conversationId);
      const operatorName = text(msg.operatorName, 60);
      if (conversationId && (await getConversation(conversationId)).merchantId !== merchantId) {
        throw new DomainError("Not your Merchant's Conversation");
      }
      switch (msg.type) {
        case "open":
          if (!conversationId) break;
          send(ws, {
            type: "detail",
            conversation: await getConversation(conversationId),
            messages: await listMessages(conversationId),
            context: await conversationContext(conversationId),
          });
          break;
        case "take":
          if (!conversationId || !operatorName) throw new DomainError("Enter your Operator name first");
          await take(conversationId, operatorName);
          break;
        case "send": {
          const body = text(msg.body);
          if (!conversationId || (!body && !msg.productId)) break;
          await operatorSend(conversationId, operatorName, body, id(msg.productId));
          break;
        }
        case "close":
          if (conversationId) await closeConversation(conversationId);
          break;
      }
    });
    return;
  }

  ws.close(1008, "unknown path");
});

async function main() {
  await initDb();
  await subscribe((event) => {
    const sockets = event.to === "visitor" ? visitorSockets.get(event.visitorId) : operatorSockets.get(event.merchantId);
    sockets?.forEach((ws) => send(ws, event.payload));
  });
  server.listen(PORT, () => console.log(`PEARL listening on :${PORT} (AI Agent: ${aiAgentMode})`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
