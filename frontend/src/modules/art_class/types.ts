export interface Specialist {
  id: string; tenantId: string; name: string; role: string;
  color: string; isActive: boolean; createdAt: string;
  workingHours: WorkingHours[];
}
export interface WorkingHours {
  id: string; specialistId: string; dayOfWeek: number;
  startTime: string; endTime: string; isWorking: boolean;
}
export interface ArtEvent {
  id: string; tenantId: string;
  teacherId?: string | null; teacherName?: string | null; teacherColor?: string | null;
  title: string; description: string;
  date: string; startTime: string; endTime: string;
  ageMin?: number | null; ageMax?: number | null;
  maxCapacity?: number | null;
  price?: number | null;
  registrationCount?: number;
  isActive: boolean; createdAt: string;
}
export interface EventRegistration {
  id: string; eventId: string; tenantId: string;
  participantName: string; parentPhone: string; parentName: string;
  notes: string; registeredAt: string;
}
export interface EventTemplate {
  id: string; tenantId: string;
  teacherId?: string | null; teacherName?: string | null; teacherColor?: string | null;
  title: string; description: string;
  ageMin?: number | null; ageMax?: number | null;
  maxCapacity?: number | null;
  price?: number | null;
  createdAt: string;
}
