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
  recurrenceGroupId?: string | null;
  isActive: boolean; createdAt: string;
}
export interface EventRegistration {
  id: string; eventId: string; tenantId: string;
  participantName: string; parentPhone: string; parentName: string;
  notes: string; registeredAt: string;
}
export interface SubscriptionPlan {
  id: string; tenantId: string;
  name: string; description: string;
  classesPerMonth: number; price: number;
  isActive: boolean; createdAt: string;
}

export interface SpecialEvent {
  id: string; tenantId: string;
  title: string; description: string;
  durationMinutes: number;
  minCapacity?: number | null; maxCapacity?: number | null;
  price: number;
  teacherId?: string | null; teacherName?: string | null; teacherColor?: string | null;
  isActive: boolean; createdAt: string;
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

export interface ArtClassFaq {
  id: string;
  tenant_id: string;
  question: string;
  answer: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface UnansweredQuestion {
  id: string;
  tenant_id: string;
  conversation_id: string | null;
  guest_question: string;
  topic_hint: string | null;
  suggested_answer: string | null;
  status: string;
  added_faq_id: string | null;
  created_at: string;
  reviewed_at: string | null;
}
