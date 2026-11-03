import Anthropic from "@anthropic-ai/sdk";
import {
  addMessage,
  conversationContext,
  ConversationContext,
  getConversation,
  handoff,
  listMessages,
  Message,
  openConversation,
} from "./conversations";
import { Product } from "./crossSell";

/**
 * The AI Agent answers a Conversation until a Handoff. It uses Claude when ANTHROPIC_API_KEY is set
 * and falls back to scripted keyword replies otherwise (or when a Claude call fails).
 */

const MODEL = process.env.PEARL_MODEL || "claude-opus-5-5";
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export const aiAgentMode = client ? `claude (${MODEL})` : "scripted";

/** Don't re-open a Proactive Trigger on someone who chatted in the last 10 minutes. */
const PROACTIVE_COOLDOWN_MS = 10 * 60 * 1000;

const WANTS_HUMAN = /\b(human|manusia|operator|admin|orang|cs|real person|customer service|agent)\b/i;

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

interface Reply {
  body: string;
  productId: number | null;
  handoff: boolean;
}

// ---------- Proactive Trigger ----------

export async function proactiveOffer(visitorId: string, productId: number): Promise<void> {
  const conversation = await openConversation(visitorId);
  if (conversation.responder !== "ai_agent") return;
  const history = await listMessages(conversation.id);
  const recentVisitorMessage = history.some(
    (m) => m.sender === "visitor" && Date.now() - new Date(m.createdAt).getTime() < PROACTIVE_COOLDOWN_MS,
  );
  if (recentVisitorMessage) return;

  const context = await conversationContext(conversation.id);
  const viewing = context.viewing;
  if (!viewing || viewing.id !== productId) return;
  const offer = `Eyeing the ${viewing.name}?`;
  if (history.some((m) => m.sender === "ai_agent" && m.body.includes(offer))) return;
  const pairing = context.suggestions[0] ?? null;
  const greeting = context.customerName ? `Hi ${context.customerName.split(" ")[0]}! 👋` : "Hi there! 👋";
  const body =
    `${greeting} ${offer} It's ${rupiah(viewing.price)} and ships today.` +
    (pairing ? ` People who get it often add this too:` : ` Ask me anything about it.`);
  await addMessage(conversation.id, "ai_agent", body, pairing?.id ?? null);
}

// ---------- Replies ----------

export async function respond(conversationId: number, visitorText: string): Promise<void> {
  const conversation = await getConversation(conversationId);
  if (conversation.responder !== "ai_agent" || conversation.status !== "open") return;

  if (WANTS_HUMAN.test(visitorText)) {
    await handoff(conversationId, "the Visitor asked for a human.");
    return;
  }

  const [context, history] = await Promise.all([conversationContext(conversationId), listMessages(conversationId)]);

  let reply: Reply | null = null;
  if (client) {
    try {
      reply = await claudeReply(context, history);
    } catch (err) {
      console.error("Claude call failed; using scripted reply", err);
    }
  }
  reply ??= scriptedReply(context, visitorText);

  // The AI Agent includes one Cross-sell Suggestion in a Conversation if none has been sent yet.
  const cardAlreadySent = history.some((m) => m.product !== null);
  if (!reply.handoff && reply.productId === null && !cardAlreadySent && context.suggestions[0]) {
    reply.productId = context.suggestions[0].id;
  }

  await addMessage(conversationId, "ai_agent", reply.body, reply.productId);
  if (reply.handoff) await handoff(conversationId, "the AI Agent couldn't answer that.");
}

function findMentionedProduct(text: string, catalog: Product[]): Product | null {
  const lower = text.toLowerCase();
  return (
    catalog.find((p) =>
      p.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((word) => word.length > 3 && lower.includes(word)),
    ) ?? null
  );
}

