import { supabase } from './supabase';

const handleReadCall = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    console.error('DATA_ERROR_LOG', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return undefined;
  }
};

const handleWriteCall = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    console.error('DATA_ERROR_LOG', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    throw error;
  }
};

export const listEntities = (table, options = {}) => {
  return handleReadCall(async () => {
    let query = supabase.from(table).select('*');

    if (options.order) {
      query = query.order(options.order.column || 'id', {
        ascending: options.order.direction !== 'desc',
      });
    }

    if (options.filter) {
      Object.entries(options.filter).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }

    const { data, error } = await query;

    if (error) throw error;
    return data ?? [];
  });
};

export const getEntity = (table, id) => {
  return handleReadCall(async () => {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  });
};

export const findEntity = (table, filters, options = {}) => {
  return handleReadCall(async () => {
    let query = supabase.from(table).select('*');

    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    if (options.order) {
      query = query.order(options.order.column || 'id', {
        ascending: options.order.direction !== 'desc',
      });
    }

    const { data, error } = await query;

    if (error) throw error;
    return data ?? [];
  });
};

export const createEntity = (table, payload) => {
  return handleWriteCall(async () => {
    const { data, error } = await supabase
      .from(table)
      .insert([payload])
      .select()
      .single();

    if (error) throw error;
    return data;
  });
};

export const updateEntity = (table, id, payload) => {
  return handleWriteCall(async () => {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  });
};

export const deleteEntity = (table, id) => {
  return handleWriteCall(async () => {
    const { data, error } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  });
};

export async function checkClientDeletePreflight(clientProfileId) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name')
    .eq('client_id', clientProfileId);

  if (error) throw error;

  if (data && data.length > 0) {
    return { canDelete: false, projects: data };
  }

  return { canDelete: true };
}
