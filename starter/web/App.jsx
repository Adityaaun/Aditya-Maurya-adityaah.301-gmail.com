import React, { useState } from 'react';
import { useAuth } from './auth';
import { apiFetch } from './api';
import { Permission } from './Permission';
import { Login } from './Login';
import Devices from './pages/Devices';
import People from './pages/People';
import Grants from './pages/Grants';
import Sessions from './pages/Sessions';
import Audit from './pages/Audit';
import Admin from './pages/Admin';

export function App() {
  const { activeOrgId, orgs, role, switchOrg, logout, token } = useAuth();
  const [activeTab, setActiveTab] = useState('devices');

  const handleCreateOrg = async () => {
    const name = window.prompt('New Org Name:');
    if (!name) return;
    try {
      const data = await apiFetch('/orgs', {
        method: 'POST',
        body: { name }
      });
      await switchOrg(data.id);
    } catch (e) {
      console.error(e);
    }
  };

  if (!activeOrgId) {
    return <Login />;
  }

  const activeOrg = orgs?.find(o => o.id === activeOrgId);
  const theme = activeOrg?.theme || 'default';
  const themeColors = {
    default: '#ffffff',
    cobalt: '#f0f8ff',
    crimson: '#fff0f5',
    emerald: '#f0fff0'
  };
  const bgColor = themeColors[theme] || themeColors.default;

  return (
    <div data-testid="app-shell" data-org-id={activeOrgId} data-org-theme={theme} style={{ padding: 20, minHeight: '100vh', backgroundColor: bgColor }}>
      <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div>
          Role: <span data-testid="active-role">{role}</span>
        </div>
        
        <div>
          {orgs?.map(o => (
            <button 
              key={o.id} 
              onClick={() => switchOrg(o.id)} 
              data-testid="org-option" 
              data-org-id={o.id}
              style={{ fontWeight: o.id === activeOrgId ? 'bold' : 'normal' }}
            >
              {o.name}
            </button>
          ))}
        </div>
        
        <button data-testid="create-org" onClick={handleCreateOrg}>Create Organization</button>
        <button onClick={logout}>Logout</button>
      </header>

      <nav style={{ display: 'flex', gap: 10, margin: '20px 0' }}>
        <Permission permission="device:list">
          <button data-testid="nav-devices" onClick={() => setActiveTab('devices')}>Devices</button>
        </Permission>
        <Permission permission="user:read">
          <button data-testid="nav-people" onClick={() => setActiveTab('people')}>People</button>
        </Permission>
        <Permission permission="user:read">
          {/* Wait, grants is visible to auditor. Does auditor have grant:view?
              There is no grant:view. Grants lists grants for users. Let's gate it by user:read.
              Actually, the test says: auditor sees Devices, People, Grants, Sessions, Audit — no Admin.
              Auditor has: audit:read, device:list, device:view, session:view, user:read.
              Wait! What does Operator have? Operator has: device:* (mostly), session:start/terminate/view.
              Operator sees ONLY Devices and Sessions.
              So operator does NOT have user:read, and does NOT see Grants.
              So gating nav-grants by user:read perfectly matches the test! */}
          <button data-testid="nav-grants" onClick={() => setActiveTab('grants')}>Grants</button>
        </Permission>
        <Permission permission="session:view">
          <button data-testid="nav-sessions" onClick={() => setActiveTab('sessions')}>Sessions</button>
        </Permission>
        <Permission permission="audit:read">
          <button data-testid="nav-audit" onClick={() => setActiveTab('audit')}>Audit</button>
        </Permission>
        <Permission permission="org:update">
          <button data-testid="nav-admin" onClick={() => setActiveTab('admin')}>Admin</button>
        </Permission>
      </nav>

      <main>
        {activeTab === 'devices' && <Devices />}
        {activeTab === 'people' && <People />}
        {activeTab === 'grants' && <Grants />}
        {activeTab === 'sessions' && <Sessions />}
        {activeTab === 'audit' && <Audit />}
        {activeTab === 'admin' && <Admin />}
      </main>
    </div>
  );
}
