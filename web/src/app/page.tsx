'use client';

import { useEffect } from 'react';
import { useNavigate } from '@/lib/router';
import { useAuth } from '@/modules/auth/application/use-auth';

/** `/` — redireciona por sessão: logado -> /overview, senão /auth (sem tela própria). */
export default function IndexPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    navigate({ to: user ? '/overview' : '/auth', replace: true });
  }, [loading, user, navigate]);

  return null;
}
