"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/components/auth/LanguageProvider";
import { Languages } from "lucide-react";

export default function Navbar() {
  const path = usePathname();
  const { lang, setLang, t } = useLang();

  const links = [
    { href: "/", label: t("nav", "dashboard") },
    { href: "/gis-portal", label: t("nav", "gis") },
    { href: "/monitoring", label: t("nav", "monitoring") },
    { href: "/deforestation", label: t("nav", "deforestation") },
    { href: "/region-analysis", label: t("nav", "cnn") },
    { href: "/model-explanation", label: t("nav", "metrics") },
    { href: "/research", label: t("nav", "research") },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center px-6">
        <Link href="/" className="flex flex-col leading-none shrink-0">
          <span className="text-[28px] font-black tracking-tight text-orange-500">
            Wildfires
          </span>
          <span className="text-[13px] font-bold tracking-[0.2em] text-blue-600 uppercase -mt-0.5">
            India
          </span>
        </Link>

        <div className="flex flex-1 items-center justify-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`relative rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors ${
                path === l.href
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setLang(lang === "en" ? "hi" : "en")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-colors"
            title={t("lang", "label")}
          >
            <Languages className="h-4 w-4" />
            {t("lang", "toggle")}
          </button>
        </div>
      </div>
    </nav>
  );
}
