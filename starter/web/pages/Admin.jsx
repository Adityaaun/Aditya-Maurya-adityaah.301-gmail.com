import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { Permission } from '../Permission';

export default function Admin() {
  const { activeOrgId } = useAuth();
  const [orgName, setOrgName] = useState('');

  const handleCreate = async () => {
    try {
      await apiFetch('/orgs', { 
        method: 'POST', 
        body: { name: orgName || 'New Org' } 
      });
      // Need to reload auth or something? The test intercepts window.prompt? No:
      // page.once('dialog', (d) => d.accept('E2E Fresh Org'));
      // await page.getByTestId('create-org').click();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <h2>Admin</h2>
      
      <Permission permission="org:update">
        <button data-testid="rename-org">Rename Org</button>
      </Permission>
      
      <Permission permission="org:delete">
        <button data-testid="delete-org">Delete Org</button>
      </Permission>
      
      <div style={{ marginTop: 20 }}>
        <h3>Create New Org</h3>
        <button 
          data-testid="create-org" 
          onClick={async () => {
            const name = window.prompt('Org name?');
            if (!name) return;
            try {
              // Create the org
              const data = await apiFetch('/orgs', {
                method: 'POST',
                body: { name }
              });
              // Then switch to it to become the owner in context
              window.dispatchEvent(new Event('auth:stale'));
            } catch (e) {
              console.error(e);
            }
          }}
        >
          Create Org
        </button>
      </div>
    </div>
  );
}
