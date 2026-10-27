/**
 * Presentation helpers that map domain enums to human labels and semantic
 * tones. Shared so the customer app, partner app and admin dashboard always
 * describe the same state the same way.
 */

import {
  AssignmentStatus,
  AuditAction,
  BookingStatus,
  DocumentStatus,
  PartnerStatus,
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
  SubscriptionStatus,
  SupportTicketStatus,
  VehicleSize,
  VehicleType,
} from './enums';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusPresentation {
  readonly label: string;
  readonly tone: Tone;
  /** Customer facing explanation, used in the booking tracker. */
  readonly description?: string;
}

export const bookingStatusPresentation: Record<BookingStatus, StatusPresentation> = {
  [BookingStatus.PENDING_PAYMENT]: { label: 'Payment pending', tone: 'warning', description: 'We are waiting for your payment confirmation.' },
  [BookingStatus.CONFIRMED]: { label: 'Confirmed', tone: 'accent', description: 'Your booking is confirmed. We are finding a wash partner.' },
  [BookingStatus.ASSIGNED]: { label: 'Partner assigned', tone: 'accent', description: 'A wash partner has been assigned to your booking.' },
  [BookingStatus.PARTNER_ACCEPTED]: { label: 'Partner on the way', tone: 'accent', description: 'Your wash partner has accepted the job.' },
  [BookingStatus.TRAVELLING]: { label: 'Travelling', tone: 'accent', description: 'Your wash partner is travelling to your location.' },
  [BookingStatus.ARRIVED]: { label: 'Arrived', tone: 'accent', description: 'Your wash partner has arrived.' },
  [BookingStatus.IN_PROGRESS]: { label: 'In progress', tone: 'accent', description: 'Your vehicle is being cleaned.' },
  [BookingStatus.COMPLETED]: { label: 'Completed', tone: 'success', description: 'Service completed. Thank you for choosing us.' },
  [BookingStatus.CANCELLED]: { label: 'Cancelled', tone: 'danger', description: 'This booking was cancelled.' },
  [BookingStatus.NO_PARTNER_FOUND]: { label: 'Partner unavailable', tone: 'danger', description: 'We could not find an available partner for this slot.' },
};

export const assignmentStatusPresentation: Record<AssignmentStatus, StatusPresentation> = {
  [AssignmentStatus.OFFERED]: { label: 'Offer sent', tone: 'warning' },
  [AssignmentStatus.ACCEPTED]: { label: 'Accepted', tone: 'accent' },
  [AssignmentStatus.REJECTED]: { label: 'Rejected', tone: 'neutral' },
  [AssignmentStatus.TIMED_OUT]: { label: 'Timed out', tone: 'neutral' },
  [AssignmentStatus.CANCELLED]: { label: 'Cancelled', tone: 'danger' },
  [AssignmentStatus.COMPLETED]: { label: 'Completed', tone: 'success' },
};

