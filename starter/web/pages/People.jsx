import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';

export default function People() {
  const { activeOrgId } = useAuth();
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await apiFetch(`/orgs/${activeOrgId}/members`);
        setPeople(data.members || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeOrgId]);

  if (loading) return <div>Loading people...</div>;

  return (
    <div>
      <h2>People</h2>
      <table>
        <tbody>
          {people.map(person => (
            <tr key={person.user_id} data-testid="user-row" data-user-id={person.user_id}>
              <td>{person.name || person.user_id}</td>
              <td>{person.role}</td>
              {/* Additional actions if needed, e.g. change role, suspend */}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
