import { supabase } from './supabase';

const handleDataCall = async (operation) => {
  try {
    const result = await operation();
    return result;
  } catch (error) {
    console.error('DATA_ERROR_LOG', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return null;
  }
};

export const listEntities = (table, options = {}) => {
  return handleDataCall(async () => {
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
  return handleDataCall(async () => {
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
  return handleDataCall(async () => {
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
  return handleDataCall(async () => {
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
  return handleDataCall(async () => {
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
  return handleDataCall(async () => {
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
