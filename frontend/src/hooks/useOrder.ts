import { useEffect, useState } from 'react';
import type { RecoveredOrder } from '../lib/orderRecovery';

const API_BASE_URL = import.meta.env.PROD ? '' : import.meta.env.VITE_API_BASE_URL || '';

export function useOrder(orderId: string): { order: RecoveredOrder | null; error: Error | null } {
  const [order, setOrder] = useState<RecoveredOrder | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Coordinator returned ${response.status}`);
        return await response.json() as RecoveredOrder;
      })
      .then((nextOrder) => {
        if (active) {
          setOrder(nextOrder);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  return { order, error };
}
