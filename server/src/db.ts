import fs from "fs";
import path from "path";
import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sqlDir = path.join(process.cwd(), "sql");

/** Creates the schema and seeds the demo Merchant on first boot. */
export async function initDb(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await pool.query(fs.readFileSync(path.join(sqlDir, "schema.sql"), "utf8"));
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM merchants");
  if (rows[0].n === 0) {
    await pool.query(fs.readFileSync(path.join(sqlDir, "seed.sql"), "utf8"));
    console.log("Seeded demo Merchant");
  }
}
