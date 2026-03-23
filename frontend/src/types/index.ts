export interface Specialist {
  id: string; tenantId: string; name: string; role: string;
  color: string; isActive: boolean; createdAt: string;
  workingHours: WorkingHours[];
}
export interface WorkingHours {
  id: string; specialistId: string; dayOfWeek: number;
  startTime: string; endTime: string; isWorking: boolean;
}
export interface ServiceGroup {
  id: string; tenantId: string; name: string; sortOrder: number;
}
export interface Service {
  id: string; tenantId: string; name: string;
  durationMins: number; price: number; color: string; isActive: boolean;
  groupId?: string | null;
}
export interface Booking {
  id: string; tenantId: string;
  specialistId: string; specialistName?: string; specialistColor?: string;
  serviceId: string; serviceName?: string; serviceDurationMins?: number; servicePrice?: number;
  customerName: string; customerPhone: string;
  startsAt: string; endsAt: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes: string; createdAt: string;
  recurrenceRule?: 'none' | 'weekly' | 'biweekly' | '3weekly' | '4weekly';
  recurrenceGroupId?: string | null;
}
export interface TimeSlot { startsAt: string; endsAt: string; available: boolean; }
export type View = 'day' | 'week';

export interface ArtEvent {
  id: string; tenantId: string;
  teacherId?: string | null; teacherName?: string | null; teacherColor?: string | null;
  title: string; description: string;
  date: string; startTime: string; endTime: string;
  ageMin?: number | null; ageMax?: number | null;
  maxCapacity?: number | null;
  registrationCount?: number;
  isActive: boolean; createdAt: string;
}
export interface EventRegistration {
  id: string; eventId: string; tenantId: string;
  participantName: string; parentPhone: string; parentName: string;
  notes: string; registeredAt: string;
}
