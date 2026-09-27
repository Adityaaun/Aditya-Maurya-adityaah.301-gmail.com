import React, { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { Login } from './Login';

export function Invite({ token }) {
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch(`/invites/${token}`);
        setInvite(data);
      } catch (err) {
        setError('Invalid or expired invite token');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleAccept = async (e) => {
    e.preventDefault();
    try {
      await apiFetch(`/invites/${token}/accept`, {
        method: 'POST',
        body: { name, password }
      });
      window.location.href = '/';
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div data-testid="invite-error">{error}</div>;

  return (
    <div>
      <h1>Join {invite.orgName}</h1>
      <p>Role: <strong data-testid="invite-role">{invite.role}</strong></p>
      
      <form onSubmit={handleAccept}>
        <input 
          type="email" 
          data-testid="invite-email" 
          value={invite.email} 
          disabled 
        />
        <input 
          type="text" 
          data-testid="invite-name" 
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your Name"
          required
        />
        <input 
          type="password" 
          data-testid="invite-password" 
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          required
        />
        <button type="submit" data-testid="invite-submit">Join Organization</button>
      </form>
    </div>
  );
}
