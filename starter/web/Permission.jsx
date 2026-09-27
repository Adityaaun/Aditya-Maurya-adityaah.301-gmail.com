import React from 'react';
import { useAuth } from './auth';

export function Permission({ permission, children }) {
  const { permissions } = useAuth();
  
  if (!permissions) return null;
  const permResult = permissions[permission];
  
  // Only render if the server explicitly allowed it
  if (!permResult || permResult.effect !== 'allow') return null;

  // Render children and attach data-permission and data-state="unlocked"
  return React.cloneElement(React.Children.only(children), {
    'data-permission': permission,
    'data-state': 'unlocked'
  });
}
