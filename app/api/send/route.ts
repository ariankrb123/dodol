import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 25;

function jsonEnv(name: string): Record<string, unknown> | null {
  const raw = process.env[name];
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    if (!Array.isArray(data?.products) || !Array.isArray(data?.categories) || data.products.length === 0) {
      return NextResponse.json({ error: "ابتدا یک منوی دارای محصول استخراج کنید." }, { status: 400 });
    }
    const tokenUrl = process.env.MENU_TOKEN_URL;
    const clientId = process.env.MENU_CLIENT_ID;
    const clientSecret = process.env.MENU_CLIENT_SECRET;
    const destination = process.env.MENU_API_URL || "https://menutam.ir/api/v1/public/menu";
    if (!tokenUrl || !clientId || !clientSecret) {
      return NextResponse.json({ error: "تنظیمات MENU_TOKEN_URL، MENU_CLIENT_ID و MENU_CLIENT_SECRET در Vercel کامل نیست." }, { status: 503 });
    }
    const tokenPayload = jsonEnv("MENU_TOKEN_BODY") || { client_id: clientId, client_secret: clientSecret };
    const tokenResponse = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(tokenPayload), cache: "no-store", signal: AbortSignal.timeout(10000) });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    const token = tokenData.access_token || tokenData.token || tokenData.data?.access_token || tokenData.data?.token;
    if (!tokenResponse.ok || typeof token !== "string") return NextResponse.json({ error: "دریافت توکن از سرویس مقصد ناموفق بود.", details: tokenData.message || tokenData.error || `HTTP ${tokenResponse.status}` }, { status: 502 });

    const payload = { categories: data.categories, products: data.products, source: data.source };
    const response = await fetch(destination, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const raw = await response.text();
    let result: any = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch { result = { message: raw.slice(0, 500) }; }
    if (!response.ok) return NextResponse.json({ error: "سرویس مقصد داده‌ها را نپذیرفت.", details: result.message || result.error || `HTTP ${response.status}` }, { status: 502 });
    if (result?.success === false || result?.status === "error") return NextResponse.json({ error: "سرویس مقصد خطا گزارش کرد.", details: result.message || result.error || "انتقال کامل نشد." }, { status: 502 });

    const expectedProducts = data.products.length;
    const expectedCategories = data.categories.length;
    const expectedTotal = expectedProducts + expectedCategories;
    const productCount = result?.data?.products_imported ?? result?.products_imported ?? result?.data?.counts?.products ?? result?.counts?.products;
    const categoryCount = result?.data?.categories_imported ?? result?.categories_imported ?? result?.data?.counts?.categories ?? result?.counts?.categories;
    const totalCount = result?.data?.imported_count ?? result?.imported_count ?? result?.data?.count;
    const verified = (productCount === expectedProducts && categoryCount === expectedCategories) || totalCount === expectedTotal;
    return NextResponse.json({
      ok: true, accepted: true, verified,
      message: verified ? "تعداد موارد ثبت‌شده با موارد ارسالی برابر است." : "پاسخ موفق دریافت شد، اما پاسخ API تعداد موارد ثبت‌شده را اعلام نکرد.",
      counts: { products: expectedProducts, categories: expectedCategories },
      reportedCounts: { products: productCount ?? null, categories: categoryCount ?? null, total: totalCount ?? null },
    });
  } catch {
    return NextResponse.json({ error: "ارتباط با سرویس توکن یا مقصد برقرار نشد. تنظیمات و دسترسی شبکه را بررسی کنید." }, { status: 502 });
  }
}
