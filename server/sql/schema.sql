CREATE TABLE IF NOT EXISTS merchants (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       INTEGER NOT NULL,
  emoji       TEXT NOT NULL,
  description TEXT NOT NULL
);

-- A Customer is a Visitor the Merchant has identified; external_id is the Merchant's own id for them.
CREATE TABLE IF NOT EXISTS customers (
  id          SERIAL PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  external_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  UNIQUE (merchant_id, external_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  ordered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visitors (
  id                 UUID PRIMARY KEY,
  merchant_id        TEXT NOT NULL REFERENCES merchants(id),
  customer_id        INTEGER REFERENCES customers(id),
  viewing_product_id INTEGER REFERENCES products(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id               SERIAL PRIMARY KEY,
  merchant_id      TEXT NOT NULL REFERENCES merchants(id),
  visitor_id       UUID NOT NULL REFERENCES visitors(id),
  responder        TEXT NOT NULL DEFAULT 'ai_agent' CHECK (responder IN ('ai_agent', 'operator')),
  operator_name    TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  handed_off_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A Visitor has at most one open Conversation.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_conversation_per_visitor
  ON conversations (visitor_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender          TEXT NOT NULL CHECK (sender IN ('visitor', 'ai_agent', 'operator', 'system')),
  body            TEXT NOT NULL,
  product_id      INTEGER REFERENCES products(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
