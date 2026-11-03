import { pool } from "./db";
import { publish } from "./bus";
import { crossSellSuggestions, Product, toProduct } from "./crossSell";

/** A Conversation goes idle and closes after this long without activity. */
const IDLE_MS = 24 * 60 * 60 * 1000;

export type Sender = "visitor" | "ai_agent" | "operator" | "system";

export interface Message {
  id: number;
  conversationId: number;
  sender: Sender;
  senderName: string | null;
  body: string;
  product: Product | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: number;
  merchantId: string;
  visitorId: string;
  customerName: string | null;
  status: "open" | "closed";
  responder: "ai_agent" | "operator";
  operatorName: string | null;
  handedOffAt: string | null;
  lastActivityAt: string;
  lastMessage: string | null;
}

export class DomainError extends Error {}

// ---------- Visitors ----------

export async function ensureVisitor(visitorId: string, merchantId: string): Promise<void> {
  await pool.query(
    `INSERT INTO visitors (id, merchant_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [visitorId, merchantId],
  );
}

/**
 * Identify: the Merchant's site says which of its customers this Visitor is.
 * An unknown id leaves the Visitor unidentified. Returns the Customer's name, or null.
 */
export async function identify(visitorId: string, externalId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE visitors v SET customer_id = c.id
       FROM customers c
      WHERE v.id = $1 AND c.merchant_id = v.merchant_id AND c.external_id = $2
      RETURNING c.name`,
    [visitorId, externalId],
  );
  const name: string | null = rows[0]?.name ?? null;
  const conversation = await findOpenConversation(visitorId);
  if (conversation) await broadcastConversation(conversation.id);
  return name;
}

export async function setViewing(visitorId: string, productId: number | null): Promise<void> {
  await pool.query(
    `UPDATE visitors v SET viewing_product_id = p.id
       FROM (SELECT $2::int AS want) w
       LEFT JOIN products p ON p.id = w.want
      WHERE v.id = $1 AND (p.id IS NULL OR p.merchant_id = v.merchant_id)`,
    [visitorId, productId],
  );
}

export async function customerNameFor(visitorId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT c.name FROM visitors v JOIN customers c ON c.id = v.customer_id WHERE v.id = $1`,
    [visitorId],
  );
  return rows[0]?.name ?? null;
}

// ---------- Conversations ----------

const SUMMARY_SQL = `
  SELECT cv.*, cu.name AS customer_name,
         (SELECT m.body FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.id DESC LIMIT 1) AS last_message
    FROM conversations cv
    JOIN visitors v ON v.id = cv.visitor_id
    LEFT JOIN customers cu ON cu.id = v.customer_id`;

function toSummary(row: any): ConversationSummary {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    visitorId: row.visitor_id,
    customerName: row.customer_name ?? null,
    status: row.status,
    responder: row.responder,
    operatorName: row.operator_name ?? null,
    handedOffAt: row.handed_off_at ? new Date(row.handed_off_at).toISOString() : null,
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
    lastMessage: row.last_message ?? null,
  };
}

export async function getConversation(conversationId: number): Promise<ConversationSummary> {
  const { rows } = await pool.query(`${SUMMARY_SQL} WHERE cv.id = $1`, [conversationId]);
  if (!rows[0]) throw new DomainError(`Conversation ${conversationId} not found`);
  return toSummary(rows[0]);
}

export async function listConversations(merchantId: string): Promise<ConversationSummary[]> {
  const { rows } = await pool.query(
    `${SUMMARY_SQL} WHERE cv.merchant_id = $1 ORDER BY (cv.status = 'open') DESC, cv.last_activity_at DESC LIMIT 50`,
    [merchantId],
  );
  return rows.map(toSummary);
}

/** The Visitor's open Conversation, closing it first if it has gone idle. */
export async function findOpenConversation(visitorId: string): Promise<ConversationSummary | null> {
  const { rows } = await pool.query(`${SUMMARY_SQL} WHERE cv.visitor_id = $1 AND cv.status = 'open'`, [visitorId]);
  if (!rows[0]) return null;
  const conversation = toSummary(rows[0]);
  if (Date.now() - new Date(conversation.lastActivityAt).getTime() > IDLE_MS) {
    await closeConversation(conversation.id);
    return null;
  }
  return conversation;
}

export async function openConversation(visitorId: string): Promise<ConversationSummary> {
  const existing = await findOpenConversation(visitorId);
  if (existing) return existing;
  const { rows } = await pool.query(
    `INSERT INTO conversations (merchant_id, visitor_id)
       SELECT merchant_id, id FROM visitors WHERE id = $1
     ON CONFLICT (visitor_id) WHERE status = 'open' DO NOTHING
     RETURNING id`,
    [visitorId],
  );
  if (rows[0]) await broadcastConversation(rows[0].id);
  const conversation = await findOpenConversation(visitorId);
  if (!conversation) throw new DomainError("Could not open a Conversation");
  return conversation;
}

/** Handoff: the AI Agent passes the Conversation to an Operator. One-way. */
export async function handoff(conversationId: number, reason: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE conversations SET responder = 'operator', handed_off_at = now()
      WHERE id = $1 AND responder = 'ai_agent' AND status = 'open'`,
    [conversationId],
  );
  if (!rowCount) return;
  await addMessage(conversationId, "system", `Handoff: ${reason} An Operator will reply shortly.`);
  await broadcastConversation(conversationId);
}

