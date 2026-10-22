import React, { useEffect, useReducer } from 'react';
import { useOrder } from '../hooks/useOrder';
import { OrderStatus } from '../lib/orderRecovery';

export type GateStatus = 'complete' | 'in_progress' | 'planned' | 'blocked';

export interface AuditGate {
  id: string;
  title: string;
  status: GateStatus;
  evidence: string;
  target?: string;
  tbdReason?: string;
}

export const AUDIT_GATES: AuditGate[] = [
  { id: 'testnet-v2-live', title: 'V2 testnet deployment', status: 'complete', evidence: 'Ethereum Sepolia and Stellar testnet deployments are available for validation.', target: 'Complete' },
  { id: 'resolver-onboarding', title: 'Resolver onboarding', status: 'in_progress', evidence: 'Resolver registration and stake requirements are being validated on testnet.', tbdReason: 'Additional operator evidence is not yet published.' },
  { id: 'fuzz-differential-testing', title: 'Fuzz and differential testing', status: 'in_progress', evidence: 'Contract parity and lifecycle behavior are covered by automated tests.', tbdReason: 'Expanded public test evidence is not yet published.' },
  { id: 'external-audit', title: 'External security audit', status: 'planned', evidence: 'An independent audit is planned before any mainnet deployment.', tbdReason: 'Audit timing remains contingent on review scope and auditor availability.' },
  { id: 'multisig-governance', title: 'Multisig governance', status: 'planned', evidence: 'Operational governance will be documented before mainnet deployment.', tbdReason: 'Governance details remain contingent on audit and operational review.' },
  { id: 'mainnet-v2-enablement', title: 'V2 mainnet enablement', status: 'planned', evidence: 'Mainnet enablement remains contingent on a public external audit and completed operational gates.', tbdReason: 'Mainnet remains disabled until all launch gates are satisfied.' },
];

interface AuditGateTimelineProps {
  gates?: AuditGate[];
  showIntro?: boolean;
}

const statusLabel: Record<GateStatus, string> = {
  complete: 'Complete',
  in_progress: 'In progress',
  planned: 'Planned',
  blocked: 'Blocked',
};

