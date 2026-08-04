import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("uses standard Next.js commands for Vercel", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts.dev, "next dev");
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts.start, "next start");
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.doesNotMatch(name, /cloudflare|vinext|wrangler/i);
  }
});

test("contains no embedded Supabase credentials or ChatGPT Sites imports", async () => {
  const browser = await read("app/lib/supabase-browser.ts");
  const server = await read("app/lib/supabase-server.ts");
  assert.doesNotMatch(browser, /supabase\.co|sb_publishable_|service.role/i);
  assert.match(server, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(server, /SUPABASE_SECRET_KEY/);
});

test("documents every required environment variable", async () => {
  const env = await read(".env.example");
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL"]) assert.match(env, new RegExp(`^${key}=`, "m"));
  assert.doesNotMatch(env, /supabase\.co|sb_publishable_|eyJ/i);
});
