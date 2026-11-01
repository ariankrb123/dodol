import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "میز — استخراج منوی کافه",
  description: "استخراج محصولات و دسته‌بندی منوی کافه و انتقال امن به منوتام",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body>{children}</body></html>;
}
