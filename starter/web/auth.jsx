import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch, setToken } from './api';

const AuthContext = createContext();

function decodeToken(token) {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch (e) {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [authData, setAuthData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Attempt to exchange session cookie for token on mount (if backend supports it)
  useEffect(() => {
    async function init() {
      try {
        const data = await apiFetch('/auth/refresh', { method: 'POST', body: {} });
        setToken(data.token);
        const claims = decodeToken(data.token);
        setAuthData({ ...data, activeOrgId: claims?.org });
      } catch (e) {
        // Not logged in or no refresh cookie
      } finally {
        setLoading(false);
      }
    }
    init();

    const handleStale = async () => {
      // Re-fetch token using cookie if token is stale
      try {
        const data = await apiFetch('/auth/refresh', { method: 'POST', body: {} });
        setToken(data.token);
        const claims = decodeToken(data.token);
        setAuthData({ ...data, activeOrgId: claims?.org });
      } catch (e) {
        setToken(null);
        setAuthData(null);
      }
    };
    
    const handleUnauth = () => {
      setToken(null);
      setAuthData(null);
    };

    window.addEventListener('auth:stale', handleStale);
    window.addEventListener('auth:unauthenticated', handleUnauth);
    return () => {
      window.removeEventListener('auth:stale', handleStale);
      window.removeEventListener('auth:unauthenticated', handleUnauth);
    };
  }, []);

  const login = async (email, password) => {
    const data = await apiFetch('/auth/login', { 
      method: 'POST', 
      body: { email, password } 
    });
    setToken(data.token);
    const claims = decodeToken(data.token);
    setAuthData({ ...data, activeOrgId: claims?.org, orgs: data.orgs });
    // Save orgs in state or somewhere to persist across token refreshes? 
    // Wait, POST /auth/token doesn't return orgs! We need to persist orgs locally across token switch.
    // Or just refetch orgs if needed.
  };

  const switchOrg = async (orgId) => {
    const data = await apiFetch('/auth/token', { 
      method: 'POST', 
      body: { orgId } 
    });
    setToken(data.token);
    const claims = decodeToken(data.token);
    setAuthData(prev => ({ ...prev, ...data, activeOrgId: claims?.org }));
  };

  const logout = () => {
    setToken(null);
    setAuthData(null);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <AuthContext.Provider value={{ ...authData, login, logout, switchOrg }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
