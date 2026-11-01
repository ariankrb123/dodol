"use client";
import { FormEvent, useState } from "react";

type Product = { name: string; englishName: string; description: string; price: string; image: string; category: string };
type Category = { title: string; image: string; items: string[] };
type MenuData = { source: string; products: Product[]; categories: Category[]; stats: { products: number; categories: number }; truncated?: boolean };
export default function Home() {
  const [url, setUrl] = useState("");
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [error, setError] = useState("");

  async function scrape(event: FormEvent) {
    event.preventDefault(); setError(""); setExportError(""); setBusy(true); setMenu(null); setStep(1);
    try {
      const response = await fetch("/api/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "استخراج منو انجام نشد.");
      setMenu(result);
      if (!result.products?.length && !result.categories?.length) setError("محصول یا دسته‌ای از صفحه پیدا نشد. ممکن است منو با JavaScript بارگذاری شود یا ساختار سایت پشتیبانی نشود.");
      else setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : "استخراج منو انجام نشد."); }
    finally { setBusy(false); }
  }
  function saveBlob(blob: Blob, filename: string) {
    const anchor = document.createElement("a"); const objectUrl = URL.createObjectURL(blob);
    anchor.href = objectUrl; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  async function downloadExcel() {
    if (!menu) return;
    setExporting(true); setExportError(""); setStep(3);
    try {
      const response = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(menu) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "ساخت فایل Excel ناموفق بود."); }
      saveBlob(await response.blob(), "cafe-menu.xlsx");
    } catch (e) { setStep(2); setExportError(e instanceof Error ? e.message : "ساخت فایل Excel ناموفق بود."); }
    finally { setExporting(false); }
  }
  return <main className="shell">
    <header className="topbar"><div className="brand"><div className="logo">م</div><span>دودول<span style={{color:"#83928a",fontWeight:500}}> / استخراج منو</span></span></div><div className="status"><span className="dot"/> آماده استخراج</div></header>
    <section className="hero"><div><div className="eyebrow">استخراج و دریافت اکسل</div><h1>منوی کافه را یک‌جا بررسی کن</h1><p className="subtitle">لینک منو را وارد کن، محصولات و دسته‌بندی‌ها را بازبینی کن و فایل اکسل بگیر.</p></div>
      <div className="steps" aria-label="مراحل انجام کار">
        <div className={`step-item ${step >= 1 ? "active" : ""}`} aria-current={step === 1 ? "step" : undefined}><span className="step-marker">{step > 1 ? "✓" : "۱"}</span><span>لینک صفحه</span></div>
        <i className={step >= 2 ? "filled" : ""} />
        <div className={`step-item ${step >= 2 ? "active" : ""}`} aria-current={step === 2 ? "step" : undefined}><span className="step-marker">{step > 2 ? "✓" : "۲"}</span><span>بازبینی</span></div>
        <i className={step >= 3 ? "filled" : ""} />
        <div className={`step-item ${step >= 3 ? "active" : ""}`} aria-current={step === 3 ? "step" : undefined}><span className="step-marker">۳</span><span>خروجی اکسل</span></div>
      </div>
    </section>
    <section className="panel"><div className="section-head"><div className="section-title"><span className="num">۱</span>آدرس صفحه منوی کافه</div></div>
      <form onSubmit={scrape}><label className="label" htmlFor="url">لینک کامل صفحه</label><div className="row"><input id="url" type="url" dir="ltr" required value={url} onChange={(e)=>setUrl(e.target.value)} placeholder="https://example.com/menu"/><button className="primary" disabled={busy}>{busy ? "در حال خواندن…" : "استخراج منو"} <span aria-hidden>←</span></button></div><div className="hint">صفحه‌های منوی عمومی، از جمله ساختارهای رایج وردپرس و ووکامرس پشتیبانی می‌شوند.</div></form>
      {error && <div className="alert error" role="alert">{error}</div>}
    </section>
    {menu && <section className="panel"><div className="section-head"><div className="section-title"><span className="num">۲</span>بازبینی اطلاعات استخراج‌شده</div><span className="badge">آماده دریافت</span></div>
      <div className="counts"><span className="badge">{menu.products.length} محصول</span><span className="badge">{menu.categories.length} دسته‌بندی</span></div>
      {menu.truncated && <div className="alert info">به دلیل محدودیت صفحه‌بندی، فقط ۵۰۰ محصول اول دریافت شده‌اند.</div>}
      <div className="toolbar"><span className="label" style={{margin:0}}>محصولات</span><button type="button" className="primary" onClick={downloadExcel} disabled={exporting || (!menu.products.length && !menu.categories.length)}>{exporting ? "در حال ساخت…" : "دریافت فایل اکسل"}</button></div>
      <div className="table-wrap"><table><thead><tr><th>محصول</th><th>دسته‌بندی</th><th>قیمت</th><th>توضیحات</th></tr></thead><tbody>{menu.products.map((p,i)=><tr key={i}><td><div className="product">{p.image ? <img className="thumb" src={p.image} alt=""/> : <div className="thumb"/>}<div>{p.name}{p.englishName && <div className="sub">{p.englishName}</div>}</div></div></td><td><span className="cat">{p.category}</span></td><td>{p.price || "—"}</td><td><div className="sub">{p.description || "—"}</div></td></tr>)}</tbody></table></div>
      <div className="toolbar"><span className="label" style={{margin:0}}>دسته‌بندی‌ها</span></div>
      <div className="table-wrap"><table><thead><tr><th>عنوان دسته</th><th>تصویر دسته</th><th>آیتم‌های مربوط</th></tr></thead><tbody>{menu.categories.map((c,i)=><tr key={i}><td>{c.title}</td><td>{c.image ? <a href={c.image} target="_blank" rel="noreferrer">مشاهده تصویر ↗</a> : "—"}</td><td>{c.items.join("، ") || "—"}</td></tr>)}</tbody></table></div>
      <div className="footer"><div className="footer-note">منبع: <span dir="ltr">{menu.source}</span><br/>فایل اکسل شامل برگه محصولات و دسته‌بندی‌ها است.</div><button className="primary" onClick={downloadExcel} disabled={exporting || (!menu.products.length && !menu.categories.length)}>{exporting ? "در حال ساخت…" : "دریافت فایل اکسل"}</button></div>
      {exportError && <div className="alert error" role="alert">{exportError}</div>}
    </section>}
    <div style={{textAlign:"center",paddingTop:24,color:"#a2aaa5",fontSize:11}}>دودول · ابزار استخراج و خروجی اکسل منوی کافه</div>
  </main>;
}

