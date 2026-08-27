"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Language = "zh" | "en";

type LanguageContextValue = {
  language: Language;
  toggleLanguage: () => void;
  text: (zh: string, en: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("zh");

  useEffect(() => {
    const saved = window.localStorage.getItem("meedoo-language");
    if (saved === "zh" || saved === "en") setLanguage(saved);
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    toggleLanguage: () => setLanguage((current) => {
      const next = current === "zh" ? "en" : "zh";
      window.localStorage.setItem("meedoo-language", next);
      return next;
    }),
    text: (zh, en) => language === "zh" ? zh : en,
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used within LanguageProvider");
  return value;
}
