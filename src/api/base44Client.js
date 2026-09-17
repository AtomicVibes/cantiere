import { supabase } from './supabaseClient';

// Map base44 entity names to Supabase table names
const entityTableMap = {
  CalendarEvent: 'events',
  Document: 'documents',
  Notification: 'notifications',
};

const getTableName = (entityName) => {
  return entityTableMap[entityName] || entityName.toLowerCase();
};

const toPgTime = (t) => {
  if (!t) return null;
  return t.length === 5 ? `${t}:00` : t;
};

const isDocumentTable = (tableName) => tableName === 'documents';

const resolveDocumentUrls = async (records, tableName) => {
  if (!isDocumentTable(tableName)) return records;

  return Promise.all((records || []).map(async (record) => {
    if (!record.file_url || record.file_url.startsWith('http')) return record;

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(record.file_url, 3600);
    if (error) {
      console.warn('[documents] failed to create signed URL:', error.message);
      return record;
    }
    return { ...record, file_url: data?.signedUrl || record.file_url };
  }));
};

export const base44 = {
  auth: {
    me: async () => {
      console.log('[base44→supabase] auth.me: getting user');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) {
        console.error('[base44→supabase] auth.me error:', error);
        throw error;
      }
      if (!user) {
        throw { status: 401, message: 'Not authenticated' };
      }
      return user;
    },
    logout: async (redirect) => {
      console.log('[base44→supabase] auth.logout');
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('[base44→supabase] auth.logout error:', error);
        throw error;
      }
      if (redirect) window.location.href = redirect;
    },
    redirectToLogin: (returnUrl) => {
      const url = `/login${returnUrl ? `?returnTo=${encodeURIComponent(returnUrl)}` : ''}`;
      window.location.href = url;
    }
  },
  entities: new Proxy({}, {
    get: (_, entityName) => {
      const tableName = getTableName(entityName);
      return {
        list: async (sortParam) => {
          console.log(`[base44→supabase] ${entityName} (${tableName}) list:`, { sortParam });
          let query = supabase.from(tableName).select('*');
          
          if (sortParam) {
            const desc = sortParam.startsWith('-');
            const field = desc ? sortParam.substring(1) : sortParam;
            // Map legacy created_date to created_at if needed
            const dbField = field === 'created_date' ? 'created_at' : field;
            query = query.order(dbField, { ascending: !desc });
          }

          const { data, error } = await query;
          console.log(`[base44→supabase] ${entityName} list result:`, { data, error });
          if (error) throw error;
          return isDocumentTable(tableName) ? resolveDocumentUrls(data ?? [], tableName) : (data ?? []);
        },
        find: async (id) => {
          console.log(`[base44→supabase] ${entityName} find:`, { id });
          const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .eq('id', id)
            .single();
          console.log(`[base44→supabase] ${entityName} find result:`, { data, error });
          if (error) throw error;
          return data;
        },
        create: async (payload) => {
          console.log(`[base44→supabase] ${entityName} create payload:`, payload);
          const { data: { user }, error: userErr } = await supabase.auth.getUser();
          if (userErr || !user) {
            throw new Error('Not authenticated — cannot create record');
          }

          let processedPayload = { ...payload, user_id: user.id };

          // Specific adjustments for events table
          if (tableName === 'events') {
            if (processedPayload.description) {
              processedPayload.description = processedPayload.description.slice(0, 150);
            }
            if (processedPayload.time) {
              processedPayload.time = toPgTime(processedPayload.time);
            }
            if (!processedPayload.time) {
              processedPayload.time = '00:00:00';
            }
          }

          console.log(`[base44→supabase] ${entityName} processed insert payload:`, processedPayload);

          const { data, error } = await supabase
            .from(tableName)
            .insert(processedPayload)
            .select()
            .single();

          console.log(`[base44→supabase] ${entityName} create result:`, { data, error });
          if (error) throw error;
          return data;
        },
        update: async (id, payload) => {
          console.log(`[base44→supabase] ${entityName} update:`, { id, payload });
          let processedPayload = { ...payload };

          if (tableName === 'events') {
            if (processedPayload.description) {
              processedPayload.description = processedPayload.description.slice(0, 150);
            }
            if (processedPayload.time) {
              processedPayload.time = toPgTime(processedPayload.time);
            }
          }

          const { data, error } = await supabase
            .from(tableName)
            .update(processedPayload)
            .eq('id', id)
            .select()
            .single();

          console.log(`[base44→supabase] ${entityName} update result:`, { data, error });
          if (error) throw error;
          return data;
        },
        delete: async (id) => {
          console.log(`[base44→supabase] ${entityName} delete:`, { id });
          const { data, error } = await supabase
            .from(tableName)
            .delete()
            .eq('id', id)
            .select();

          console.log(`[base44→supabase] ${entityName} delete result:`, { data, error });
          if (error) throw error;
          return data?.[0] || { id };
        }
      };
    }
  }),
  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        if (!file) throw new Error('A file is required');

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) throw new Error('Not authenticated — cannot upload file');

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from('documents')
          .upload(filePath, file, { contentType: file.type || undefined, upsert: false });
        if (error) throw error;

        return { file_url: filePath };
      },
    },
  },
  request: async (path, opts) => {
    console.log(`[base44→supabase] request:`, { path, opts });
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw { status: res.status, data: json };
    return json;
  }
};