/** An Operator takes a Conversation. Taking one the AI Agent still holds performs the Handoff. */
export async function take(conversationId: number, operatorName: string): Promise<void> {
  const conversation = await getConversation(conversationId);
  if (conversation.status !== "open") throw new DomainError("Conversation is closed");
  if (conversation.operatorName && conversation.operatorName !== operatorName) {
    throw new DomainError(`Already taken by ${conversation.operatorName}`);
  }
  if (conversation.responder === "ai_agent") await handoff(conversationId, "an Operator took over.");
  await pool.query(`UPDATE conversations SET operator_name = $2 WHERE id = $1`, [conversationId, operatorName]);
  await addMessage(conversationId, "system", `${operatorName} joined the chat.`);
  await broadcastConversation(conversationId);
}

export async function closeConversation(conversationId: number): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE conversations SET status = 'closed' WHERE id = $1 AND status = 'open'`,
    [conversationId],
  );
  if (rowCount) await broadcastConversation(conversationId);
}

async function broadcastConversation(conversationId: number): Promise<void> {
  const conversation = await getConversation(conversationId);
  const payload = { type: "conversation", conversation };
  publish({ to: "operators", merchantId: conversation.merchantId, payload });
  publish({ to: "visitor", visitorId: conversation.visitorId, payload });
}

// ---------- Messages ----------

const MESSAGE_SQL = `
  SELECT m.*, cv.operator_name, p.id AS p_id, p.name AS p_name, p.category AS p_category, p.price AS p_price,
         p.emoji AS p_emoji, p.description AS p_description
    FROM messages m
    JOIN conversations cv ON cv.id = m.conversation_id
    LEFT JOIN products p ON p.id = m.product_id`;

function toMessage(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender,
    senderName: row.sender === "operator" ? row.operator_name : row.sender === "ai_agent" ? "AI Agent" : null,
    body: row.body,
    product: row.p_id
      ? toProduct({
          id: row.p_id,
          name: row.p_name,
          category: row.p_category,
          price: row.p_price,
          emoji: row.p_emoji,
          description: row.p_description,
        })
      : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listMessages(conversationId: number): Promise<Message[]> {
  const { rows } = await pool.query(`${MESSAGE_SQL} WHERE m.conversation_id = $1 ORDER BY m.id`, [conversationId]);
  return rows.map(toMessage);
}

export async function addMessage(
  conversationId: number,
  sender: Sender,
  body: string,
  productId: number | null = null,
): Promise<Message> {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, sender, body, product_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [conversationId, sender, body, productId],
  );
  await pool.query(`UPDATE conversations SET last_activity_at = now() WHERE id = $1`, [conversationId]);
  const { rows: full } = await pool.query(`${MESSAGE_SQL} WHERE m.id = $1`, [rows[0].id]);
  const message = toMessage(full[0]);
  const conversation = await getConversation(conversationId);
  const payload = { type: "message", message };
  publish({ to: "visitor", visitorId: conversation.visitorId, payload });
  publish({ to: "operators", merchantId: conversation.merchantId, payload });
  publish({ to: "operators", merchantId: conversation.merchantId, payload: { type: "conversation", conversation } });
  return message;
}

/** Sends a message as the Operator, who must be the Conversation's current responder. */
export async function operatorSend(
  conversationId: number,
  operatorName: string,
  body: string,
  productId: number | null,
): Promise<void> {
  const conversation = await getConversation(conversationId);
  if (conversation.status !== "open") throw new DomainError("Conversation is closed");
  if (conversation.responder !== "operator" || conversation.operatorName !== operatorName) {
    throw new DomainError("Take the Conversation before replying");
  }
  await addMessage(conversationId, "operator", body, productId);
}

// ---------- Context for whoever is responding ----------

export interface ConversationContext {
  merchantName: string;
  customerName: string | null;
  customerId: number | null;
  viewing: Product | null;
  pastOrders: { product: Product; orderedAt: string }[];
  suggestions: Product[];
}

export async function conversationContext(conversationId: number): Promise<ConversationContext> {
  const { rows } = await pool.query(
    `SELECT cv.merchant_id, mc.name AS merchant_name, v.customer_id, v.viewing_product_id, cu.name AS customer_name
       FROM conversations cv
       JOIN merchants mc ON mc.id = cv.merchant_id
       JOIN visitors v ON v.id = cv.visitor_id
       LEFT JOIN customers cu ON cu.id = v.customer_id
      WHERE cv.id = $1`,
    [conversationId],
  );
  const row = rows[0];
  if (!row) throw new DomainError(`Conversation ${conversationId} not found`);

  let viewing: Product | null = null;
  if (row.viewing_product_id) {
    const { rows: p } = await pool.query(`SELECT * FROM products WHERE id = $1`, [row.viewing_product_id]);
    viewing = p[0] ? toProduct(p[0]) : null;
  }

  let pastOrders: ConversationContext["pastOrders"] = [];
  if (row.customer_id) {
    const { rows: o } = await pool.query(
      `SELECT p.*, o.ordered_at FROM orders o JOIN products p ON p.id = o.product_id
        WHERE o.customer_id = $1 ORDER BY o.ordered_at DESC`,
      [row.customer_id],
    );
    pastOrders = o.map((r) => ({ product: toProduct(r), orderedAt: new Date(r.ordered_at).toISOString() }));
  }

  return {
    merchantName: row.merchant_name,
    customerName: row.customer_name ?? null,
    customerId: row.customer_id ?? null,
    viewing,
    pastOrders,
    suggestions: await crossSellSuggestions(row.merchant_id, row.viewing_product_id ?? null, row.customer_id ?? null),
  };
}
