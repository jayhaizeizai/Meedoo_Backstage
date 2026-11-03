import { supportedPlatforms } from "./social-platforms";

type Money = { shopMoney: { amount: string; currencyCode: string } };
type Utm = { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null };
export type ShopifyOrder = {
  id: string; createdAt: string; updatedAt: string; test: boolean;
  totalReceivedSet: Money; totalRefundedSet: Money;
  customerJourneySummary: { ready: boolean; lastVisit: { utmParameters: Utm | null } | null } | null;
};

export function normalizeShopifyOrder(order: ShopifyOrder) {
  const gross = order.totalReceivedSet.shopMoney, refund = order.totalRefundedSet.shopMoney;
  if (!/^\d+(\.\d+)?$/.test(gross.amount) || !/^\d+(\.\d+)?$/.test(refund.amount) || gross.currencyCode !== refund.currencyCode) throw Error("SHOPIFY_INVALID_MONEY");
  const utm = order.customerJourneySummary?.ready ? order.customerJourneySummary.lastVisit?.utmParameters : null;
  const platform = utm?.source?.toLowerCase();
  const attributed = utm?.campaign === "meedoo_video" && utm?.medium === "organic_social" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(utm.content ?? "") &&
    supportedPlatforms.some(p => p === platform);
  return {
    id: order.id, createdAt: order.createdAt, updatedAt: order.updatedAt, test: order.test,
    revenue: gross.amount, refunds: refund.amount, currency: gross.currencyCode,
    videoId: attributed ? utm!.content!.toLowerCase() : null,
    platform: attributed ? platform! : null,
  };
}

export const shopifyOrdersDocument = `query BackstageOrders($after: String, $query: String!) {
  orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt updatedAt test
      totalReceivedSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      customerJourneySummary { ready lastVisit { utmParameters { source medium campaign content } } }
    }
  }
}`;
