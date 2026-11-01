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
      if (name) output.push({ name, englishName: "", description: clean(node.description), price: clean(offer?.price || offer?.priceSpecification?.price), image: absoluteUrl(typeof image === "string" ? image : image?.url, base), category: clean(node.category || category) || "بدون دسته" });
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
    '[itemtype*="Product"]', '[itemtype*="MenuItem"]', '.product-card', '.menu-item-card',
    '.food-item', '.menu-product', '.elementor-widget-wrap .product', '[class*="menu-item"]',
    '[class*="product-item"]', '[class*="food-item"]',
  ].join(",");
  const products: Product[] = [];
  const seen = new Set<string>();
  $(selectors).each((_, el) => {
    const node = $(el);
    if (node.parents(selectors).length > 0) return;
    const name = clean(node.find('[itemprop="name"], h2, h3, h4, .product-title, .menu-item-title, [class*="title"]').first().text() || node.attr("data-name"));
    if (!name || name.length > 120) return;
    const imageNode = node.find('img').first();
    const image = absoluteUrl(imageNode.attr("data-src") || imageNode.attr("data-lazy-src") || imageNode.attr("src") || imageNode.attr("srcset")?.split(",")[0]?.trim().split(" ")[0], base);
    const description = clean(node.find('[itemprop="description"], .description, [class*="description"], p').first().text());
    const price = clean(node.find('[itemprop="price"], .price, [class*="price"]').first().text() || node.attr("data-price"));
    const category = clean(node.closest("section").find("h2,h3").first().text() || node.closest('[class*="category"], [class*="section"]').find("h2,h3,h4").first().text()) || "بدون دسته";
    const key = name.toLocaleLowerCase("fa");
    if (!seen.has(key)) { seen.add(key); products.push({ name, englishName: "", description, price: price.replace(/[^\d.,۰-۹]/g, ""), image, category }); }
  });
  return products;
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
    if (/منو|menu/i.test(title) || products.some((p) => p.category === title)) map.set(title, { title, image, items: [] });
  });
  return [...map.values()];
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = typeof body?.url === "string" ? body.url.trim() : "";
    let parsed: URL;
    try { parsed = new URL(input); } catch { return NextResponse.json({ error: "لینک معتبر وارد کنید." }, { status: 400 }); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      return NextResponse.json({ error: "فقط لینک عمومی HTTP یا HTTPS مجاز است." }, { status: 400 });
    }
    const response = await fetch(parsed.href, { headers: { "User-Agent": "DodolMenuImporter/1.0 (+https://github.com/ariankrb123/dodol)", Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(18000), redirect: "follow" });
    if (!response.ok) return NextResponse.json({ error: `صفحه با وضعیت ${response.status} دریافت نشد.` }, { status: 422 });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return NextResponse.json({ error: "آدرس واردشده صفحه HTML نیست." }, { status: 422 });
    const html = await response.text();
    if (html.length > 6_000_000) return NextResponse.json({ error: "حجم صفحه بیش از ۶ مگابایت است." }, { status: 413 });
    const $ = cheerio.load(html);
    const products = jsonLdProducts($, response.url);
    const fromPage = pageProducts($, response.url);
    const keys = new Set(products.map((p) => p.name.toLocaleLowerCase("fa")));
    for (const p of fromPage) if (!keys.has(p.name.toLocaleLowerCase("fa"))) products.push(p);
    const categories = categoriesFrom($, products, response.url);
    return NextResponse.json({ source: response.url, products, categories, stats: { products: products.length, categories: categories.length } });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "زمان دریافت صفحه تمام شد." : "خواندن صفحه ناموفق بود. لینک عمومی و دسترسی سایت را بررسی کنید.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
