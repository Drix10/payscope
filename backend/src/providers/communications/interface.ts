import { ActionProposal } from '../../domain/contracts';

export type SimulatedDeliveryResult = {
  status: 'simulated';
  note: string;
  simulatedAt: string;
};

/**
 * The buildathon boundary deliberately exposes only this simulated result.
 * A future live adapter must be introduced as a separately reviewed product
 * decision; it cannot be selected through runtime configuration.
 */
export interface CommunicationsProvider {
  executeApprovedAction(proposal: Pick<ActionProposal, 'id' | 'actionType' | 'content'>): Promise<SimulatedDeliveryResult>;
}
