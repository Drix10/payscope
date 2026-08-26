import { Response } from 'express';
import { EventEmitter } from 'events';

export type RealTimeEvent = {
  type: 'incident_created' | 'incident_updated' | 'investigation_updated' | 'action_dispatched' | 'audit_created' | 'ping';
  organizationId: string;
  incidentId?: string;
  payload?: Record<string, unknown>;
  timestamp: string;
};

class RealTimeHub extends EventEmitter {
  private clients: Set<{ res: Response; organizationId: string }> = new Set();

  constructor() {
    super();
    // Heartbeat every 15s to keep connections alive
    setInterval(() => {
      this.broadcast('ping', 'all', {});
    }, 15_000).unref();
  }

  addClient(res: Response, organizationId: string): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const client = { res, organizationId };
    this.clients.add(client);

    // Initial connection message
    const initialEvent: RealTimeEvent = {
      type: 'ping',
      organizationId,
      timestamp: new Date().toISOString(),
    };
    res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);

    res.on('close', () => {
      this.clients.delete(client);
    });
  }

  broadcast(type: RealTimeEvent['type'], organizationId: string, payload?: Record<string, unknown>, incidentId?: string): void {
    const event: RealTimeEvent = {
      type,
      organizationId,
      incidentId,
      payload,
      timestamp: new Date().toISOString(),
    };

    const message = `data: ${JSON.stringify(event)}\n\n`;

    for (const client of this.clients) {
      if (organizationId === 'all' || client.organizationId === organizationId) {
        try {
          client.res.write(message);
        } catch {
          this.clients.delete(client);
        }
      }
    }
    this.emit('event', event);
  }
}

export const realtimeHub = new RealTimeHub();
