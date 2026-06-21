import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      loading: 'Loading...',
      login: 'Login',
      register: 'Register',
      forgotPassword: 'Forgot Password',
      resetPassword: 'Reset Password',
      dashboard: 'Dashboard',
      projects: 'Projects',
      teams: 'Teams',
      clients: 'Clients',
      notifications: 'Notifications',
      finance: 'Finance',
      calendar: 'Calendar',
      reports: 'Reports',
      documents: 'Documents',
      settings: 'Settings',
      logout: 'Logout',
      email: 'Email',
      password: 'Password',
      confirmPassword: 'Confirm Password',
      submit: 'Submit',
      cancel: 'Cancel',
      save: 'Save',
      delete: 'Delete',
      edit: 'Edit',
      search: 'Search',
      filter: 'Filter',
      noResults: 'No results found',
      error: 'Error',
      success: 'Success',
      warning: 'Warning',
      authenticationRequired: 'Authentication required',
      userNotRegistered: 'User not registered for this app',
      pageNotFound: 'Page not found',
      goHome: 'Go Home',
      goBack: 'Go Back'
    }
  },
  ar: {
    translation: {
      loading: 'جارٍ التحميل...',
      login: 'تسجيل الدخول',
      register: 'إنشاء حساب',
      forgotPassword: 'نسيت كلمة المرور',
      resetPassword: 'إعادة تعيين كلمة المرور',
      dashboard: 'لوحة التحكم',
      projects: 'المشاريع',
      teams: 'الفرق',
      clients: 'العملاء',
      notifications: 'الإشعارات',
      finance: 'المالية',
      calendar: 'التقويم',
      reports: 'التقارير',
      documents: 'المستندات',
      settings: 'الإعدادات',
      logout: 'تسجيل الخروج',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      confirmPassword: 'تأكيد كلمة المرور',
      submit: 'إرسال',
      cancel: 'إلغاء',
      save: 'حفظ',
      delete: 'حذف',
      edit: 'تعديل',
      search: 'بحث',
      filter: 'تصفية',
      noResults: 'لم يتم العثور على نتائج',
      error: 'خطأ',
      success: 'نجاح',
      warning: 'تحذير',
      authenticationRequired: 'مطلوب المصادقة',
      userNotRegistered: 'المستخدم غير مسجل في هذا التطبيق',
      pageNotFound: 'الصفحة غير موجودة',
      goHome: 'الذهاب إلى الصفحة الرئيسية',
      goBack: 'العودة'
    }
  },
  fr: {
    translation: {
      loading: 'Chargement...',
      login: 'Connexion',
      register: 'S\'inscrire',
      forgotPassword: 'Mot de passe oublié',
      resetPassword: 'Réinitialiser le mot de passe',
      dashboard: 'Tableau de bord',
      projects: 'Projets',
      teams: 'Équipes',
      clients: 'Clients',
      notifications: 'Notifications',
      finance: 'Finances',
      calendar: 'Calendrier',
      reports: 'Rapports',
      documents: 'Documents',
      settings: 'Paramètres',
      logout: 'Déconnexion',
      email: 'E-mail',
      password: 'Mot de passe',
      confirmPassword: 'Confirmer le mot de passe',
      submit: 'Envoyer',
      cancel: 'Annuler',
      save: 'Enregistrer',
      delete: 'Supprimer',
      edit: 'Modifier',
      search: 'Rechercher',
      filter: 'Filtrer',
      noResults: 'Aucun résultat trouvé',
      error: 'Erreur',
      success: 'Succès',
      warning: 'Avertissement',
      authenticationRequired: 'Authentification requise',
      userNotRegistered: 'Utilisateur non inscrit à cette application',
      pageNotFound: 'Page non trouvée',
      goHome: 'Accueil',
      goBack: 'Retour'
    }
  },
  it: {
    translation: {
      loading: 'Caricamento...',
      login: 'Accedi',
      register: 'Registrati',
      forgotPassword: 'Password dimenticata',
      resetPassword: 'Reimposta password',
      dashboard: 'Dashboard',
      projects: 'Progetti',
      teams: 'Team',
      clients: 'Clienti',
      notifications: 'Notifiche',
      finance: 'Finanze',
      calendar: 'Calendario',
      reports: 'Report',
      documents: 'Documenti',
      settings: 'Impostazioni',
      logout: 'Esci',
      email: 'Email',
      password: 'Password',
      confirmPassword: 'Conferma password',
      submit: 'Invia',
      cancel: 'Annulla',
      save: 'Salva',
      delete: 'Elimina',
      edit: 'Modifica',
      search: 'Cerca',
      filter: 'Filtra',
      noResults: 'Nessun risultato trovato',
      error: 'Errore',
      success: 'Successo',
      warning: 'Avviso',
      authenticationRequired: 'Autenticazione richiesta',
      userNotRegistered: 'Utente non registrato a questa applicazione',
      pageNotFound: 'Pagina non trovata',
      goHome: 'Home',
      goBack: 'Indietro'
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['querystring', 'cookie', 'localStorage', 'navigator', 'htmlTag', 'path', 'subdomain'],
      lookupQuerystring: 'lng',
      lookupCookie: 'i18next',
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage', 'cookie'],
      cookieMinutes: 43200,
      cookieDomain: window.location.hostname
    }
  });

export default i18n;
