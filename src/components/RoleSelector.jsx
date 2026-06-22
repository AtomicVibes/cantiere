import { useEffect, useState } from 'react';
import { supabase } from '@/services/supabase';

export const RoleSelector = ({ userId, currentRoleId, onUpdate }) => {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchRoles = async () => {
      const { data } = await supabase.from('roles').select('id, name');
      setRoles(data || []);
    };
    fetchRoles();
  }, []);

  const handleRoleChange = async (newRoleId) => {
    if (!userId) return;
    setLoading(true);
    await supabase.from('profiles').update({ role_id: newRoleId }).eq('id', userId);
    onUpdate();
    setLoading(false);
  };

  return (
    <select disabled={loading} onChange={(e) => handleRoleChange(e.target.value)} defaultValue={currentRoleId}>
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
};
