"use client";
import { FormEvent, useMemo, useState } from "react";

type Product = { name: string; englishName: string; description: string; price: string; image: string; category: string };
type Category = { title: string; image: string; items: string[] };
type MenuData = { source: string; products: Product[]; categories: Category[]; stats: { products: number; categories: number } };
export default function Home() {
  const [url, setUrl] = useState("");
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sendError, setSendError] = useState("");

  async function scrape(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice(""); setSendError(""); setBusy(true); setMenu(null);
    try {
      const response = await fetch("/api/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "استخراج منو انجام نشد.");
      if (!result.products?.length) { setMenu(result); setError("محصولی از این صفحه پیدا نشد. ممکن است منو با JavaScript بارگذاری شود یا ساختار سایت پشتیبانی نشود."); return; }
      setMenu(result);
    } catch (e) { setError(e instanceof Error ? e.message : "استخراج منو انجام نشد."); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!menu) return;
    setSending(true); setSendError(""); setNotice("");
    try {
      const response = await fetch("/api/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(menu) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.details ? `${result.error} — ${result.details}` : result.error || "ارسال ناموفق بود.");
      setNotice(`پذیرش انتقال تأیید شد؛ ${result.counts.products} محصول و ${result.counts.categories} دسته‌بندی ارسال شد.`);
    } catch (e) { setSendError(e instanceof Error ? e.message : "ارسال ناموفق بود."); }
    finally { setSending(false); }
  }
  const categoryCount = useMemo(() => menu?.categories.length || 0, [menu]);
  function download() {
    if (!menu) return;
    const blob = new Blob([JSON.stringify(menu, null, 2)], { type: "application/json;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob); anchor.download = "cafe-menu.json"; anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
  return <main className="shell">
    <header className="topbar">
      <div className="brand"><div className="logo">م</div><span>میز<span style={{color:"#83928a",fontWeight:500}}> / ابزار منو</span></span></div>
      <div className="status"><span className="dot" /> آماده استخراج</div>
    </header>
    <section className="hero">
      <div><div className="eyebrow">استخراج و انتقال منو</div><h1>منوی کافه را یک‌جا وارد کن</h1><p className="subtitle">لینک صفحه منو را بده؛ محصولات و دسته‌بندی‌ها را ببین، ذخیره کن و به منوتام بفرست.</p></div>
      <div className="steps"><b>۱. لینک صفحه</b><i/><span>۲. بررسی اطلاعات</span><i/><span>۳. انتقال</span></div>
    </section>
    <section className="panel">
      <div className="section-head"><div className="section-title"><span className="num">۱</span>آدرس صفحه منوی کافه</div></div>
      <form onSubmit={scrape}>
        <label className="label" htmlFor="url">لینک کامل صفحه</label>
        <div className="row"><input id="url" type="url" dir="ltr" required value={url} onChange={(e)=>setUrl(e.target.value)} placeholder="https://example.com/menu" /><button className="primary" disabled={busy}>{busy ? "در حال خواندن…" : "استخراج منو"} <span aria-hidden>←</span></button></div>
        <div className="hint">لینک باید عمومی باشد. تصویرها به صورت آدرس اصلی تصویر در داده‌ها ثبت می‌شوند.</div>
      </form>
      {error && <div className="alert error" role="alert">{error}</div>}
    </section>
    {menu && <section className="panel">
      <div className="section-head"><div className="section-title"><span className="num">۲</span>بازبینی اطلاعات استخراج‌شده</div><span className="badge">آماده انتقال</span></div>
      <div className="counts"><span className="badge">{menu.products.length} محصول</span><span className="badge">{categoryCount} دسته‌بندی</span></div>
      <div className="toolbar"><span className="label" style={{margin:0}}>محصولات و دسته‌بندی‌های صفحه</span><button type="button" className="secondary" onClick={download}>↓ ذخیره فایل JSON</button></div>
      <div className="table-wrap"><table><thead><tr><th>محصول</th><th>دسته‌بندی</th><th>قیمت</th><th>توضیحات</th></tr></thead><tbody>
        {menu.products.map((p,i)=><tr key={i}><td><div className="product">{p.image ? <img className="thumb" src={p.image} alt="" /> : <div className="thumb" />}<div>{p.name}{p.englishName && <div className="sub">{p.englishName}</div>}</div></div></td><td><span className="cat">{p.category}</span></td><td>{p.price || "—"}</td><td><div className="sub">{p.description || "—"}</div></td></tr>)}
      </tbody></table></div>
      <div className="footer"><div className="footer-note">منبع: <span dir="ltr">{menu.source}</span><br/>دسته‌ها همراه با آیتم‌ها و تصویر مرتبط نیز ارسال می‌شوند.</div><button className="primary" onClick={send} disabled={sending || menu.products.length===0}>{sending ? "در حال انتقال…" : "دریافت توکن و ارسال منو"} <span aria-hidden>←</span></button></div>
      {notice && <div className="alert success" role="status">{notice}</div>}
      {sendError && <div className="alert error" role="alert">{sendError}</div>}
    </section>}
    <div style={{textAlign:"center",paddingTop:24,color:"#a2aaa5",fontSize:11}}>دودول · ابزار ورود اطلاعات منوی کافه</div>
  </main>;
}
