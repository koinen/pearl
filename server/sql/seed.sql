-- One demo Merchant with a small catalog and two Customers who have past orders.
INSERT INTO merchants (id, name) VALUES ('demo', 'Kopi Nusantara');

INSERT INTO products (id, merchant_id, name, category, price, emoji, description) VALUES
  (1,  'demo', 'Kopi Arabika Gayo 250g',    'coffee',  95000,  '☕', 'Single-origin Aceh Gayo beans, medium roast, notes of chocolate and citrus.'),
  (2,  'demo', 'Kopi Toraja 250g',          'coffee',  105000, '☕', 'Sulawesi Toraja beans, medium-dark roast, earthy and full-bodied.'),
  (3,  'demo', 'Kopi Kintamani 250g',       'coffee',  98000,  '☕', 'Bali Kintamani beans, light roast, fruity and bright.'),
  (4,  'demo', 'V60 Dripper',               'brewing', 180000, '🔻', 'Ceramic pour-over dripper, size 02, for 1-4 cups.'),
  (5,  'demo', 'V60 Paper Filter (100 pcs)', 'brewing', 45000,  '📄', 'Bleached paper filters, size 02, fits the V60 Dripper.'),
  (6,  'demo', 'Gooseneck Kettle 600ml',    'brewing', 420000, '🫖', 'Stainless gooseneck kettle for a precise pour-over.'),
  (7,  'demo', 'Manual Grinder',            'brewing', 350000, '⚙️', 'Hand grinder with adjustable ceramic burrs.'),
  (8,  'demo', 'Cold Brew Bottle 1L',       'brewing', 210000, '🧊', 'Glass bottle with a fine mesh filter for overnight cold brew.'),
  (9,  'demo', 'Tumbler Stainless 500ml',   'merch',   150000, '🥤', 'Double-wall tumbler that keeps coffee hot for 6 hours.'),
  (10, 'demo', 'Gula Aren Cair 250ml',      'pantry',  40000,  '🍯', 'Liquid palm sugar for es kopi susu.');

SELECT setval('products_id_seq', (SELECT MAX(id) FROM products));

INSERT INTO customers (id, merchant_id, external_id, name) VALUES
  (1, 'demo', 'cust-ani',  'Ani Wijaya'),
  (2, 'demo', 'cust-budi', 'Budi Santoso');

SELECT setval('customers_id_seq', (SELECT MAX(id) FROM customers));

INSERT INTO orders (customer_id, product_id, ordered_at) VALUES
  (1, 1, now() - interval '40 days'),
  (1, 4, now() - interval '40 days'),
  (2, 9, now() - interval '90 days'),
  (2, 10, now() - interval '90 days');
