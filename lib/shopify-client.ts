// Server-only Shopify Admin API. Credentials never enter an API response.
export function shopifyConfig() {
  const shop = (process.env.SHOPIFY_SHOP_DOMAIN ?? "").trim().toLowerCase();
  if (!shop && !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && !process.env.SHOPIFY_CLIENT_SECRET) return null;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw Error("SHOPIFY_INVALID_SHOP_DOMAIN");
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!token && !(clientId && secret)) throw Error("SHOPIFY_CREDENTIALS_REQUIRED");
  return { shop, token, clientId, secret };
}

let cached: { shop: string; token: string; expires: number } | undefined;
async function accessToken(config: NonNullable<ReturnType<typeof shopifyConfig>>) {
  if (config.token) return config.token;
  if (cached?.shop === config.shop && cached.expires > Date.now() + 60_000) return cached.token;
  const response = await fetch(`https://${config.shop}/admin/oauth/access_token`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId!, client_secret: config.secret! }),
  });
  if (!response.ok) throw Error(`SHOPIFY_AUTH_HTTP_${response.status}`);
  const data = await response.json();
  if (typeof data.access_token !== "string" || !(Number(data.expires_in) > 60)) throw Error("SHOPIFY_INVALID_TOKEN_RESPONSE");
  cached = { shop: config.shop, token: data.access_token, expires: Date.now() + Number(data.expires_in) * 1000 };
  return cached.token;
}

export async function shopifyGraphql<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
  const config = shopifyConfig();
  if (!config) throw Error("SHOPIFY_NOT_CONFIGURED");
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`https://${config.shop}/admin/api/2026-10/graphql.json`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken(config) },
      body: JSON.stringify({ query: document, variables }),
    });
    if (response.status === 401 && !config.token && attempt === 0) { cached = undefined; continue; }
    if (response.status === 429 || response.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, Math.min(10_000, 1000 * 2 ** attempt))); continue;
    }
    if (!response.ok) throw Error(`SHOPIFY_HTTP_${response.status}`);
    const data = await response.json();
    if (data.errors?.length) {
      if (data.errors.every((e: {extensions?: {code?: string}}) => e.extensions?.code === "THROTTLED")) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1))); continue;
      }
      // Do not log upstream bodies: they can contain store/customer information.
      throw Error("SHOPIFY_QUERY_FAILED_CHECK_SCOPES_AND_SCHEMA");
    }
    if (!data.data) throw Error("SHOPIFY_EMPTY_RESPONSE");
    return data.data as T;
  }
  throw Error("SHOPIFY_RETRY_LIMIT");
}
