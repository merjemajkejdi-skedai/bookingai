export interface Zone {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  color: string;
  maxConcurrent: number;
  tableCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface RestaurantTable {
  id: string;
  tenantId: string;
  zoneId: string;
  name: string;
  seats: number;
  isActive: boolean;
  createdAt: string;
}

export interface Reservation {
  id: string;
  tenantId: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  tableId: string | null;
  tableName: string | null;
  tableSeats: number | null;
  guestName: string;
  guestPhone: string;
  guestCount: number;
  date: string;
  time: string;
  durationMins: number;
  notes: string;
  status: string;
  createdAt: string;
}

export interface ZoneAvailability {
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  maxConcurrent: number;
  currentCount: number;
  available: boolean;
}
