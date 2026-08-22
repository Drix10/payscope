import { ActionProposal } from '../../domain/contracts';
import { CommunicationsProvider, SimulatedDeliveryResult } from './interface';

/** The only registered communications adapter. It sends nothing. */
export class LoggingCommunicationsAdapter implements CommunicationsProvider {
  async executeApprovedAction(proposal: Pick<ActionProposal, 'id' | 'actionType' | 'content'>): Promise<SimulatedDeliveryResult> {
    return {
      status: 'simulated',
      note: `LoggingCommunicationsAdapter recorded ${proposal.actionType}; no customer message was sent.`,
      simulatedAt: new Date().toISOString(),
    };
  }
}
