// ---------------------------------------------------------------------------
// Core domain types — mirrored in frontend/src/types/index.ts
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  name: string;
  type: 'barbershop' | 'salon' | 'dentist' | 'medical' | 'hotel' | 'happy_restaurant' | 'happy_bar' | 'happy_hybrid';
  timezone: string;
  createdAt: string;
}

export interface Specialist {
  id: string;
  tenantId: string;
  name: string;
  role: string;
  color: string; // hex — used in calendar view
  isActive: boolean;
  createdAt: string;
}

export interface WorkingHours {
  id: string;
  specialistId: string;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday … 6 = Saturday
  startTime: string; // "09:00"
  endTime: string;   // "18:00"
  isWorking: boolean;
}

export interface Service {
  id: string;
  tenantId: string;
  name: string;
  durationMins: number;
  price: number;
  color: string;
  isActive: boolean;
}

export interface Booking {
  id: string;
  tenantId: string;
  specialistId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  startsAt: string;  // ISO 8601
  endsAt: string;    // ISO 8601
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes: string;
  createdAt: string;
  // Joined fields
  specialistName?: string;
  specialistColor?: string;
  serviceName?: string;
  serviceDurationMins?: number;
  servicePrice?: number;
}

export interface TimeSlot {
  startsAt: string;  // ISO 8601
  endsAt: string;
  available: boolean;
}

export interface AvailabilityResponse {
  date: string;
  specialistId: string;
  slots: TimeSlot[];
}

// API response wrappers
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
