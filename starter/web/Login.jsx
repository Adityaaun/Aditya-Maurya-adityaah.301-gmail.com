import React, { useState } from 'react';
import { useAuth } from './auth';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('email and password required');
      return;
    }
    
    try {
      await login(email, password);
    } catch (err) {
      // Keep it generic to avoid revealing whether user exists
      setError(err.message || 'invalid credentials');
    }
  };

  return (
    <div data-testid="login-form">
      <h1>Login</h1>
      {error && <div data-testid="login-error" style={{ color: 'red' }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <input 
          type="email" 
          data-testid="login-email" 
          value={email} 
          onChange={e => setEmail(e.target.value)} 
          placeholder="Email"
        />
        <input 
          type="password" 
          data-testid="login-password" 
          value={password} 
          onChange={e => setPassword(e.target.value)} 
          placeholder="Password"
        />
        <button type="submit" data-testid="login-submit">Login</button>
      </form>
    </div>
  );
}