function LaunchAuditGateTimeline({
  gates = AUDIT_GATES,
  showIntro = true,
}: AuditGateTimelineProps) {
  return (
    <section className="space-y-4" data-testid="audit-gate-timeline">
      {showIntro && (
        <div>
          <h2>Audit-gate timeline</h2>
          <p>Launch gates are shown with confirmed evidence; unknown dates are marked TBD rather than invented.</p>
        </div>
      )}
      <ol aria-label="Launch gates in order" className="space-y-3">
        {gates.map((gate) => (
          <li key={gate.id} data-status={gate.status} className="rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3>{gate.title}</h3>
              <span data-testid={`audit-gate-status-${gate.id}`}>{statusLabel[gate.status]}</span>
            </div>
            <p>{gate.evidence}</p>
            <p data-testid={`audit-gate-target-${gate.id}`}>{gate.target ?? 'TBD'}</p>
            {gate.tbdReason && <p>{gate.tbdReason}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default LaunchAuditGateTimeline;

export const COORDINATOR_STATUS_TO_STEP: Record<string, string[] | 'error'> = {
  announced: [],
  src_locked: ['escrow'],
  dst_locked: ['escrow'],
  secret_revealed: ['secret'],
  completed: ['claim'],
  expired: 'error',
  failed: 'error',
  refunded: 'error',
};

export interface OrderTimelineState {
  orderId: string;
  completed: string[];
  awaitingCoordinator: string[];
  error: string | null;
}

export const initialOrderTimeline = (orderId: string): OrderTimelineState => ({
  orderId,
  completed: [],
  awaitingCoordinator: [],
  error: null,
});

type OrderTimelineAction =
  | { type: 'order'; orderId: string; status: string }
  | { type: 'awaiting'; step: string }
  | { type: 'reset'; orderId: string };

export function orderTimelineReducer(
  state: OrderTimelineState,
  action: OrderTimelineAction
): OrderTimelineState {
  if (action.type === 'reset') return initialOrderTimeline(action.orderId);
  if (action.type === 'awaiting') {
    return { ...state, awaitingCoordinator: [...new Set([...state.awaitingCoordinator, action.step])] };
  }
  if (action.orderId !== state.orderId) return state;

  const step = COORDINATOR_STATUS_TO_STEP[action.status];
  if (step === undefined) {
    return { ...state, completed: [], awaitingCoordinator: [], error: `Unknown coordinator status "${action.status}"` };
  }
  if (step === 'error') {
    return {
      ...state,
      completed: [],
      awaitingCoordinator: [],
      error: action.status === 'refunded' ? 'Order refunded' : `Order ${action.status}`,
    };
  }
  return {
    ...state,
    completed: step,
    awaitingCoordinator: state.awaitingCoordinator.filter((pending) => !step.includes(pending)),
    error: null,
  };
}

export interface CoordinatorOrder {
  publicId?: string;
  id?: string;
  status: string;
}

export interface OrderStatusTimelineProps {
  orderId: string;
  fetchOrder?: (orderId: string) => Promise<CoordinatorOrder>;
}

const fetchCoordinatorOrder = async (orderId: string): Promise<CoordinatorOrder> => {
  const apiBase = import.meta.env.PROD ? '' : import.meta.env.VITE_API_BASE_URL || '';
  const response = await fetch(`${apiBase}/api/orders/${encodeURIComponent(orderId)}`);
  if (!response.ok) throw new Error(`Coordinator returned ${response.status}`);
  return await response.json() as CoordinatorOrder;
};

const ORDER_STEPS = [
  { id: 'escrow', label: 'Escrow' },
  { id: 'secret', label: 'Secret' },
  { id: 'claim', label: 'Claim' },
];

export function OrderStatusTimeline({
  orderId,
  fetchOrder = fetchCoordinatorOrder,
}: OrderStatusTimelineProps) {
  const [state, dispatch] = useReducer(orderTimelineReducer, orderId, initialOrderTimeline);
  const readStatus = async () => {
    const result = await fetchOrder(orderId);
    dispatch({ type: 'order', orderId: result.publicId ?? result.id ?? orderId, status: result.status });
  };

  useEffect(() => {
    dispatch({ type: 'reset', orderId });
    void readStatus().catch(() => undefined);
    return undefined;
  }, [orderId, fetchOrder]);

  return (
    <div>
      {ORDER_STEPS.map((step) => {
        const status = state.completed.includes(step.id)
          ? 'complete'
          : state.awaitingCoordinator.includes(step.id)
            ? 'awaiting_coordinator'
            : 'not_started';
        return (
          <div key={step.id} data-testid={`order-step-${step.id}`} data-status={status}>
            <span>{step.label}</span>
            <button type="button" aria-label={`I did this: ${step.label}`} onClick={() => {
              dispatch({ type: 'awaiting', step: step.id });
              void readStatus().catch(() => undefined);
            }}>
              I did this
            </button>
          </div>
        );
      })}
      {state.error && <p data-testid="order-step-error">{state.error}</p>}
    </div>
  );
}

export const AuditGateTimelineForOrder: React.FC<{ orderId: string }> = ({ orderId }) => {
  const { order, error } = useOrder(orderId);
  const [currentStep, setCurrentStep] = React.useState<number>(0);
  const [steps, setSteps] = React.useState([
    { id: 0, label: 'Initiate', status: 'pending' },
    { id: 1, label: 'Escrow', status: 'pending' },
    { id: 2, label: 'Secret', status: 'pending' },
    { id: 3, label: 'Claim', status: 'pending' },
    { id: 4, label: 'Complete', status: 'pending' },
  ]);
  useEffect(() => {
    if (error) {
      setSteps((prev) => prev.map((step) => ({ ...step, status: 'error' })));
      return;
    }
    if (!order) return;
    const legacyStatus = order.status as keyof typeof legacyStatusStep;
    const nextStep = legacyStatusStep[legacyStatus];
    if (nextStep === undefined) {
      setSteps((prev) => prev.map((step) => ({ ...step, status: 'error' })));
      return;
    }
    setCurrentStep((current) => Math.max(current, nextStep));
    setSteps((prev) => prev.map((step) => ({
      ...step,
      status: step.id < Math.max(currentStep, nextStep)
        ? 'complete'
        : step.id === Math.max(currentStep, nextStep)
          ? 'current'
          : 'pending',
    })));
  }, [order, error, currentStep]);
  return <div className="audit-gate-timeline">{steps.map((step) => <div key={step.id} className={`timeline-step ${step.status}`}><div className="step-marker" /><div className="step-label">{step.label}</div></div>)}</div>;
};

const legacyStatusStep: Record<string, number> = {
  [OrderStatus.Pending]: 0,
  [OrderStatus.Escrowed]: 1,
  [OrderStatus.SecretSubmitted]: 2,
  [OrderStatus.Claimed]: 3,
  [OrderStatus.Completed]: 4,
  [OrderStatus.Failed]: -1,
};

export const AuditGateTimeline: React.FC<{ orderId: string }> = AuditGateTimelineForOrder;
