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
