import { createContext, useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ckb', 'ug', 'arc']);
const LTR_LANGS = new Set(['en', 'fr', 'de', 'es', 'it', 'pt', 'nl']);

const LanguageContext = createContext({ dir: 'ltr', lang: 'en', setLanguage: () => {} });

export const LanguageProvider = ({ children, defaultLang = 'en' }) => {
  const { i18n } = useTranslation();
  const [dir, setDir] = useState('ltr');
  const [lang, setLang] = useState(defaultLang);

  useEffect(() => {
    const currentLang = i18n.language?.split('-')[0]?.toLowerCase() || defaultLang;
    const determinedDir = RTL_LANGS.has(currentLang) ? 'rtl' : LTR_LANGS.has(currentLang) ? 'ltr' : (currentLang === 'en' ? 'ltr' : 'rtl');
    setLang(currentLang);
    setDir(determinedDir);
    document.documentElement.dir = determinedDir;
    document.documentElement.lang = currentLang;
  }, [i18n.language, defaultLang]);

  const setLanguage = (lng) => {
    i18n.changeLanguage(lng);
  };

  return (
    <LanguageContext.Provider value={{ dir, lang, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useDirection = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useDirection must be used within a LanguageProvider');
  }
  return context;
};
