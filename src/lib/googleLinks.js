export const GOOGLE_DOC_MIME = {
  document: 'application/vnd.google-apps.document',
  spreadsheets: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
};

const GOOGLE_DOC_RE = /^\/(document|spreadsheets|presentation)(?:\/u\/\d+)?\/d\//;

export const parseGoogleDocLink = (value) => {
  if (!value?.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== 'docs.google.com') return null;
  const match = url.pathname.match(GOOGLE_DOC_RE);
  return match ? { subtype: match[1] } : null;
};

export const getGoogleDocMime = (subtype) => GOOGLE_DOC_MIME[subtype] || null;