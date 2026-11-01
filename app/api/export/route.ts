import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 15;

type Product = { name?: string; image?: string; price?: string | number; description?: string; category?: string };
type Category = { title?: string; image?: string; items?: string[] };
function urlCell(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? { text: value, hyperlink: value } : value;
  } catch { return value; }
}
function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.height = 28;
  row.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17664D" } };
  row.alignment = { vertical: "middle", horizontal: "right" };
  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: { row: 1, column: sheet.columnCount } };
}
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    if (!Array.isArray(data?.products) || !Array.isArray(data?.categories)) {
      return NextResponse.json({ error: "ساختار محصولات و دسته‌بندی‌ها معتبر نیست." }, { status: 400 });
    }
    if (data.products.length > 5000 || data.categories.length > 500) {
      return NextResponse.json({ error: "تعداد ردیف‌ها بیش از حد مجاز است." }, { status: 413 });
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Dodol";
    workbook.created = new Date();

    const products = workbook.addWorksheet("محصولات");
    products.columns = [
      { header: "عنوان محصول", key: "name", width: 32 },
      { header: "عکس محصول (لینک)", key: "image", width: 54 },
      { header: "قیمت", key: "price", width: 18 },
      { header: "توضیحات", key: "description", width: 60 },
      { header: "منو / دسته‌بندی", key: "category", width: 28 },
    ];
    for (const product of data.products as Product[]) {
      products.addRow({
        name: product.name || "",
        image: urlCell(product.image),
        price: product.price ?? "",
        description: product.description || "",
        category: product.category || "",
      });
    }
    styleHeader(products);
    products.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = { vertical: "top", horizontal: "right", wrapText: true };
        if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8F6" } };
      }
    });

    const categories = workbook.addWorksheet("دسته‌بندی‌ها");
    categories.columns = [
      { header: "عنوان دسته‌بندی", key: "title", width: 30 },
      { header: "عکس دسته‌بندی (لینک)", key: "image", width: 54 },
      { header: "محصولات دسته", key: "items", width: 70 },
    ];
    for (const category of data.categories as Category[]) {
      categories.addRow({
        title: category.title || "",
        image: urlCell(category.image),
        items: (category.items || []).join("، "),
      });
    }
    styleHeader(categories);
    categories.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.alignment = { vertical: "top", horizontal: "right", wrapText: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename*=UTF-8''cafe-menu.xlsx",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "ساخت فایل Excel ناموفق بود." }, { status: 500 });
  }
}
