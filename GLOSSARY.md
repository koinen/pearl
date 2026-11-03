# PEARL

PEARL is a chat widget that Merchants install on their sites. It turns support conversations into sales through AI-assisted replies, proactive chat triggers, cross-selling and remarketing.

## Language

### People

**Merchant**:
A business that subscribes to PEARL and installs its chat widget on its own site.
_Avoid_: pelanggan, perusahaan, client, tenant, user, customer

**Visitor**:
Anyone browsing a Merchant's site whom the Merchant has not identified.
_Avoid_: pengunjung, user, guest

**Customer**:
A Visitor whom the Merchant has identified, with a known identity and purchase history at that Merchant.
_Avoid_: pelanggan, pembeli, buyer, shopper, user

**Identify**:
When a Merchant's site tells PEARL which of its own customers the current Visitor is, turning that Visitor into a Customer. Only the Merchant's site can do this; PEARL never asks for it in chat.
_Avoid_: login, sign-in, capture

### Responders

**Operator**:
A human seat belonging to a Merchant that answers chats. Operators are billed per seat.
_Avoid_: agen support, agent, CS, staff, bot

**AI Agent**:
PEARL's automated responder, which answers chats on a Merchant's behalf.
_Avoid_: agen AI, bot, chatbot

### Conversations

**Conversation**:
A single thread between one Visitor or Customer and one Merchant, with exactly one current responder: the AI Agent or one Operator. It stays open across visits until an Operator closes it or it goes idle.
_Avoid_: chat, obrolan, interaksi, session, ticket

**Handoff**:
The one-way moment when the AI Agent passes a Conversation to an Operator. The AI Agent never takes it back.
_Avoid_: escalation, eskalasi, transfer

**Proactive Trigger**:
A Conversation the AI Agent opens on its own, offering a product to a Visitor who is showing interest in it. It only fires for human Visitors, never for Automated traffic.
_Avoid_: auto-chat, pemicu, popup, greeting

**Cross-sell Suggestion**:
A product related to what the Visitor is viewing or the Customer has bought before, which the current responder can send into the Conversation as a product card.
_Avoid_: recommendation, rekomendasi, upsell

### Traffic

**Automated traffic**:
Non-human visits to a Merchant's site. Proactive triggers must ignore them.
_Avoid_: bot, crawler