function scriptedReply(context: ConversationContext, text: string): Reply {
  const catalog = [...(context.viewing ? [context.viewing] : []), ...context.suggestions, ...context.pastOrders.map((o) => o.product)];
  const product = findMentionedProduct(text, catalog) ?? context.viewing;

  if (/\b(hi|hai|halo|hello|hey|pagi|siang|sore|malam)\b/i.test(text)) {
    return { body: "Halo! Ask me about any product, its price, or shipping.", productId: null, handoff: false };
  }
  if (/harga|price|berapa|how much|cost/i.test(text)) {
    if (product) {
      return { body: `The ${product.name} is ${rupiah(product.price)}. ${product.description}`, productId: null, handoff: false };
    }
    return { body: "Which product are you asking about? Open it and I'll tell you the price.", productId: null, handoff: false };
  }
  if (/kirim|ongkir|shipping|deliver|ship|sampai/i.test(text)) {
    return {
      body: "We ship anywhere in Indonesia. Orders placed before 15:00 WIB ship the same day.",
      productId: null,
      handoff: false,
    };
  }
  if (/rekomendasi|recommend|suggest|cocok|pair|bagus/i.test(text) && context.suggestions[0]) {
    return { body: `I'd suggest this one:`, productId: context.suggestions[0].id, handoff: false };
  }
  if (product && /(what|apa|tell|info|detail|about)/i.test(text)) {
    return { body: `${product.name}: ${product.description} (${rupiah(product.price)})`, productId: null, handoff: false };
  }
  return { body: "I'm not sure about that one, so I'm bringing in an Operator.", productId: null, handoff: true };
}

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "The message to show the shopper." },
    handoff: { type: "boolean", description: "True when an Operator must take over." },
    suggestProductId: {
      type: "integer",
      description: "Id of one product from SUGGESTIONS to attach as a product card, or 0 for none.",
    },
  },
  required: ["reply", "handoff", "suggestProductId"],
  additionalProperties: false,
};

function describeProduct(p: Product): string {
  return `#${p.id} ${p.name} (${p.category}, ${rupiah(p.price)}): ${p.description}`;
}

async function claudeReply(context: ConversationContext, history: Message[]): Promise<Reply> {
  const system = [
    `You are the AI Agent for ${context.merchantName}, an online coffee shop, chatting with a shopper on its website.`,
    `Reply in 1-3 short sentences, in the shopper's language (Indonesian or English).`,
    `Only state facts found below. Shipping: anywhere in Indonesia; orders before 15:00 WIB ship the same day.`,
    `If you can't answer from these facts (order status, refunds, complaints, stock dates, anything else), set handoff to true and say an Operator will take over.`,
    `If one product from SUGGESTIONS fits the conversation naturally, set suggestProductId to its id; otherwise 0.`,
    ``,
    `SHOPPER: ${context.customerName ? `${context.customerName} (known customer)` : "anonymous visitor"}`,
    `VIEWING: ${context.viewing ? describeProduct(context.viewing) : "nothing in particular"}`,
    `PAST ORDERS: ${context.pastOrders.length ? context.pastOrders.map((o) => describeProduct(o.product)).join("; ") : "none"}`,
    `SUGGESTIONS:\n${context.suggestions.map(describeProduct).join("\n") || "none"}`,
  ].join("\n");

  const transcript = history
    .filter((m) => m.sender === "visitor" || m.sender === "ai_agent")
    .slice(-20)
    .map((m) => `${m.sender === "visitor" ? "Shopper" : "AI Agent"}: ${m.body}${m.product ? ` [card: #${m.product.id}]` : ""}`)
    .join("\n");

  const response = await client!.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    // Server-side fallback: if Claude's safety classifiers decline, the API re-runs on a recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: REPLY_SCHEMA } },
    system,
    messages: [{ role: "user", content: `Conversation so far:\n${transcript}\n\nWrite the AI Agent's next reply.` }],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined the request");
  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  const parsed = JSON.parse(text) as { reply: string; handoff: boolean; suggestProductId: number };
  const suggestionIds = new Set(context.suggestions.map((p) => p.id));
  return {
    body: parsed.reply,
    handoff: parsed.handoff,
    productId: suggestionIds.has(parsed.suggestProductId) ? parsed.suggestProductId : null,
  };
}
