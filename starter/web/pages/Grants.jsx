import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { Permission } from '../Permission';

export default function Grants() {
  const { activeOrgId } = useAuth();
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [userId, setUserId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [effect, setEffect] = useState('allow');
  const [perms, setPerms] = useState({});

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await apiFetch('/grants');
        setGrants(data.grants || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeOrgId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const selectedPerms = Object.keys(perms).filter(k => perms[k]);
    try {
      await apiFetch(`/orgs/${activeOrgId}/grants`, {
        method: 'POST',
        body: { userId, deviceId: deviceId || undefined, effect, permissions: selectedPerms }
      });
      // reload
      const data = await apiFetch('/grants');
      setGrants(data.grants || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRevoke = async (id) => {
    try {
      await apiFetch(`/grants/${id}`, { method: 'DELETE' });
      setGrants(grants.filter(g => g.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div>Loading grants...</div>;

  return (
    <div>
      <h2>Grants</h2>
      
      <table>
        <tbody>
          {grants.map(grant => (
            <tr key={grant.id} data-testid="grant-row" data-effect={grant.effect}>
              <td>{grant.user_id}</td>
              <td>{grant.effect}</td>
              <td>{grant.permissions.join(', ')}</td>
              <td>
                <Permission permission="grant:revoke">
                  <button data-testid="revoke-grant" onClick={() => handleRevoke(grant.id)}>Revoke</button>
                </Permission>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Permission permission="grant:create">
        <div>
          <button data-testid="new-grant" onClick={() => setShowForm(!showForm)}>New Grant</button>
          
          {showForm && (
            <form onSubmit={handleCreate} style={{ marginTop: 20 }}>
              <h3>Create Grant</h3>
              <select data-testid="grant-user" value={userId} onChange={e => setUserId(e.target.value)}>
                <option value="">Select User</option>
                <option value="usr_acme_viewer">usr_acme_viewer</option>
                <option value="usr_sam">usr_sam</option>
                <option value="usr_dana">usr_dana</option>
              </select>

              <select data-testid="grant-device" value={deviceId} onChange={e => setDeviceId(e.target.value)}>
                <option value="">All Devices</option>
                <option value="dev_qa_android_01">dev_qa_android_01</option>
              </select>

              <select data-testid="grant-effect" value={effect} onChange={e => setEffect(e.target.value)}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>

              <div>
                <label>
                  <input 
                    type="checkbox" 
                    data-permission-key="device:terminal"
                    checked={perms['device:terminal'] || false}
                    onChange={e => setPerms(p => ({ ...p, 'device:terminal': e.target.checked }))}
                  />
                  device:terminal
                </label>
              </div>

              <button type="submit" data-testid="grant-submit">Submit</button>
            </form>
          )}
        </div>
      </Permission>
    </div>
  );
}
