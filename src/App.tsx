import React, { useState, useEffect, useMemo } from 'react';
import { auth, db, signInWithGoogle, logout, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocFromServer } from 'firebase/firestore';
import { Task, Note, Priority } from './types';
import { 
  CheckCircle2, 
  Circle, 
  Plus, 
  Calendar as CalendarIcon, 
  LayoutDashboard, 
  StickyNote, 
  Settings, 
  LogOut, 
  Search, 
  Bell, 
  Clock, 
  AlertCircle,
  Menu,
  X,
  Mic,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Trash2,
  Edit2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isToday, isFuture, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, differenceInMinutes } from 'date-fns';
import { Toaster, toast } from 'sonner';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getTaskSuggestions, getVoiceTaskParse } from './lib/gemini';

// --- Components ---

const PriorityBadge = ({ priority }: { priority: Priority }) => {
  const colors = {
    low: 'bg-stone-100 text-stone-700 border-stone-200',
    medium: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    high: 'bg-rose-100 text-rose-700 border-rose-200'
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${colors[priority]}`}>
      {priority}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tasks' | 'calendar' | 'notes' | 'settings'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isVoiceLoading, setIsVoiceLoading] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Connection Test
  useEffect(() => {
    if (user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Firebase connection error: Client is offline.");
          }
        }
      };
      testConnection();
    }
  }, [user]);

  // Data Listeners
  useEffect(() => {
    if (!user) {
      setTasks([]);
      setNotes([]);
      return;
    }

    const tasksQuery = query(collection(db, 'tasks'), where('uid', '==', user.uid));
    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const taskData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      setTasks(taskData.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()));
    }, (error) => {
      console.error("Firestore Tasks Error:", error);
    });

    const notesQuery = query(collection(db, 'notes'), where('uid', '==', user.uid));
    const unsubscribeNotes = onSnapshot(notesQuery, (snapshot) => {
      const noteData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note));
      setNotes(noteData);
    }, (error) => {
      console.error("Firestore Notes Error:", error);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeNotes();
    };
  }, [user]);

  // Notifications Check
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      const now = new Date();
      tasks.forEach(task => {
        if (!task.completed && task.dueDate && task.dueTime) {
          const taskTime = parseISO(`${task.dueDate}T${task.dueTime}`);
          const diff = differenceInMinutes(taskTime, now);
          if (diff === task.reminderMinutesBefore && diff > 0) {
            toast.info(`Reminder: ${task.title} in ${diff} minutes!`, {
              description: task.description,
              icon: <Bell className="w-4 h-4" />
            });
            if (Notification.permission === 'granted') {
              new Notification(`ZenTask: ${task.title}`, {
                body: `Starts in ${diff} minutes.`,
                icon: '/favicon.ico'
              });
            }
          }
        }
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [tasks, user]);

  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithGoogle();
      toast.success("Welcome back!");
      setUser(result.user);
      setIsAuthReady(true);
    } catch (error) {
      console.error("Google Login Error:", error);
      toast.error("Login failed");
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuthLoading) return;
    setIsAuthLoading(true);
    console.log("Starting email auth...", { authMode, email });
    try {
      let userCredential;
      if (authMode === 'signup') {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        console.log("User created:", userCredential.user.uid);
        await updateProfile(userCredential.user, { displayName: name });
        
        // Create user document in Firestore
        try {
          const { setDoc, doc } = await import('firebase/firestore');
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            uid: userCredential.user.uid,
            email: userCredential.user.email,
            displayName: name,
            photoURL: userCredential.user.photoURL || '',
            settings: {
              darkMode: false,
              notificationsEnabled: true
            },
            createdAt: new Date().toISOString()
          });
          console.log("User doc created");
        } catch (fsError) {
          console.error("Failed to create user doc:", fsError);
        }
        
        toast.success("Account created successfully!");
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
        console.log("User signed in:", userCredential.user.uid);
        toast.success("Welcome back!");
      }
      
      // Manually set user to ensure immediate UI update
      setUser(userCredential.user);
      setIsAuthReady(true);
      
    } catch (error: any) {
      console.error("Auth Error Details:", error);
      if (error.code === 'auth/operation-not-allowed') {
        toast.error("Email/Password sign-in is not enabled in Firebase Console. Please enable it in the Authentication tab.");
      } else if (error.code === 'auth/email-already-in-use') {
        toast.error("An account already exists with this email.");
      } else if (error.code === 'auth/weak-password') {
        toast.error("Password should be at least 6 characters.");
      } else if (error.code === 'auth/invalid-email') {
        toast.error("Please enter a valid email address.");
      } else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        toast.error("Invalid email or password.");
      } else {
        toast.error(error.message || "Authentication failed. Please try again.");
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleAddTask = async (taskData: Partial<Task>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        ...taskData,
        uid: user.uid,
        completed: false,
        createdAt: new Date().toISOString()
      });
      setIsTaskModalOpen(false);
      toast.success("Task added!");
    } catch (error) {
      toast.error("Failed to add task");
    }
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), updates);
    } catch (error) {
      toast.error("Update failed");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
      toast.success("Task deleted");
    } catch (error) {
      toast.error("Delete failed");
    }
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           t.category?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = taskFilter === 'all' ? true :
                           taskFilter === 'completed' ? t.completed : !t.completed;
      const matchesCategory = categoryFilter === 'all' ? true : t.category === categoryFilter;
      return matchesSearch && matchesFilter && matchesCategory;
    });
  }, [tasks, searchQuery, taskFilter, categoryFilter]);

  const categories = useMemo(() => {
    const cats = new Set(tasks.map(t => t.category).filter(Boolean));
    return Array.from(cats);
  }, [tasks]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const pending = total - completed;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pending, percent };
  }, [tasks]);

  if (!isAuthReady) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-stone-50">
        <motion.div 
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="w-12 h-12 border-4 border-stone-900 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-stone-50 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full space-y-8"
        >
          <div className="text-center space-y-2">
            <h1 className="text-5xl font-serif italic tracking-tight text-stone-900">ZenTask</h1>
            <p className="text-stone-500 font-sans">Minimal productivity for the focused mind.</p>
          </div>

          <div className="bg-white p-8 rounded-[32px] shadow-xl shadow-stone-200 border border-stone-100 space-y-6">
            <div className="flex p-1 bg-stone-100 rounded-2xl">
              <button 
                onClick={() => setAuthMode('login')}
                className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${authMode === 'login' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
              >
                Login
              </button>
              <button 
                onClick={() => setAuthMode('signup')}
                className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${authMode === 'signup' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              {authMode === 'signup' && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-stone-400 px-1">Full Name</label>
                  <input 
                    type="text" 
                    required 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-stone-200" 
                    placeholder="John Doe"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider font-bold text-stone-400 px-1">Email Address</label>
                <input 
                  type="email" 
                  required 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-stone-200" 
                  placeholder="name@example.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider font-bold text-stone-400 px-1">Password</label>
                <input 
                  type="password" 
                  required 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-stone-200" 
                  placeholder="••••••••"
                />
              </div>
              <button 
                type="submit"
                disabled={isAuthLoading}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-lg shadow-indigo-100"
              >
                {isAuthLoading ? 'Processing...' : authMode === 'login' ? 'Login' : 'Create Account'}
              </button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-stone-100"></div></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-stone-400 font-bold tracking-widest">Or continue with</span></div>
            </div>

            <button 
              onClick={handleGoogleLogin}
              className="w-full py-3 bg-white border border-stone-200 text-stone-700 rounded-xl font-medium flex items-center justify-center gap-3 hover:bg-indigo-50 hover:border-indigo-200 transition-all"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              Google
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-stone-50 flex overflow-hidden font-sans text-stone-900">
      <Toaster position="top-right" richColors />
      
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 80 }}
        className="bg-white border-r border-stone-200 flex flex-col z-20"
      >
        <div className="p-6 flex items-center justify-between">
          {isSidebarOpen && <h2 className="font-serif italic text-2xl">ZenTask</h2>}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-stone-100 rounded-lg transition-colors">
            {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <NavItem icon={<LayoutDashboard />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} collapsed={!isSidebarOpen} />
          <NavItem icon={<CheckCircle2 />} label="Tasks" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} collapsed={!isSidebarOpen} />
          <NavItem icon={<CalendarIcon />} label="Calendar" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} collapsed={!isSidebarOpen} />
          <NavItem icon={<StickyNote />} label="Notes" active={activeTab === 'notes'} onClick={() => setActiveTab('notes')} collapsed={!isSidebarOpen} />
        </nav>

        <div className="p-4 border-t border-stone-100 space-y-2">
          <NavItem icon={<Settings />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} collapsed={!isSidebarOpen} />
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 text-stone-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all group"
          >
            <LogOut className="w-5 h-5" />
            {isSidebarOpen && <span className="font-medium">Logout</span>}
          </button>
          
          {isSidebarOpen && (
            <div className="mt-4 p-4 bg-stone-50 rounded-2xl flex items-center gap-3">
              <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border-2 border-white shadow-sm" alt="User" />
              <div className="overflow-hidden">
                <p className="text-sm font-semibold truncate">{user.displayName}</p>
                <p className="text-xs text-stone-400 truncate">{user.email}</p>
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header */}
        <header className="h-20 bg-white/80 backdrop-blur-md border-bottom border-stone-200 px-8 flex items-center justify-between sticky top-0 z-10">
          <div className="flex-1 max-w-xl relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input 
              type="text" 
              placeholder="Search tasks, categories..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 bg-stone-100 border-none rounded-2xl focus:ring-2 focus:ring-stone-200 transition-all text-sm"
            />
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2.5 hover:bg-stone-100 rounded-full relative">
              <Bell className="w-5 h-5 text-stone-600" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-white"></span>
            </button>
            <button 
              onClick={() => { setEditingTask(null); setIsTaskModalOpen(true); }}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-2xl font-medium flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatCard title="Task Progress" value={`${stats.percent}%`} subValue={`${stats.completed}/${stats.total} completed`} chart={<ProgressChart percent={stats.percent} />} />
                  <StatCard title="Upcoming" value={tasks.filter(t => !t.completed && isFuture(parseISO(t.dueDate))).length.toString()} subValue="Next 7 days" icon={<Clock className="text-indigo-500" />} />
                  <StatCard title="Priority Tasks" value={tasks.filter(t => !t.completed && t.priority === 'high').length.toString()} subValue="High urgency" icon={<AlertCircle className="text-rose-500" />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-serif italic">Today's Focus</h3>
                      <button onClick={() => setActiveTab('tasks')} className="text-sm text-stone-400 hover:text-stone-900">View all</button>
                    </div>
                    <div className="space-y-3">
                      {tasks.filter(t => isToday(parseISO(t.dueDate))).length > 0 ? (
                        tasks.filter(t => isToday(parseISO(t.dueDate))).map(task => (
                          <TaskItem key={task.id} task={task} onToggle={() => handleUpdateTask(task.id, { completed: !task.completed })} onEdit={() => { setEditingTask(task); setIsTaskModalOpen(true); }} onDelete={() => handleDeleteTask(task.id)} />
                        ))
                      ) : (
                        <div className="p-8 bg-white rounded-3xl border border-dashed border-stone-200 text-center space-y-2">
                          <p className="text-stone-400 text-sm">No tasks for today. Take a breath.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-serif italic">Quick Notes</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {notes.slice(0, 4).map(note => (
                        <div key={note.id} className="p-4 bg-white rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all cursor-pointer h-32 overflow-hidden relative group">
                          <div className="text-xs text-stone-400 mb-2">{format(parseISO(note.lastUpdated), 'MMM d')}</div>
                          <div className="text-sm text-stone-600 line-clamp-3" dangerouslySetInnerHTML={{ __html: note.content }} />
                          <div className="absolute inset-0 bg-stone-900/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Edit2 className="w-4 h-4 text-stone-900" />
                          </div>
                        </div>
                      ))}
                      <button 
                        onClick={() => setActiveTab('notes')}
                        className="p-4 rounded-3xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center gap-2 text-stone-400 hover:border-stone-900 hover:text-stone-900 transition-all h-32"
                      >
                        <Plus className="w-6 h-6" />
                        <span className="text-sm font-medium">New Note</span>
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'tasks' && (
              <motion.div 
                key="tasks"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h2 className="text-3xl font-serif italic">All Tasks</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <FilterButton label="All" active={taskFilter === 'all'} onClick={() => setTaskFilter('all')} />
                    <FilterButton label="Pending" active={taskFilter === 'pending'} onClick={() => setTaskFilter('pending')} />
                    <FilterButton label="Completed" active={taskFilter === 'completed'} onClick={() => setTaskFilter('completed')} />
                    <div className="w-px h-4 bg-stone-200 mx-1 hidden sm:block" />
                    <select 
                      value={categoryFilter} 
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="text-xs font-medium bg-white border border-stone-200 rounded-full px-3 py-1.5 text-stone-500 focus:ring-1 focus:ring-indigo-600 outline-none hover:border-indigo-600 transition-all"
                    >
                      <option value="all">All Categories</option>
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {filteredTasks.length > 0 ? (
                    filteredTasks.map(task => (
                      <TaskItem key={task.id} task={task} onToggle={() => handleUpdateTask(task.id, { completed: !task.completed })} onEdit={() => { setEditingTask(task); setIsTaskModalOpen(true); }} onDelete={() => handleDeleteTask(task.id)} />
                    ))
                  ) : (
                    <div className="p-12 bg-white rounded-[32px] border border-dashed border-stone-200 text-center space-y-3">
                      <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-8 h-8 text-stone-200" />
                      </div>
                      <div>
                        <p className="text-stone-900 font-medium">
                          {taskFilter === 'all' ? 'No tasks found' : 
                           taskFilter === 'completed' ? 'No completed tasks yet' : 
                           'No pending tasks. You\'re all caught up!'}
                        </p>
                        <p className="text-stone-400 text-sm">
                          {taskFilter === 'completed' ? 'Tasks you finish will appear here.' : 'Try adding a new task to get started.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'calendar' && (
              <motion.div 
                key="calendar"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white rounded-3xl p-8 shadow-sm border border-stone-100"
              >
                <div className="flex flex-col md:flex-row gap-8">
                  <div className="flex-1">
                    <Calendar 
                      className="w-full border-none font-sans"
                      tileContent={({ date }) => {
                        const dayTasks = tasks.filter(t => isSameDay(parseISO(t.dueDate), date));
                        return dayTasks.length > 0 ? (
                          <div className="flex justify-center mt-1 gap-0.5">
                            {dayTasks.slice(0, 3).map(t => (
                              <div key={t.id} className={`w-1.5 h-1.5 rounded-full ${t.priority === 'high' ? 'bg-rose-500' : t.priority === 'medium' ? 'bg-indigo-500' : 'bg-stone-400'}`} />
                            ))}
                          </div>
                        ) : null;
                      }}
                    />
                  </div>
                  <div className="w-full md:w-80 space-y-4">
                    <h4 className="font-serif italic text-lg">Schedule</h4>
                    <div className="space-y-3">
                      {tasks.slice(0, 5).map(task => (
                        <div key={task.id} className="flex items-center gap-3 p-3 bg-stone-50 rounded-2xl border border-stone-100">
                          <div className={`w-2 h-10 rounded-full ${task.priority === 'high' ? 'bg-rose-400' : 'bg-stone-300'}`} />
                          <div>
                            <p className="text-sm font-semibold truncate w-48">{task.title}</p>
                            <p className="text-xs text-stone-400">{task.dueTime} • {format(parseISO(task.dueDate), 'MMM d')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'notes' && (
              <motion.div 
                key="notes"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-6"
              >
                <div className="md:col-span-1 space-y-4">
                  <button 
                    onClick={async () => {
                      const newNote = { uid: user.uid, content: '<p>New Note...</p>', lastUpdated: new Date().toISOString() };
                      await addDoc(collection(db, 'notes'), newNote);
                    }}
                    className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-medium flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                  >
                    <Plus className="w-4 h-4" /> New Note
                  </button>
                  <div className="space-y-2">
                    {notes.map(note => (
                      <div 
                        key={note.id} 
                        className="p-4 bg-white rounded-2xl border border-stone-100 shadow-sm cursor-pointer hover:border-stone-900 transition-all"
                        onClick={() => {/* Select note */}}
                      >
                        <p className="text-sm font-medium line-clamp-1" dangerouslySetInnerHTML={{ __html: note.content.substring(0, 50) }} />
                        <p className="text-[10px] text-stone-400 mt-1 uppercase tracking-wider">{format(parseISO(note.lastUpdated), 'MMM d, h:mm a')}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2 bg-white rounded-3xl p-6 shadow-sm border border-stone-100 min-h-[500px]">
                  <ReactQuill theme="snow" className="h-[400px]" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Task Modal */}
      <AnimatePresence>
        {isTaskModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsTaskModalOpen(false)}
              className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative overflow-hidden"
            >
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const data = {
                  title: formData.get('title') as string,
                  description: formData.get('description') as string,
                  dueDate: formData.get('dueDate') as string,
                  dueTime: formData.get('dueTime') as string,
                  priority: formData.get('priority') as Priority,
                  category: formData.get('category') as string,
                  reminderMinutesBefore: parseInt(formData.get('reminder') as string) || 0,
                };
                if (editingTask) {
                  handleUpdateTask(editingTask.id, data);
                  toast.success("Task updated");
                } else {
                  handleAddTask(data);
                }
                setIsTaskModalOpen(false);
              }} className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-serif italic">{editingTask ? 'Edit Task' : 'New Task'}</h3>
                  <button type="button" onClick={() => setIsTaskModalOpen(false)} className="p-2 hover:bg-stone-100 rounded-full">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="relative">
                    <input 
                      name="title"
                      required
                      placeholder="What needs to be done?" 
                      defaultValue={editingTask?.title}
                      className="w-full text-xl font-medium border-none focus:ring-0 p-0 placeholder:text-stone-300"
                    />
                    <button 
                      type="button"
                      onClick={async () => {
                        const title = (document.getElementsByName('title')[0] as HTMLInputElement).value;
                        if (!title) return;
                        toast.promise(getTaskSuggestions(title), {
                          loading: 'AI is thinking...',
                          success: (data) => {
                            if (data) {
                              (document.getElementsByName('description')[0] as HTMLTextAreaElement).value = data.description || '';
                              (document.getElementsByName('priority')[0] as HTMLSelectElement).value = data.priority || 'medium';
                              (document.getElementsByName('category')[0] as HTMLInputElement).value = data.category || '';
                            }
                            return 'AI suggestions applied!';
                          },
                          error: 'AI failed to suggest'
                        });
                      }}
                      className="absolute right-0 top-0 p-2 text-stone-400 hover:text-stone-900 transition-colors"
                      title="AI Suggestion"
                    >
                      <Sparkles className="w-5 h-5" />
                    </button>
                  </div>

                  <textarea 
                    name="description"
                    placeholder="Add notes or description..." 
                    defaultValue={editingTask?.description}
                    className="w-full bg-stone-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-stone-200 min-h-[100px] resize-none"
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider font-bold text-stone-400 px-1">Due Date</label>
                      <input name="dueDate" type="date" required defaultValue={editingTask?.dueDate || format(new Date(), 'yyyy-MM-dd')} className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider font-bold text-stone-400 px-1">Time</label>
                      <input name="dueTime" type="time" required defaultValue={editingTask?.dueTime || '09:00'} className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider font-bold text-stone-400 px-1">Priority</label>
                      <select name="priority" defaultValue={editingTask?.priority || 'medium'} className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider font-bold text-stone-400 px-1">Category</label>
                      <input name="category" placeholder="e.g. Work" defaultValue={editingTask?.category} className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider font-bold text-stone-400 px-1">Reminder</label>
                      <select name="reminder" defaultValue={editingTask?.reminderMinutesBefore || 0} className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm">
                        <option value="0">None</option>
                        <option value="5">5 mins before</option>
                        <option value="30">30 mins before</option>
                        <option value="60">1 hour before</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-between">
                  <button 
                    type="button"
                    disabled={isVoiceLoading}
                    onClick={() => {
                      const recognition = new (window as any).webkitSpeechRecognition();
                      recognition.onstart = () => { setIsVoiceLoading(true); toast.info("Listening..."); };
                      recognition.onresult = async (event: any) => {
                        const transcript = event.results[0][0].transcript;
                        const parsed = await getVoiceTaskParse(transcript);
                        if (parsed) {
                          (document.getElementsByName('title')[0] as HTMLInputElement).value = parsed.title || '';
                          (document.getElementsByName('description')[0] as HTMLTextAreaElement).value = parsed.description || '';
                          (document.getElementsByName('dueDate')[0] as HTMLInputElement).value = parsed.dueDate || format(new Date(), 'yyyy-MM-dd');
                          (document.getElementsByName('dueTime')[0] as HTMLInputElement).value = parsed.dueTime || '09:00';
                          (document.getElementsByName('priority')[0] as HTMLSelectElement).value = parsed.priority || 'medium';
                          (document.getElementsByName('category')[0] as HTMLInputElement).value = parsed.category || '';
                        }
                        setIsVoiceLoading(false);
                      };
                      recognition.start();
                    }}
                    className="p-3 bg-stone-100 text-stone-600 rounded-2xl hover:bg-stone-200 transition-all"
                  >
                    <Mic className={`w-5 h-5 ${isVoiceLoading ? 'animate-pulse text-rose-500' : ''}`} />
                  </button>
                  <button type="submit" className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-medium hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">
                    {editingTask ? 'Save Changes' : 'Create Task'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

const NavItem = ({ icon, label, active, onClick, collapsed }: any) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group ${
      active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-stone-500 hover:bg-indigo-50 hover:text-indigo-600'
    }`}
  >
    <span className="w-5 h-5">{icon}</span>
    {!collapsed && <span className="font-medium">{label}</span>}
  </button>
);