export const paymentStatusPresentation: Record<PaymentStatus, StatusPresentation> = {
  [PaymentStatus.PENDING]: { label: 'Pending', tone: 'warning' },
  [PaymentStatus.PAID]: { label: 'Paid', tone: 'success' },
  [PaymentStatus.FAILED]: { label: 'Failed', tone: 'danger' },
  [PaymentStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
  [PaymentStatus.REFUNDED]: { label: 'Refunded', tone: 'info' },
  [PaymentStatus.PARTIALLY_REFUNDED]: { label: 'Partly refunded', tone: 'info' },
};

export const refundStatusPresentation: Record<RefundStatus, StatusPresentation> = {
  [RefundStatus.REQUESTED]: { label: 'Requested', tone: 'warning' },
  [RefundStatus.APPROVED]: { label: 'Approved', tone: 'accent' },
  [RefundStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [RefundStatus.PROCESSING]: { label: 'Processing', tone: 'accent' },
  [RefundStatus.COMPLETED]: { label: 'Refunded', tone: 'success' },
  [RefundStatus.FAILED]: { label: 'Failed', tone: 'danger' },
};

export const partnerStatusPresentation: Record<PartnerStatus, StatusPresentation> = {
  [PartnerStatus.DRAFT]: { label: 'Draft', tone: 'neutral' },
  [PartnerStatus.PENDING_VERIFICATION]: { label: 'Under review', tone: 'warning' },
  [PartnerStatus.APPROVED]: { label: 'Approved', tone: 'success' },
  [PartnerStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [PartnerStatus.SUSPENDED]: { label: 'Suspended', tone: 'danger' },
};

export const documentStatusPresentation: Record<DocumentStatus, StatusPresentation> = {
  [DocumentStatus.PENDING]: { label: 'Pending', tone: 'warning' },
  [DocumentStatus.APPROVED]: { label: 'Approved', tone: 'success' },
  [DocumentStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
};

export const payoutStatusPresentation: Record<PayoutStatus, StatusPresentation> = {
  [PayoutStatus.PENDING]: { label: 'Pending', tone: 'warning' },
  [PayoutStatus.PROCESSING]: { label: 'Processing', tone: 'accent' },
  [PayoutStatus.PAID]: { label: 'Paid', tone: 'success' },
  [PayoutStatus.FAILED]: { label: 'Failed', tone: 'danger' },
};

export const subscriptionStatusPresentation: Record<SubscriptionStatus, StatusPresentation> = {
  [SubscriptionStatus.PENDING_PAYMENT]: { label: 'Payment pending', tone: 'warning' },
  [SubscriptionStatus.ACTIVE]: { label: 'Active', tone: 'success' },
  [SubscriptionStatus.PAUSED]: { label: 'Paused', tone: 'warning' },
  [SubscriptionStatus.EXPIRED]: { label: 'Expired', tone: 'neutral' },
  [SubscriptionStatus.CANCELLED]: { label: 'Cancelled', tone: 'danger' },
};

export const ticketStatusPresentation: Record<SupportTicketStatus, StatusPresentation> = {
  [SupportTicketStatus.OPEN]: { label: 'Open', tone: 'warning' },
  [SupportTicketStatus.IN_PROGRESS]: { label: 'In progress', tone: 'accent' },
  [SupportTicketStatus.WAITING_CUSTOMER]: { label: 'Waiting on customer', tone: 'info' },
  [SupportTicketStatus.RESOLVED]: { label: 'Resolved', tone: 'success' },
  [SupportTicketStatus.CLOSED]: { label: 'Closed', tone: 'neutral' },
};

export const auditActionPresentation: Record<AuditAction, string> = {
  [AuditAction.CREATE]: 'Created',
  [AuditAction.UPDATE]: 'Updated',
  [AuditAction.DELETE]: 'Deleted',
  [AuditAction.LOGIN]: 'Signed in',
  [AuditAction.LOGOUT]: 'Signed out',
  [AuditAction.STATUS_CHANGE]: 'Status changed',
  [AuditAction.ASSIGN]: 'Assigned',
  [AuditAction.APPROVE]: 'Approved',
  [AuditAction.REJECT]: 'Rejected',
  [AuditAction.REFUND]: 'Refund',
  [AuditAction.PAYOUT]: 'Payout',
  [AuditAction.EXPORT]: 'Exported',
};

export const vehicleTypeLabel: Record<VehicleType, string> = {
  [VehicleType.CAR]: 'Car',
  [VehicleType.BIKE]: 'Bike',
};

export const vehicleSizeLabel: Record<VehicleSize, string> = {
  [VehicleSize.HATCHBACK]: 'Hatchback (small car)',
  [VehicleSize.SEDAN]: 'Sedan',
  [VehicleSize.SUV]: 'SUV',
  [VehicleSize.MUV]: 'MUV / 7-seater',
  [VehicleSize.LUXURY]: 'Luxury',
  [VehicleSize.BIKE_SMALL]: 'Scooter / small bike (up to 125cc)',
  [VehicleSize.BIKE_MEDIUM]: 'Standard bike (125cc - 400cc)',
  [VehicleSize.BIKE_LARGE]: 'Superbike (400cc+)',
};

/** Vehicle sizes that belong to a vehicle type - used to drive pickers. */
export const vehicleSizesByType: Record<VehicleType, readonly VehicleSize[]> = {
  [VehicleType.CAR]: [VehicleSize.HATCHBACK, VehicleSize.SEDAN, VehicleSize.SUV, VehicleSize.MUV, VehicleSize.LUXURY],
  [VehicleType.BIKE]: [VehicleSize.BIKE_SMALL, VehicleSize.BIKE_MEDIUM, VehicleSize.BIKE_LARGE],
};

export function statusToneClass(tone: Tone): { text: string; background: string } {
  switch (tone) {
    case 'success':
      return { text: '#15803D', background: '#DCFCE7' };
    case 'warning':
      return { text: '#B45309', background: '#FEF3C7' };
    case 'danger':
      return { text: '#B91C1C', background: '#FEE2E2' };
    case 'info':
      return { text: '#0F766E', background: '#CCFBF1' };
    case 'accent':
      return { text: '#12406F', background: '#DCEAFB' };
    default:
      return { text: '#3D4A5C', background: '#E4E8EF' };
  }
}
