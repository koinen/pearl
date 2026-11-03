# PEARL: proof of concept

**PEARL** is a chat widget that online shops put on their websites. Most support chats sit and wait for a shopper to ask something, answer it, and stop there. PEARL is meant to also **sell**:
- It starts conversations on its own.
- It suggests related products while chatting.
- It lets an AI handle the routine questions and passes the rest to a human.

This repo is a **proof of concept**, not a product. It shows that the core loop works from start to finish on a demo shop: a shopper browses, the AI starts a chat, makes an offer, and passes the chat to a human, who closes the sale. The full pitch (market, pricing, scaling plan) is in [`Komlay.pdf`](./Komlay.pdf), by Kelompok 10.

## The problem it addresses

Existing chat tools such as tawk.to:
- **Wait for the shopper to start the chat**, so a lot of buying intent never turns into a conversation.
- **Treat chat as a cost centre.** Success is measured by response time and satisfaction, not sales.
- **Don't connect to selling.** Agents can't see what the shopper has bought before, and nothing suggests what else to offer.

PEARL's bet is that the chat window can be where sales happen.

## What the POC demonstrates

| Idea from the pitch | In this POC |
|---|---|
| **Proactive chat triggers.** Greet interested visitors instead of waiting. | ✅ After about 8 seconds on a product page, the AI Agent opens the chat with an offer for that product. |
| **Bot detection before triggering.** | ✅ The trigger doesn't fire for crawlers, automated browsers, or visits with no real mouse, scroll or key activity. |
| **Hybrid AI + human support.** | ✅ The AI Agent answers first. When it can't help, or the shopper asks for a person, it **hands off** to a human Operator, and from then on it stays silent. |
| **Dynamic cross-selling during the chat.** | ✅ Related products show up as clickable cards. They're based on what the shopper is viewing and, for a logged-in customer, what they've bought before (it never suggests something they already own). |
| **Operator console with shopper context.** | ✅ A dashboard lists all chats, alerts on each handoff, and shows the shopper's past orders and suggested products, which the Operator can send in one click. |
| **Scalable design** (stateless app pods, shared database). | ✅ Partly. The app keeps no state of its own, and Redis passes messages between app instances, so more copies can be added. It runs as a single instance with Docker Compose, not on Kubernetes. |
| Automated remarketing to inactive customers | ❌ Not built |
| Campaign-based chat customization | ❌ Not built |
| CRM data sync, subscription tiers, billing | ❌ Not built |
| AI intent prediction | ❌ Not built |

## Try it

You need Docker.

```bash
docker compose up --build
```

Open these side by side:
- **The shop:** http://localhost:3000/store/. "Kopi Nusantara" is a fake coffee shop with the PEARL widget on it.
- **The Operator dashboard:** http://localhost:3000/dashboard/

Then:

1. **In the dashboard**, type an Operator name (for example "Rina").
2. **In the shop**, choose **Ani Wijaya** from *Logged in as*. PEARL now knows who she is and what she has bought (Gayo coffee and a V60 dripper).
3. **Open the Gooseneck Kettle** and move the mouse. After about 8 seconds the chat opens by itself: *"Hi Ani! 👋 Eyeing the Gooseneck Kettle?…"* It attaches a suggested product, paper filters rather than another dripper, since she already owns one.
4. **Ask** "berapa harganya?" (how much is it?). The AI Agent answers with the price.
5. **Ask** "where is my order?". The AI Agent can't answer that, so it hands off, and the dashboard shows **Handoff · waiting**.
6. **In the dashboard**, open the chat, click **Take**, and reply. Use **Send** on a suggestion to put a product card in front of her.

Stop it with `docker compose down`.

### The AI Agent: scripted or Claude

By default the AI Agent gives **scripted**, keyword-based replies, so the demo works offline with no API key. For real conversational replies from Claude:

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

The default model is `claude-opus-5-5`; set `PEARL_MODEL` to use a different one. Claude decides what to reply, whether to hand off, and which suggested product to attach. If a call fails, that reply falls back to the scripted one. http://localhost:3000/healthz shows which mode is running.

## How it fits together

```
 Merchant's site (demo store)                 Operator dashboard
 └─ <script src="/widget.js">                       │
        │  WebSocket /ws/visitor                    │  WebSocket /ws/operator
        ▼                                           ▼
 ┌──────────────────────── PEARL app (Node + TypeScript) ────────────────────────┐
 │  Conversations & handoff · AI Agent (Claude or scripted) · Cross-sell · Bot check │
 └───────────┬──────────────────────────────────────────────┬─────────────────────┘
             ▼                                              ▼
        PostgreSQL                                        Redis
  shop catalog, customers, orders,              pub/sub, so any app instance can
  conversations, messages                       reach any connected browser
```

A shop installs PEARL with one script tag and three calls:

```js
PEARL.identify("cust-ani");  // this visitor is our logged-in customer "cust-ani"
PEARL.viewing(6);            // they're on product 6 (starts the proactive timer)
PEARL.reset();               // they logged out; treat them as a new visitor
```

## Vocabulary

The code and docs use a fixed set of terms: **Merchant**, **Visitor**, **Customer**, **Operator**, **AI Agent**, **Conversation**, **Handoff**, **Proactive Trigger**, **Cross-sell Suggestion**, **Automated traffic**. They're defined in [`GLOSSARY.md`](./GLOSSARY.md). For example, "customer" always means the shopper, never the business paying for PEARL.

## Shortcuts taken (fine for a POC, not for production)

- **Identity isn't verified.** Any page can claim to be any customer. A real version would need a token signed by the shop.
- **One hard-coded demo shop, and the dashboard has no login.**
- **Cross-sell uses simple category rules** (coffee goes with brewing gear, and so on), not machine learning.
- **Bot detection is basic:** browser signals plus the user-agent string.
- **Browser code is plain JavaScript with no build step.** Only the server is TypeScript.

## Repo layout

```
compose.yaml              postgres + redis + app
server/src/
  index.ts                web server, pages, WebSocket protocol
  conversations.ts        visitors, identify, conversations, handoff, messages
  aiAgent.ts              proactive offers and AI Agent replies (Claude or scripted)
  crossSell.ts            cross-sell suggestion rules
  automatedTraffic.ts     bot check
  bus.ts                  Redis pub/sub between app instances
server/sql/               database schema + demo data (1 shop, 10 products, 2 customers)
server/public/            widget.js, demo store, Operator dashboard
GLOSSARY.md               domain vocabulary
Komlay.pdf                the pitch deck
```
