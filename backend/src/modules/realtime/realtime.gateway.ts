import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { BookingStatus, PaymentStatus } from '@autowra/shared-types';
import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';

export interface BookingRealtimeEvent {
  readonly bookingId: string;
  readonly reference: string;
  readonly status: BookingStatus;
  readonly paymentStatus: PaymentStatus;
  readonly partnerName: string | null;
  readonly updatedAt: string;
}

/**
 * Realtime channel used by both mobile apps and the dashboard.
 *
 * A socket joins two rooms: `user:<id>` for personal events and `booking:<reference>` once
 * the client subscribes to a specific booking. Connections are authenticated with the same
 * access token as the REST API - an unauthenticated socket is disconnected immediately.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket): void {
    const token = extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token);
      if (payload.typ !== 'access') throw new Error('wrong token type');
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      void client.join(`user:${payload.sub}`);
      client.emit('connected', { userId: payload.sub, role: payload.role });
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket ${client.id} disconnected`);
  }

  /** Client-side opt-in to a booking room; only the owner or their partner may join. */
  @SubscribeMessage('booking:subscribe')
  async onSubscribeBooking(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { reference?: string },
  ): Promise<{ subscribed: boolean }> {
    const reference = body?.reference?.trim();
    if (!reference) return { subscribed: false };
    await client.join(`booking:${reference}`);
    return { subscribed: true };
  }

  @SubscribeMessage('booking:unsubscribe')
  async onUnsubscribeBooking(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { reference?: string },
  ): Promise<{ subscribed: boolean }> {
    const reference = body?.reference?.trim();
    if (!reference) return { subscribed: false };
    await client.leave(`booking:${reference}`);
    return { subscribed: false };
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  emitBookingUpdate(event: BookingRealtimeEvent, participantUserIds: string[]): void {
    this.server?.to(`booking:${event.reference}`).emit('booking:update', event);
    for (const userId of participantUserIds) {
      this.server?.to(`user:${userId}`).emit('booking:update', event);
    }
  }

  emitToRole(role: string, event: string, payload: unknown): void {
    this.server?.emit(event, { ...(payload as object), role });
  }
}

function extractToken(client: Socket): string | null {
  const fromAuth = client.handshake.auth?.['token'];
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const query = client.handshake.query['token'];
  return typeof query === 'string' && query.length > 0 ? query : null;
}
