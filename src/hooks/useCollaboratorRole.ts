// Collaborator role hook - checks user permissions
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useCollaboratorRole() {
  const { user } = useAuth();
  const [isCollaborator, setIsCollaborator] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsCollaborator(false);
      setIsAdmin(false);
      setIsLoading(false);
      return;
    }

    checkRoles();
  }, [user]);

  const checkRoles = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      if (error) {
        console.error('Error checking roles:', error);
        setIsCollaborator(false);
        setIsAdmin(false);
      } else {
        const roles = data?.map(r => r.role) || [];
        setIsAdmin(roles.includes('admin'));
        setIsCollaborator(roles.includes('collaborator') || roles.includes('admin'));
      }
    } catch (err) {
      console.error('Error checking roles:', err);
      setIsCollaborator(false);
      setIsAdmin(false);
    } finally {
      setIsLoading(false);
    }
  };

  return { isCollaborator, isAdmin, isLoading };
}