const StatCard = ({ title, value, subValue, icon, chart }: any) => (
  <div className="bg-white p-6 rounded-[32px] border border-stone-100 shadow-sm flex items-center justify-between group hover:shadow-md transition-all">
    <div className="space-y-1">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-400">{title}</p>
      <p className="text-3xl font-serif italic text-stone-900">{value}</p>
      <p className="text-xs text-stone-400">{subValue}</p>
    </div>
    <div className="w-16 h-16 flex items-center justify-center">
      {chart || <div className="p-3 bg-stone-50 rounded-2xl">{icon}</div>}
    </div>
  </div>
);

const ProgressChart = ({ percent }: { percent: number }) => {
  const data = [
    { name: 'Completed', value: percent },
    { name: 'Remaining', value: 100 - percent }
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} innerRadius={20} outerRadius={30} paddingAngle={5} dataKey="value">
          <Cell fill="#4f46e5" />
          <Cell fill="#eef2ff" />
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
};

const TaskItem = ({ task, onToggle, onEdit, onDelete }: { task: Task, onToggle: () => void | Promise<void>, onEdit: () => void, onDelete: () => void | Promise<void>, key?: any }) => (
  <motion.div 
    layout
    initial={{ opacity: 0, y: 5 }}
    animate={{ opacity: 1, y: 0 }}
    className={`group flex items-center gap-4 p-4 bg-white rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all ${task.completed ? 'opacity-60' : ''}`}
  >
    <button onClick={onToggle} className="text-stone-400 hover:text-stone-900 transition-colors">
      {task.completed ? <CheckCircle2 className="w-6 h-6 text-stone-900" /> : <Circle className="w-6 h-6" />}
    </button>
    <div className="flex-1 min-w-0" onClick={onEdit}>
      <div className="flex items-center gap-2 mb-0.5">
        <h4 className={`font-semibold truncate ${task.completed ? 'line-through text-stone-400' : 'text-stone-900'}`}>
          {task.title}
        </h4>
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="flex items-center gap-3 text-xs text-stone-400">
        <span className="flex items-center gap-1"><CalendarIcon className="w-3 h-3" /> {format(parseISO(task.dueDate), 'MMM d')}</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {task.dueTime}</span>
        {task.category && <span className="px-1.5 py-0.5 bg-indigo-50 rounded text-indigo-600 font-medium">{task.category}</span>}
      </div>
    </div>
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={onEdit} className="p-2 hover:bg-stone-50 rounded-lg text-stone-400 hover:text-stone-900">
        <Edit2 className="w-4 h-4" />
      </button>
      <button onClick={onDelete} className="p-2 hover:bg-rose-50 rounded-lg text-stone-400 hover:text-rose-600">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  </motion.div>
);

const FilterButton = ({ label, active, onClick }: any) => (
  <button 
    onClick={onClick}
    className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
    active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-stone-500 border border-stone-200 hover:border-indigo-600 hover:text-indigo-600'
  }`}>
    {label}
  </button>
);
