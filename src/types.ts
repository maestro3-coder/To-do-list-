export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  uid: string;
  title: string;
  description: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm
  priority: Priority;
  completed: boolean;
  category: string;
  reminderMinutesBefore: number;
  createdAt: string;
}

export interface Note {
  id: string;
  uid: string;
  taskId?: string;
  content: string;
  lastUpdated: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  settings: {
    darkMode: boolean;
    notificationsEnabled: boolean;
  };
}
