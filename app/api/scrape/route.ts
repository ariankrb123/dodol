import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const maxDuration = 25;

type Product = { name: string; englishName: string; description: string; price: string; image: string; category: string };
type Category = { title: string; image: string; items: string[] };

function absoluteUrl(value: string | undefined, base: string) {
  if (!value) return "";
  try { return new URL(value, base).href; } catch { return ""; }
}
function clean(value: string | undefined) { return (value || "").replace(/\s+/g, " ").trim(); }
function unsafeIp(address: string) {
  if (isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0);
  }
  const ip = address.toLowerCase();
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
    /^fe[89ab]/.test(ip) || ip.startsWith("ff") || ip.startsWith("::ffff:") || ip.startsWith("2001:db8:");
}
async function publicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (isIP(host)) return !unsafeIp(host);
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => !unsafeIp(address));
  } catch { return false; }
}
const REQUEST_BUDGET_MS = 22000;
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function fetchPublicPage(initial: string, deadline: number) {
  let current = initial;
  for (let hop = 0; hop <= 4; hop++) {
    if (!(await publicUrl(current))) throw new Error("PRIVATE_URL");
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("FETCH_TIMEOUT");
      try {
        response = await fetch(current, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; DodolMenuImporter/1.0; +https://github.com/ariankrb123/dodol)", Accept: "text/html,application/xhtml+xml" },
          signal: AbortSignal.timeout(Math.min(8000, remaining)), redirect: "manual",
        });
      } catch (error) {
        if (attempt === 2 || Date.now() + 700 >= deadline) throw error;
        await wait(500 * (attempt + 1));
        continue;
      }
      if (![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await response.body?.cancel();
      await wait(500 * (attempt + 1));
    }
    if (!response) throw new Error("FETCH_TIMEOUT");
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === 4) throw new Error("TOO_MANY_REDIRECTS");
      current = new URL(location, current).href;
      continue;
    }
    return response;
  }
  throw new Error("TOO_MANY_REDIRECTS");
}
function jsonLdProducts($: cheerio.CheerioAPI, base: string): Product[] {
  const output: Product[] = [];
  const walk = (node: any, category = "") => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach((x) => walk(x, category)); return; }
    if (typeof node !== "object") return;
    if (node["@graph"]) walk(node["@graph"], category);
    const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : node["@type"];
    if (typeof type === "string" && /Product|MenuItem/i.test(type)) {
      const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      const image = Array.isArray(node.image) ? node.image[0] : node.image;
      const name = clean(node.name);
      if (name) output.push({ name, englishName: clean(node.alternateName), description: clean(node.description), price: clean(offer?.price || offer?.priceSpecification?.price), image: absoluteUrl(typeof image === "string" ? image : image?.url, base), category: clean(node.category || category) || "بدون دسته" });
    }
    if (/MenuSection/i.test(String(type))) {
      const title = clean(node.name);
      walk(node.hasMenuItem || node.itemListElement, title);
    }
    if (/Menu/i.test(String(type))) walk(node.hasMenuSection, category);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try { walk(JSON.parse($(el).contents().text())); } catch { /* skip malformed metadata */ }
  });
  return output;
}
function pageProducts($: cheerio.CheerioAPI, base: string): Product[] {
  const selectors = [
    '[itemtype*="Product"]', '[itemtype*="MenuItem"]', '[data-product]',
    '.product-card', '.product-item', '.menu-item-card', '.food-item', '.food-menu-item',
    '.menu-product', '.elementor-widget-wrap .product',
  ].join(",");
  const products: Product[] = [];
  const seen = new Set<string>();
  $(selectors).each((_, el) => {
    const node = $(el);
    if (node.parents("nav, header, footer").length > 0 || node.parents(selectors).length > 0) return;
    const name = clean(node.find('[itemprop="name"], h2, h3, h4, .product-title, .menu-item-title, [class*="title"]').first().text() || node.attr("data-name"));
    if (!name || name.length > 120) return;
    const imageNode = node.find("img").first();
    const image = absoluteUrl(imageNode.attr("data-src") || imageNode.attr("data-lazy-src") || imageNode.attr("src") || imageNode.attr("srcset")?.split(",")[0]?.trim().split(" ")[0], base);
    const description = clean(node.find('[itemprop="description"], .description, [class*="description"], p').first().text());
    const price = clean(node.find('[itemprop="price"], .price, [class*="price"]').first().text() || node.attr("data-price"));
    if (!image && !description && !price && !node.attr("itemtype") && !node.attr("data-product")) return;
    const category = clean(node.closest("section").find("h2,h3").first().text() || node.closest('[class*="category"], [class*="section"]').find("h2,h3,h4").first().text()) || "بدون دسته";
    const key = name.toLocaleLowerCase("fa");
    if (!seen.has(key)) { seen.add(key); products.push({ name, englishName: clean(node.find('.english-name, [class*="english"], [lang="en"]').first().text()), description, price: price.replace(/[^\d.,۰-۹]/g, ""), image, category }); }
  });
  return products;
}
async function scrapeVoria($: cheerio.CheerioAPI, base: string, deadline: number): Promise<{ products: Product[]; categories: Category[] } | null> {
  const scripts = $("script").map((_, element) => $(element).html() || "").get().join("\n");
  if (!scripts.includes("VORIACAFE_CONFIG") && !base.includes("voriacafe.com")) return null;
  const match = scripts.match(/VORIACAFE_CONFIG\\s*=\\s*\\{[\\s\\S]*?AJAX_URL\\s*:\\s*['"]([^'"]+)['"]/);
  if (!match) return null;
  const endpoint = new URL(match[1], base);
  if (endpoint.origin !== new URL(base).origin) throw new Error("VORIA_CROSS_ORIGIN");
  endpoint.searchParams.set("action", "get_products");
  endpoint.searchParams.set("grouped", "true");
  if (!(await publicUrl(endpoint.href))) throw new Error("PRIVATE_URL");
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("FETCH_TIMEOUT");
  const response = await fetch(endpoint.href, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; DodolMenuImporter/1.0)", Accept: "application/json" },
    signal: AbortSignal.timeout(Math.min(8000, remaining)), redirect: "manual",
  });
  if (!response.ok) throw new Error(`VORIA_API_${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.products)) throw new Error("VORIA_INVALID_DATA");
  const products: Product[] = [];
  const categories: Category[] = [];
  for (const group of body.products) {
    const title = clean(group?.name);
    if (!title) continue;
    const groupProducts = Array.isArray(group.products) ? group.products : [];
    const items: string[] = [];
    for (const item of groupProducts) {
      const name = clean(item?.name);
      if (!name) continue;
      items.push(name);
      products.push({
        name, englishName: clean(item.english_name || item.alternateName),
        description: clean(item.description),
        price: clean(item.price ?? item.price_amount),
        image: absoluteUrl(item.main_image || item.image || item.image_url, base),
        category: title,
      });
    }
    const categoryImage = group.image || group.image_url || group.icon || groupProducts.find((item: any) => item.main_image || item.image)?.main_image || groupProducts.find((item: any) => item.image)?.image;
    categories.push({ title, image: absoluteUrl(categoryImage, base), items });
  }
  return { products, categories };
}
function categoriesFrom($: cheerio.CheerioAPI, products: Product[], base: string): Category[] {
  const map = new Map<string, Category>();
  for (const product of products) {
    const cat = map.get(product.category) || { title: product.category, image: "", items: [] };
    cat.items.push(product.name);
    if (!cat.image) cat.image = product.image;
    map.set(product.category, cat);
  }
  $("h1,h2,h3,h4").each((_, el) => {
    const title = clean($(el).text());
    if (!title || title.length > 80 || map.has(title)) return;
    const section = $(el).closest("section").length ? $(el).closest("section") : $(el).parent();
    const image = absoluteUrl(section.find("img").first().attr("src"), base);
    if (/منو|menu/i.test(title)) map.set(title, { title, image, items: [] });
  });
  return [...map.values()];
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = typeof body?.url === "string" ? body.url.trim() : "";
    let parsed: URL;
    try { parsed = new URL(input); } catch { return NextResponse.json({ error: "لینک معتبر وارد کنید." }, { status: 400 }); }
    if (!(await publicUrl(parsed.href))) return NextResponse.json({ error: "فقط لینک عمومی HTTP یا HTTPS مجاز است." }, { status: 400 });
    const deadline = Date.now() + REQUEST_BUDGET_MS;
    const response = await fetchPublicPage(parsed.href, deadline);
    if (!response.ok) {
      const hint = response.status === 504 ? "سایت مبدأ پاسخ ۵۰۴ داد؛ درخواست خودکار دوباره تلاش شد. کمی بعد دوباره امتحان کنید یا لینک مستقیم صفحه منو را بدهید." : `صفحه با وضعیت ${response.status} دریافت نشد.`;
      return NextResponse.json({ error: hint }, { status: 422 });
    }
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return NextResponse.json({ error: "آدرس واردشده صفحه HTML نیست." }, { status: 422 });
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 6_000_000) return NextResponse.json({ error: "حجم صفحه بیش از ۶ مگابایت است." }, { status: 413 });
    const html = await response.text();
    if (html.length > 6_000_000) return NextResponse.json({ error: "حجم صفحه بیش از ۶ مگابایت است." }, { status: 413 });
    const $ = cheerio.load(html);
    const specialized = await scrapeVoria($, response.url, deadline);
    const products = specialized?.products || jsonLdProducts($, response.url);
    if (!specialized) {
      const fromPage = pageProducts($, response.url);
      const keys = new Set(products.map((p) => p.name.toLocaleLowerCase("fa")));
      for (const p of fromPage) if (!keys.has(p.name.toLocaleLowerCase("fa"))) products.push(p);
    }
    const categories = specialized?.categories || categoriesFrom($, products, response.url);
    return NextResponse.json({ source: response.url, products, categories, stats: { products: products.length, categories: categories.length } });
  } catch (error) {
    if (error instanceof Error && error.message === "PRIVATE_URL") return NextResponse.json({ error: "آدرس‌های شبکه داخلی مجاز نیستند." }, { status: 400 });
    if (error instanceof Error && /^VORIA_API_/.test(error.message)) {
      const status = Number(error.message.replace("VORIA_API_", ""));
      return NextResponse.json({ error: status === 504 ? "API منوی کافه پاسخ ۵۰۴ داد. کمی بعد دوباره امتحان کنید." : `دریافت داده از API منوی کافه ناموفق بود (HTTP ${status}).` }, { status: 502 });
    }
    const message = error instanceof Error && (error.name === "TimeoutError" || error.message === "FETCH_TIMEOUT") ? "زمان خواندن صفحه تمام شد؛ سایت منبع پاسخ نداد. لینک مستقیم صفحه منو را امتحان کنید." : "خواندن صفحه ناموفق بود. لینک عمومی و دسترسی سایت را بررسی کنید.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
