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
    const storagePath = record.storage_path;
    const document = {
      ...record,
      name: record.file_name,
      file_url: storagePath,
      file_format: record.mime_type?.split('/').pop() || '',
      storage_path: storagePath,
    };
    if (!storagePath) return document;

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 3600);
    if (error) {
      // Never fall back to the raw storage path: only signed URLs may reach the UI.
      console.warn('[documents] failed to create signed URL:', error.message);
      return { ...document, file_url: null };
    }
    return { ...document, file_url: data?.signedUrl || null };
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
          const { data: { session } } = await supabase.auth.getSession();
          const userId = session?.user_id || session?.user?.id || null;
          if (!session?.access_token || !userId) {
            throw new Error('Not authenticated — cannot create record');
          }

          let processedPayload = { ...payload, user_id: userId };

          if (isDocumentTable(tableName)) {
            const { data, error } = await supabase.rpc('create_document_with_audience', {
              p_file_name: payload.name || payload.file_name,
              p_storage_path: payload.file_url || payload.storage_path,
              p_mime_type: payload.mime_type,
              p_file_size: payload.file_size || 0,
              p_type: payload.type || 'other',
              p_project_id: payload.project_id || null,
              p_notes: payload.notes || null,
              p_visibility: payload.visibility || 'private',
              p_audience_user_ids: payload.audience_user_ids || [],
            });
            console.log(`[base44→supabase] ${entityName} create result:`, { data, error });
            if (error) throw error;
            return data;
          }

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
            .select();

          console.log(`[base44→supabase] ${entityName} update result:`, { data, error });
          if (error) throw error;

          // PostgREST returns an empty array without an error when the UPDATE
          // matched no row (RLS refused it, or the row no longer exists). Reporting
          // that as success hides permission problems, so surface it as a failure.
          if (!Array.isArray(data) || data.length === 0) {
            const notUpdated = new Error(
              `The ${entityName} record was not updated. It may have already been removed, or you may not have permission to update it.`
            );
            notUpdated.code = 'UPDATE_NOT_APPLIED';
            throw notUpdated;
          }

          return data[0];
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

          // PostgREST answers with an empty array and no error when RLS blocks the
          // delete (or the row no longer exists). Treat that as a failure so callers
          // can never report success for a row that is still in the database.
          if (!Array.isArray(data) || data.length === 0) {
            const notDeleted = new Error(
              `The ${entityName} record was not deleted. It may have already been removed, or you may not have permission to delete it.`
            );
            notDeleted.code = 'DELETE_NOT_APPLIED';
            throw notDeleted;
          }

          return data[0];
        }
      };
    }
  }),
  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        if (!file) throw new Error('A file is required');

        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        const userId = session?.user_id || session?.user?.id || null;
        if (!accessToken || !userId) throw new Error('Not authenticated — cannot upload file');

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = `${userId}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from('documents')
          .upload(filePath, file, { contentType: file.type || undefined, upsert: false });
        if (error) throw error;

        return { file_url: filePath };
      },
      DeleteFile: async ({ filePath }) => {
        if (!filePath || filePath.startsWith('http')) return { removed: false, skipped: true };

        const { data, error } = await supabase.storage.from('documents').remove([filePath]);
        if (error) throw error;

        // Storage also answers 200 with an empty payload when RLS blocks the
        // removal, so the returned objects are the only proof the file is gone.
        const removed = Array.isArray(data) && data.length > 0;
        if (!removed) {
          const notRemoved = new Error('The stored file could not be removed from storage.');
          notRemoved.code = 'STORAGE_DELETE_NOT_APPLIED';
          throw notRemoved;
        }

        return { removed: true, skipped: false };
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
