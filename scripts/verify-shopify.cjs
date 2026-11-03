const fs=require('fs'),ts=require('typescript'),assert=require('assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {normalizeShopifyOrder}=require('../lib/shopify-orders.ts');
const {shopifyConfig,shopifyGraphql}=require('../lib/shopify-client.ts');
const order={id:'gid://shopify/Order/1',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z',test:false,
 totalReceivedSet:{shopMoney:{amount:'100.05',currencyCode:'USD'}},totalRefundedSet:{shopMoney:{amount:'20.01',currencyCode:'USD'}},
 customerJourneySummary:{ready:true,lastVisit:{utmParameters:{campaign:'meedoo_video',medium:'organic_social',source:'tiktok',content:'12345678-1234-1234-1234-123456789012'}}}};
const a=normalizeShopifyOrder(order);assert.equal(a.videoId,order.customerJourneySummary.lastVisit.utmParameters.content);assert.equal(a.revenue,'100.05');assert.equal(a.refunds,'20.01');
assert.equal(normalizeShopifyOrder({...order,customerJourneySummary:{...order.customerJourneySummary,ready:false}}).videoId,null);
assert.equal(normalizeShopifyOrder({...order,customerJourneySummary:{ready:true,lastVisit:{utmParameters:{...order.customerJourneySummary.lastVisit.utmParameters,campaign:'other'}}}}).videoId,null);
assert.throws(()=>normalizeShopifyOrder({...order,totalRefundedSet:{shopMoney:{amount:'20',currencyCode:'EUR'}}}));
process.env.SHOPIFY_SHOP_DOMAIN='https://evil.example/path';assert.throws(shopifyConfig);
process.env.SHOPIFY_SHOP_DOMAIN='example.myshopify.com';process.env.SHOPIFY_ADMIN_ACCESS_TOKEN='test-only';
global.fetch=async()=>({ok:true,status:200,json:async()=>({errors:[{message:'sensitive upstream body'}],data:{orders:[]}})});
(async()=>{await assert.rejects(()=>shopifyGraphql('query{}'),e=>!e.message.includes('sensitive')&&e.message.includes('QUERY_FAILED'));
global.fetch=async()=>({ok:true,status:200,json:async()=>({data:{shop:{id:'1'}}})});assert.deepEqual(await shopifyGraphql('query{}'),{shop:{id:'1'}});
console.log('PASS exact decimal preservation, strict UTM attribution, delayed journeys, mixed currency rejection, host validation, partial GraphQL errors and redaction');})().catch(e=>{console.error(e);process.exit(1)});
