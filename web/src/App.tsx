import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Clock3, FileText, Globe2, GraduationCap, LayoutDashboard, LogOut, Menu,
  Plus, Search, Settings2, ShieldCheck, Sparkles, UserRound, Users, X,
} from "lucide-react";

type Role = "student" | "staff" | "admin";
type User = { id: number; email: string; username: string; role: Role; is_active: boolean };
type TokenResponse = { access_token: string; refresh_token: string; user: User };
type University = {
  id: number; name: string; country: string; city: string; description: string;
  website?: string | null; contact_email: string; is_approved: boolean; review_status: string;
};
type Program = {
  id: number; university_id: number; name: string; degree: string; subject: string;
  language: string; tuition: number; currency: string; intake: string; deadline?: string | null;
  requirements: Record<string, number>; description: string; is_active: boolean;
};
type Application = {
  id: number; student_id: number; program_id: number; intake: string; status: string;
  personal_statement: string; eligibility: { eligible?: boolean; requirements?: Record<string, { required: number; student_score?: number; meets_requirement: boolean }>; disclaimer?: string };
  submitted_at?: string | null; created_at: string;
};
type Achievement = { id: number; category: string; title: string; score?: number | null; awarded_at?: string | null; issuer?: string | null; notes?: string | null };
type ApplicationDocument = { id: number; application_id: number; filename: string; content_type: string; size_bytes: number; is_verified: boolean; verified_by?: number | null; created_at: string };
type ApplicationReview = { id: number; actor_id: number; action: string; from_status: string; to_status: string; created_at: string };
type Profile = { id: number; user_id: number; first_name: string; last_name: string; date_of_birth?: string | null; country: string; phone?: string | null; education_level?: string | null };
type Notification = { id: number; title: string; message: string; is_read: boolean; created_at: string };
type AdminStats = { users: number; students: number; staff: number; universities: number; pending_universities: number; programs: number; applications: number };

const apiRoot = "/api";
let accessTokenListener: ((token: string | null) => void) | null = null;
let refreshInFlight: Promise<TokenResponse> | null = null;

function clearStoredTokens() {
  localStorage.removeItem("uniapply_token");
  localStorage.removeItem("uniapply_refresh_token");
  accessTokenListener?.(null);
}

function refreshTokens(): Promise<TokenResponse> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = localStorage.getItem("uniapply_refresh_token");
      if (!refreshToken) {
        clearStoredTokens();
        throw new Error("Sessiya tugagan. Iltimos, qayta kiring.");
      }
      const response = await fetch(`${apiRoot}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        if (response.status === 401) clearStoredTokens();
        let message = `Sessiyani yangilab bo‘lmadi (${response.status})`;
        try {
          const body = await response.json();
          if (typeof body.detail === "string") message = body.detail;
        } catch { /* Error responses can be empty. */ }
        throw new Error(message);
      }
      const tokens = await response.json() as TokenResponse;
      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error("Sessiyani yangilashda yaroqsiz javob olindi");
      }
      localStorage.setItem("uniapply_token", tokens.access_token);
      localStorage.setItem("uniapply_refresh_token", tokens.refresh_token);
      accessTokenListener?.(tokens.access_token);
      return tokens;
    })().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function fetchWithRefresh(url: string, options: RequestInit, token?: string | null): Promise<Response> {
  let response = await fetch(url, options);
  if (response.status === 401 && token) {
    const refreshed = await refreshTokens();
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${refreshed.access_token}`);
    response = await fetch(url, { ...options, headers });
  }
  return response;
}

const API = {
  setTokenListener(listener: ((token: string | null) => void) | null) {
    accessTokenListener = listener;
  },
  fetch(path: string, options: RequestInit = {}, token?: string | null) {
    const headers = new Headers(options.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const requestToken = token ?? (headers.has("Authorization") ? localStorage.getItem("uniapply_token") : null);
    return fetchWithRefresh(`${apiRoot}${path}`, { ...options, headers }, requestToken);
  },
  async request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
    const headers = new Headers(options.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetchWithRefresh(`${apiRoot}${path}`, { ...options, headers }, token);
    if (!response.ok) {
      let message = `So‘rov bajarilmadi (${response.status})`;
      try {
        const body = await response.json();
        if (typeof body.detail === "string") message = body.detail;
        else if (Array.isArray(body.detail)) message = body.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(", ");
      } catch { /* Error responses can be empty. */ }
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  },
  get<T>(path: string, token?: string | null) { return this.request<T>(path, {}, token); },
  post<T>(path: string, body: unknown, token?: string | null) { return this.request<T>(path, { method: "POST", body: JSON.stringify(body) }, token); },
  patch<T>(path: string, body: unknown, token?: string | null) { return this.request<T>(path, { method: "PATCH", body: JSON.stringify(body) }, token); },
  del<T>(path: string, token?: string | null) { return this.request<T>(path, { method: "DELETE" }, token); },
};

const navLabels: Record<string, string> = {
  overview: "Umumiy ko‘rinish", explore: "Universitetlar", applications: "Arizalar",
  profile: "Mening profilim", achievements: "Yutuqlarim", review: "Arizalarni ko‘rish",
  programs: "Dasturlar", users: "Foydalanuvchilar", universities: "Universitetlar",
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function dateLabel(value?: string | null) {
  if (!value) return "Belgilanmagan";
  return new Date(value).toLocaleDateString("uz-UZ", { day: "numeric", month: "short", year: "numeric" });
}

function statusName(status: string) {
  const labels: Record<string, string> = {
    draft: "Qoralama", submitted: "Yuborilgan", under_review: "Ko‘rib chiqilmoqda",
    information_requested: "Ma’lumot so‘ralgan", accepted: "Qabul qilindi",
    rejected: "Rad etildi", withdrawn: "Qaytarib olingan",
  };
  return labels[status] || status;
}

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("uniapply_token"));
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState("overview");
  const [universities, setUniversities] = useState<University[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [pendingUniversities, setPendingUniversities] = useState<University[]>([]);
  const [staffApplications, setStaffApplications] = useState<Application[]>([]);
  const [reviewStats, setReviewStats] = useState<{ total: number; by_status: Record<string, number> } | null>(null);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot" | "staff" | "admin-setup" | null>(null);
  const [adminSetupAvailable, setAdminSetupAvailable] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [modal, setModal] = useState<"program" | "achievement" | "university" | "invite" | null>(null);
  const [activeProgram, setActiveProgram] = useState<Program | null>(null);
  const [authStep, setAuthStep] = useState<"details" | "verified">("details");
  const [registerForm, setRegisterForm] = useState({ email: "", code: "", username: "", password: "", first_name: "", last_name: "" });
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [forgotForm, setForgotForm] = useState({ email: "", code: "", new_password: "" });
  const [staffAcceptForm, setStaffAcceptForm] = useState({ token: "", username: "", password: "", first_name: "", last_name: "" });
  const [adminSetupForm, setAdminSetupForm] = useState({ setup_token: "", email: "", username: "", password: "", first_name: "", last_name: "" });
  const [profileForm, setProfileForm] = useState({ first_name: "", last_name: "", date_of_birth: "", country: "", phone: "", education_level: "" });
  const [achievementForm, setAchievementForm] = useState({ category: "IELTS", title: "", score: "", awarded_at: "", issuer: "", notes: "" });
  const [programForm, setProgramForm] = useState({ name: "", degree: "Bachelor", subject: "", language: "English", tuition: "", currency: "USD", intake: "", deadline: "", requirements: "", description: "" });
  const [universityForm, setUniversityForm] = useState({ name: "", country: "Uzbekistan", city: "", contact_email: "", website: "", description: "" });
  const [inviteForm, setInviteForm] = useState({ email: "", university_id: "" });
  const [reviewComments, setReviewComments] = useState<Record<number, string>>({});
  const [selectedApplication, setSelectedApplication] = useState<number | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3600);
  }, []);

  const fail = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : "Xatolik yuz berdi"), []);

  const loadPublic = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (country) params.set("country", country);
      const [unis, items] = await Promise.all([
        API.get<University[]>(`/universities${params.size ? `?${params}` : ""}`),
        API.get<Program[]>("/programs"),
      ]);
      setUniversities(unis);
      setPrograms(items);
    } catch (reason) { fail(reason); }
  }, [query, country, fail]);

  const loadUserData = useCallback(async (accessToken: string, currentUser: User) => {
    const tasks: Promise<unknown>[] = [];
    if (currentUser.role === "student") {
      tasks.push(API.get<Profile>("/students/me", accessToken).then((data) => {
        setProfile(data);
        setProfileForm({
          first_name: data.first_name || "", last_name: data.last_name || "",
          date_of_birth: data.date_of_birth || "", country: data.country || "",
          phone: data.phone || "", education_level: data.education_level || "",
        });
      }));
      tasks.push(API.get<Achievement[]>("/students/me/achievements", accessToken).then(setAchievements));
      tasks.push(API.get<Application[]>("/applications", accessToken).then(setApplications));
    } else if (currentUser.role === "staff") {
      tasks.push(API.get<Application[]>("/applications/review-queue", accessToken).then(setStaffApplications));
      tasks.push(API.get<{ total: number; by_status: Record<string, number> }>("/applications/reviews/statistics", accessToken).then(setReviewStats));
    } else {
      tasks.push(API.get<AdminStats>("/admin/statistics", accessToken).then(setAdminStats));
      tasks.push(API.get<User[]>("/admin/users", accessToken).then(setAdminUsers));
      tasks.push(API.get<University[]>("/admin/universities/pending", accessToken).then(setPendingUniversities));
    }
    tasks.push(API.get<Notification[]>("/notifications", accessToken).then(setNotifications));
    tasks.push(API.get<{ unread_count: number }>("/notifications/unread-count", accessToken).then((data) => setUnreadCount(data.unread_count)));
    await Promise.allSettled(tasks);
  }, []);

  useEffect(() => {
    API.setTokenListener(setToken);
    return () => API.setTokenListener(null);
  }, []);

  useEffect(() => {
    loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    API.get<{ available: boolean }>("/auth/admin-setup")
      .then((result) => setAdminSetupAvailable(result.available))
      .catch(() => setAdminSetupAvailable(false));
  }, []);

  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      setStaffAcceptForm((current) => ({ ...current, token: invite }));
      setAuthMode("staff");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    API.get<User>("/auth/me", token).then((currentUser) => {
      setUser(currentUser);
      void loadUserData(token, currentUser);
    }).catch(() => {
      clearStoredTokens();
      setToken(null);
      setUser(null);
    });
  }, [token, loadUserData]);

  useEffect(() => {
    if (user?.role === "staff" && page === "programs") {
      API.get<Program[]>("/programs").then(setPrograms).catch(fail);
    }
  }, [page, user, fail]);

  useEffect(() => {
    if (user?.role === "admin" && page === "universities") {
      API.get<University[]>("/universities").then(setUniversities).catch(fail);
    }
  }, [page, user, fail]);

  const filteredPrograms = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return programs;
    return programs.filter((program) =>
      `${program.name} ${program.subject} ${program.degree}`.toLowerCase().includes(normalized)
      || universities.find((university) => university.id === program.university_id)?.name.toLowerCase().includes(normalized),
    );
  }, [programs, universities, query]);

  const completeLogin = (result: TokenResponse) => {
    localStorage.setItem("uniapply_token", result.access_token);
    localStorage.setItem("uniapply_refresh_token", result.refresh_token);
    setToken(result.access_token);
    setUser(result.user);
    setAuthMode(null);
    setError("");
    setPage("overview");
    flash(`Xush kelibsiz, ${result.user.username}!`);
  };

  const onLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await API.post<TokenResponse>("/auth/login", loginForm);
      completeLogin(result);
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const onSendOtp = async () => {
    setBusy(true); setError("");
    try {
      await API.post("/auth/otp/request", { email: registerForm.email, purpose: "registration" });
      flash("Tasdiqlash kodi emailingizga yuborildi");
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const onVerifyOtp = async () => {
    setBusy(true); setError("");
    try {
      await API.post("/auth/otp/verify", { email: registerForm.email, code: registerForm.code, purpose: "registration" });
      setAuthStep("verified");
      flash("Email tasdiqlandi — hisob ma’lumotlarini to‘ldiring");
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const onRegister = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await API.post("/auth/register", registerForm);
      const result = await API.post<TokenResponse>("/auth/login", { username: registerForm.username, password: registerForm.password });
      completeLogin(result);
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const onForgot = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      if (!forgotForm.code) {
        await API.post("/auth/forgot-password", { email: forgotForm.email });
        flash("Agar bu email hisobga tegishli bo‘lsa, kod yuboriladi");
      } else {
        await API.post("/auth/reset-password", forgotForm);
        setAuthMode("login");
        flash("Parol yangilandi. Yangi parol bilan kiring.");
      }
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const onAcceptStaffInvitation = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await API.post("/auth/staff/accept-invitation", staffAcceptForm);
      const result = await API.post<TokenResponse>("/auth/login", {
        username: staffAcceptForm.username, password: staffAcceptForm.password,
      });
      completeLogin(result);
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const onRegisterAdmin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const created = await API.post<User>("/auth/register-admin", adminSetupForm);
      setAdminSetupAvailable(false);
      const result = await API.post<TokenResponse>("/auth/login", {
        username: created.username, password: adminSetupForm.password,
      });
      completeLogin(result);
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const logout = async () => {
    try {
      if (token) await API.post("/auth/logout", {}, token);
    } catch (reason) { fail(reason); }
    clearStoredTokens();
    setToken(null); setUser(null); setProfile(null); setApplications([]);
    setAchievements([]); setNotifications([]); setPage("overview"); setAuthMode(null);
    flash("Hisobdan xavfsiz chiqildi");
  };

  const refreshDashboard = () => {
    if (token && user) void loadUserData(token, user);
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const updated =       await API.patch<Profile>("/students/me", { ...profileForm, date_of_birth: profileForm.date_of_birth || null }, token);
      setProfile(updated);
      flash("Profil ma’lumotlari saqlandi");
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const addAchievement = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const body = {
        ...achievementForm,
        score: achievementForm.score ? Number(achievementForm.score) : null,
        awarded_at: achievementForm.awarded_at || null,
      };
      await API.post("/students/me/achievements", body, token);
      setAchievements(await API.get<Achievement[]>("/students/me/achievements", token));
      setModal(null);
      setAchievementForm({ category: "IELTS", title: "", score: "", awarded_at: "", issuer: "", notes: "" });
      flash("Yangi yutuq qo‘shildi");
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const deleteAchievement = async (id: number) => {
    if (!token || !window.confirm("Ushbu yutuqni o‘chirishni xohlaysizmi?")) return;
    try {
      await API.del(`/students/me/achievements/${id}`, token);
      setAchievements((items) => items.filter((item) => item.id !== id));
      flash("Yutuq o‘chirildi");
    } catch (reason) { fail(reason); }
  };

  const applyProgram = async (program: Program) => {
    if (!token) { setAuthMode("login"); return; }
    try {
      const created = await API.post<Application>("/applications", {
        program_id: program.id, intake: program.intake, personal_statement: "",
      }, token);
      setApplications((current) => [created, ...current]);
      setModal(null);
      setActiveProgram(null);
      setPage("applications");
      flash("Ariza qoralamasi yaratildi. Uni yuborishdan oldin motivation letter kiriting.");
    } catch (reason) { fail(reason); }
  };

  const submitApplication = async (application: Application) => {
    if (!token) return;
    try {
      const statement = window.prompt("Motivation letter / shaxsiy bayonot matnini kiriting:", application.personal_statement);
      if (statement === null) return;
      const updated = await API.patch<Application>(`/applications/${application.id}`, { personal_statement: statement }, token);
      const submitted = await API.post<Application>(`/applications/${application.id}/submit`, {}, token);
      setApplications((items) => items.map((item) => item.id === application.id ? submitted : item));
      void updated;
      flash("Arizangiz universitetga yuborildi");
    } catch (reason) { fail(reason); }
  };

  const withdrawApplication = async (application: Application) => {
    if (!token || !window.confirm("Arizani qaytarib olmoqchimisiz?")) return;
    try {
      const result = await API.post<Application>(`/applications/${application.id}/withdraw`, {}, token);
      setApplications((items) => items.map((item) => item.id === application.id ? result : item));
      flash("Ariza qaytarib olindi");
    } catch (reason) { fail(reason); }
  };

  const reviewApplication = async (id: number, action: "accept" | "reject" | "request_information" | "start_review") => {
    if (!token) return;
    try {
      await API.post(`/applications/${id}/review`, { action, comment: reviewComments[id] || "" }, token);
      setStaffApplications(await API.get<Application[]>("/applications/review-queue", token));
      flash("Ariza holati yangilandi");
    } catch (reason) { fail(reason); }
  };

  const createProgram = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const requirements: Record<string, number> = {};
      programForm.requirements.split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
        const [key, value] = part.split(":").map((text) => text.trim());
        if (key && value && Number.isFinite(Number(value))) requirements[key] = Number(value);
      });
      await API.post("/programs", {
        ...programForm, tuition: Number(programForm.tuition), deadline: programForm.deadline || null, requirements,
      }, token);
      setPrograms(await API.get<Program[]>("/programs", token));
      setModal(null);
      flash("Yangi dastur yaratildi");
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const createUniversity = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const created = await API.post<University>("/admin/universities", universityForm, token);
      setPendingUniversities((items) => [created, ...items]);
      setModal(null);
      setUniversityForm({ name: "", country: "Uzbekistan", city: "", contact_email: "", website: "", description: "" });
      flash("Universitet ko‘rib chiqish uchun qo‘shildi");
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const decideUniversity = async (university: University, decision: "approve" | "reject") => {
    if (!token) return;
    try {
      await API.post(`/admin/universities/${university.id}/decision`, { decision }, token);
      setPendingUniversities((items) => items.filter((item) => item.id !== university.id));
      flash(decision === "approve" ? "Universitet tasdiqlandi" : "Universitet rad etildi");
      refreshDashboard();
    } catch (reason) { fail(reason); }
  };

  const updateUserStatus = async (account: User) => {
    if (!token) return;
    try {
      const updated = await API.patch<User>(`/admin/users/${account.id}`, { is_active: !account.is_active }, token);
      setAdminUsers((items) => items.map((item) => item.id === account.id ? updated : item));
      flash(updated.is_active ? "Hisob faollashtirildi" : "Hisob o‘chirildi");
    } catch (reason) { fail(reason); }
  };

  const inviteStaff = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      await API.post("/admin/staff-invitations", { email: inviteForm.email, university_id: Number(inviteForm.university_id) }, token);
      setModal(null);
      setInviteForm({ email: "", university_id: "" });
      flash("Taklifnoma email orqali yuborildi");
    } catch (reason) { fail(reason); } finally { setBusy(false); }
  };

  const deleteProgram = async (programId: number) => {
    if (!token || !window.confirm("Dastur o‘chirilsinmi?")) return;
    try {
      await API.del(`/programs/${programId}`, token);
      setPrograms((items) => items.filter((item) => item.id !== programId));
      flash("Dastur o‘chirildi");
    } catch (reason) { fail(reason); }
  };

  const openProgram = (program: Program) => {
    setActiveProgram(program);
    setModal("program");
  };

  const changePage = (nextPage: string) => {
    setPage(nextPage);
    setMobileOpen(false);
    setError("");
  };

  const sidebarItems = useMemo(() => {
    if (!user) return [["overview", "Bosh sahifa", LayoutDashboard], ["explore", "Universitetlar", GraduationCap]] as const;
    if (user.role === "student") return [
      ["overview", "Umumiy ko‘rinish", LayoutDashboard], ["explore", "Universitetlar", GraduationCap],
      ["applications", "Mening arizalarim", FileText], ["profile", "Mening profilim", UserRound],
      ["achievements", "Yutuqlarim", Sparkles],
    ] as const;
    if (user.role === "staff") return [
      ["overview", "Umumiy ko‘rinish", LayoutDashboard], ["review", "Arizalarni ko‘rish", FileText],
      ["programs", "Dasturlar", BookOpen],
    ] as const;
    return [
      ["overview", "Umumiy ko‘rinish", LayoutDashboard], ["universities", "Universitetlar", GraduationCap],
      ["users", "Foydalanuvchilar", Users],
    ] as const;
  }, [user]);

  const sidebar = (
    <>
      <div className="brand"><span className="brand-mark"><GraduationCap size={22} /></span><span>uni<span className="brand-accent">apply</span></span></div>
      <div className="workspace-label">ISH JOYI <ChevronDown size={13} /></div>
      <nav className="side-nav" aria-label="Asosiy navigatsiya">
        {sidebarItems.map(([key, label, Icon]) => (
          <button className={`nav-item ${page === key ? "active" : ""}`} key={key} onClick={() => changePage(key)}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            {key === "applications" && applications.filter((item) => item.status === "draft").length > 0 && <span className="nav-count">{applications.filter((item) => item.status === "draft").length}</span>}
          </button>
        ))}
      </nav>
      <div className="side-bottom">
        {user && <div className="help-card"><span className="help-icon"><CircleHelp size={18} /></span><strong>Yordam kerakmi?</strong><p>Ariza topshirish bo‘yicha savollaringiz bormi?</p><a href="mailto:support@uniapply.uz">Qo‘llab-quvvatlash <ArrowRight size={13} /></a></div>}
        <button className="nav-item" onClick={() => setShowNotifications((shown) => !shown)}><Bell size={18} /><span>Bildirishnomalar</span>{unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}</button>
        {user && <button className="nav-item logout-link" onClick={logout}><LogOut size={18} /><span>Chiqish</span></button>}
        <div className="sidebar-footer"><span className="online-dot" /> Tizim faol <span className="footer-version">v1.0</span></div>
      </div>
    </>
  );

  const title = user && page === "overview"
    ? user.role === "admin" ? "Admin paneli" : user.role === "staff" ? "Boshqaruv paneli" : "Xush kelibsiz"
    : navLabels[page] || "Universitetlar";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>{sidebar}</aside>
      {mobileOpen && <button className="mobile-scrim" aria-label="Menyuni yopish" onClick={() => setMobileOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Menyuni ochish"><Menu size={20} /></button>
          <div className="breadcrumb"><span>UniApply</span><ChevronRight size={14} /><strong>{title}</strong></div>
          <div className="top-actions">
            <div className="top-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Universitet yoki dastur..." aria-label="Qidirish" /><kbd>⌘ K</kbd></div>
            <button className="icon-button" onClick={() => setShowNotifications((shown) => !shown)} aria-label="Bildirishnomalar"><Bell size={18} />{unreadCount > 0 && <i />}</button>
            {user ? (
              <button className="user-chip" onClick={() => changePage("profile")}><span className="avatar">{initials(profile ? `${profile.first_name} ${profile.last_name}` : user.username)}</span><span className="user-chip-copy"><b>{profile ? `${profile.first_name} ${profile.last_name}`.trim() : user.username}</b><small>{user.role === "student" ? "Talaba" : user.role === "staff" ? "Universitet xodimi" : "Administrator"}</small></span><ChevronDown size={14} /></button>
            ) : <button className="btn btn-primary btn-sm" onClick={() => setAuthMode("login")}>Kirish <ArrowRight size={15} /></button>}
          </div>
        </header>
        <div className="content-wrap">
          {error && <div className="alert alert-error"><X size={16} />{error}<button aria-label="Yopish" onClick={() => setError("")}><X size={15} /></button></div>}
          {user && page === "overview" && user.role === "student" && <StudentOverview
            profile={profile} applications={applications} programs={programs} universities={universities} achievements={achievements}
            onExplore={() => changePage("explore")} onApplications={() => changePage("applications")} onOpenProgram={openProgram}
          />}
          {user && page === "overview" && user.role === "staff" && <StaffOverview
            applications={staffApplications} reviewStats={reviewStats} programs={programs} onQueue={() => changePage("review")} onPrograms={() => changePage("programs")}
          />}
          {user && page === "overview" && user.role === "admin" && <AdminOverview stats={adminStats} pending={pendingUniversities} onPending={() => changePage("universities")} onUsers={() => changePage("users")} />}
          {(!user && page === "overview" || page === "explore") && <ExplorePage
            user={user} query={query} setQuery={setQuery} country={country} setCountry={setCountry}
            universities={universities} programs={filteredPrograms} onOpenProgram={openProgram} onLogin={() => setAuthMode("login")}
          />}
          {user && page === "applications" && <ApplicationsPage applications={applications} programs={programs} token={token} onSubmit={submitApplication} onWithdraw={withdrawApplication} onExplore={() => changePage("explore")} />}
          {user && page === "profile" && <ProfilePage user={user} profileForm={profileForm} setProfileForm={setProfileForm} onSave={saveProfile} onChangePassword={async (current, next) => {
            if (!token) return;
            try {
              await API.post("/auth/change-password", { current_password: current, new_password: next }, token);
              flash("Parol yangilandi");
            } catch (reason) { fail(reason); throw reason; }
          }} busy={busy} />}
          {user && page === "achievements" && <AchievementsPage achievements={achievements} onAdd={() => setModal("achievement")} onDelete={deleteAchievement} />}
          {user && page === "review" && <ReviewPage applications={staffApplications} programs={programs} token={token} selected={selectedApplication} setSelected={setSelectedApplication} comments={reviewComments} setComments={setReviewComments} onReview={reviewApplication} />}
          {user && page === "programs" && <ProgramsAdminPage programs={programs} onAdd={() => setModal("program")} onDelete={deleteProgram} />}
          {user && page === "universities" && user.role === "admin" && <AdminUniversitiesPage
            pending={pendingUniversities} allUniversities={universities} onDecision={decideUniversity}
            onAdd={() => setModal("university")} onInvite={() => setModal("invite")}
          />}
          {user && page === "users" && <UsersPage users={adminUsers} onToggle={updateUserStatus} />}
          {showNotifications && <NotificationsPopover items={notifications} onRead={async (item) => {
            if (!token) return;
            try {
              const updated = await API.patch<Notification>(`/notifications/${item.id}/read`, {}, token);
              setNotifications((items) => items.map((notification) => notification.id === item.id ? updated : notification));
              setUnreadCount((count) => Math.max(0, count - (item.is_read ? 0 : 1)));
            } catch (reason) { fail(reason); }
          }} onReadAll={async () => {
            if (!token) return;
            try {
              await API.patch("/notifications/read-all", {}, token);
              setNotifications((items) => items.map((item) => ({ ...item, is_read: true })));
              setUnreadCount(0);
            } catch (reason) { fail(reason); }
          }} onClose={() => setShowNotifications(false)} />}
        </div>
      </main>
      {authMode && <AuthModal
        mode={authMode} setMode={setAuthMode} onClose={() => { setAuthMode(null); setError(""); }}
        loginForm={loginForm} setLoginForm={setLoginForm} onLogin={onLogin} busy={busy}
        registerForm={registerForm} setRegisterForm={setRegisterForm} authStep={authStep} setAuthStep={setAuthStep}
        onSendOtp={onSendOtp} onVerifyOtp={onVerifyOtp} onRegister={onRegister}
        forgotForm={forgotForm} setForgotForm={setForgotForm} onForgot={onForgot} error={error} setError={setError}
        staffAcceptForm={staffAcceptForm} setStaffAcceptForm={setStaffAcceptForm} onAcceptStaffInvitation={onAcceptStaffInvitation}
        adminSetupAvailable={adminSetupAvailable} adminSetupForm={adminSetupForm} setAdminSetupForm={setAdminSetupForm} onRegisterAdmin={onRegisterAdmin}
      />}
      {modal === "program" && activeProgram && <ProgramModal program={activeProgram} university={universities.find((item) => item.id === activeProgram.university_id)} user={user} onClose={() => setModal(null)} onApply={() => void applyProgram(activeProgram)} />}
      {modal === "achievement" && <Modal title="Yangi yutuq qo‘shish" onClose={() => setModal(null)}><form className="form-grid" onSubmit={addAchievement}>
        <Field label="Yutuq turi"><select value={achievementForm.category} onChange={(e) => setAchievementForm({ ...achievementForm, category: e.target.value })}><option>IELTS</option><option>SAT</option><option>GPA</option><option>Certificate</option><option>Award</option><option>Other</option></select></Field>
        <Field label="Nomi"><input required value={achievementForm.title} onChange={(e) => setAchievementForm({ ...achievementForm, title: e.target.value })} placeholder="Masalan, IELTS Academic" /></Field>
        <Field label="Natija / ball"><input type="number" min="0" step="0.1" value={achievementForm.score} onChange={(e) => setAchievementForm({ ...achievementForm, score: e.target.value })} placeholder="7.5" /></Field>
        <Field label="Olingan sana"><input type="date" value={achievementForm.awarded_at} onChange={(e) => setAchievementForm({ ...achievementForm, awarded_at: e.target.value })} /></Field>
        <Field label="Tashkilot / beruvchi"><input value={achievementForm.issuer} onChange={(e) => setAchievementForm({ ...achievementForm, issuer: e.target.value })} placeholder="British Council" /></Field>
        <Field label="Izoh" full><textarea value={achievementForm.notes} onChange={(e) => setAchievementForm({ ...achievementForm, notes: e.target.value })} rows={3} /></Field>
        <div className="form-actions"><button type="button" className="btn btn-quiet" onClick={() => setModal(null)}>Bekor qilish</button><button className="btn btn-primary" disabled={busy}>{busy ? "Saqlanmoqda…" : "Yutuqni saqlash"} <ArrowRight size={15} /></button></div>
      </form></Modal>}
      {modal === "program" && user?.role === "staff" && <Modal title="Yangi o‘quv dasturi" onClose={() => setModal(null)}><form className="form-grid" onSubmit={createProgram}>
        <Field label="Dastur nomi"><input required value={programForm.name} onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })} /></Field>
        <Field label="Daraja"><select value={programForm.degree} onChange={(e) => setProgramForm({ ...programForm, degree: e.target.value })}><option>Bachelor</option><option>Master</option><option>PhD</option><option>Foundation</option></select></Field>
        <Field label="Yo‘nalish"><input required value={programForm.subject} onChange={(e) => setProgramForm({ ...programForm, subject: e.target.value })} /></Field>
        <Field label="Ta’lim tili"><input required value={programForm.language} onChange={(e) => setProgramForm({ ...programForm, language: e.target.value })} /></Field>
        <Field label="Yillik kontrakt"><input required type="number" min="0" value={programForm.tuition} onChange={(e) => setProgramForm({ ...programForm, tuition: e.target.value })} /></Field>
        <Field label="Valyuta"><input required maxLength={3} value={programForm.currency} onChange={(e) => setProgramForm({ ...programForm, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Qabul davri"><input required value={programForm.intake} onChange={(e) => setProgramForm({ ...programForm, intake: e.target.value })} placeholder="Fall 2026" /></Field>
        <Field label="Ariza muddati"><input type="date" value={programForm.deadline} onChange={(e) => setProgramForm({ ...programForm, deadline: e.target.value })} /></Field>
        <Field label="Talablar (masalan IELTS:6.5, SAT:1200)" full><input value={programForm.requirements} onChange={(e) => setProgramForm({ ...programForm, requirements: e.target.value })} placeholder="IELTS:6.5, SAT:1200, GPA:3.0" /></Field>
        <Field label="Tavsif" full><textarea value={programForm.description} onChange={(e) => setProgramForm({ ...programForm, description: e.target.value })} rows={3} /></Field>
        <div className="form-actions"><button type="button" className="btn btn-quiet" onClick={() => setModal(null)}>Bekor qilish</button><button className="btn btn-primary" disabled={busy}>Dastur yaratish <ArrowRight size={15} /></button></div>
      </form></Modal>}
      {modal === "university" && <Modal title="Universitet qo‘shish" onClose={() => setModal(null)}><form className="form-grid" onSubmit={createUniversity}>
        <Field label="Universitet nomi"><input required value={universityForm.name} onChange={(e) => setUniversityForm({ ...universityForm, name: e.target.value })} /></Field>
        <Field label="Davlat"><input required value={universityForm.country} onChange={(e) => setUniversityForm({ ...universityForm, country: e.target.value })} /></Field>
        <Field label="Shahar"><input required value={universityForm.city} onChange={(e) => setUniversityForm({ ...universityForm, city: e.target.value })} /></Field>
        <Field label="Aloqa email"><input required type="email" value={universityForm.contact_email} onChange={(e) => setUniversityForm({ ...universityForm, contact_email: e.target.value })} /></Field>
        <Field label="Veb-sayt"><input type="url" value={universityForm.website} onChange={(e) => setUniversityForm({ ...universityForm, website: e.target.value })} placeholder="https://" /></Field>
        <Field label="Qisqacha ma’lumot" full><textarea value={universityForm.description} onChange={(e) => setUniversityForm({ ...universityForm, description: e.target.value })} rows={3} /></Field>
        <div className="form-actions"><button type="button" className="btn btn-quiet" onClick={() => setModal(null)}>Bekor qilish</button><button className="btn btn-primary" disabled={busy}>Universitet qo‘shish <ArrowRight size={15} /></button></div>
      </form></Modal>}
      {modal === "invite" && <Modal title="Universitet xodimini taklif qilish" onClose={() => setModal(null)}><form className="form-grid" onSubmit={inviteStaff}>
        <Field label="Xodim email manzili" full><input required type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} /></Field>
        <Field label="Universitet" full><select required value={inviteForm.university_id} onChange={(e) => setInviteForm({ ...inviteForm, university_id: e.target.value })}><option value="">Universitetni tanlang</option>{universities.map((university) => <option key={university.id} value={university.id}>{university.name} (ID: {university.id})</option>)}</select></Field>
        <p className="field-note full">Taklifnoma emailga yuboriladi va 7 kun amal qiladi.</p>
        <div className="form-actions"><button type="button" className="btn btn-quiet" onClick={() => setModal(null)}>Bekor qilish</button><button className="btn btn-primary" disabled={busy}>Taklif yuborish <ArrowRight size={15} /></button></div>
      </form></Modal>}
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
      <footer className="app-footer"><span>© 2026 UniApply</span><span>O‘z kelajagingizni bugun boshlang <Sparkles size={13} /></span><a href="mailto:support@uniapply.uz">Yordam markazi</a></footer>
    </div>
  );
}

export default App;

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <label className={`field ${full ? "field-full" : ""}`}><span>{label}</span>{children}</label>;
}

function StudentOverview({ profile, applications, programs, universities, achievements, onExplore, onApplications, onOpenProgram }: {
  profile: Profile | null; applications: Application[]; programs: Program[]; universities: University[];
  achievements: Achievement[]; onExplore: () => void; onApplications: () => void; onOpenProgram: (program: Program) => void;
}) {
  const firstName = profile?.first_name || "talaba";
  const drafts = applications.filter((item) => item.status === "draft").length;
  const submitted = applications.filter((item) => item.status !== "draft").length;
  const suggested = programs.slice(0, 3);
  const completedSteps = [Boolean(profile?.first_name && profile?.last_name), achievements.length > 0, applications.length > 0].filter(Boolean).length;
  return <>
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> SIZNING TA’LIM SAFARINGIZ</div><h1>Assalomu alaykum, {firstName}<span className="wave">✦</span></h1><p>Kelajagingizdagi katta qadam aynan shu yerdan boshlanadi.</p></div><div className="welcome-date"><span>{new Date().toLocaleDateString("uz-UZ", { weekday: "long" })}</span><b>{new Date().toLocaleDateString("uz-UZ", { day: "numeric", month: "long", year: "numeric" })}</b></div></section>
    <section className="hero-banner">
      <div className="hero-copy"><span className="pill pill-light"><Sparkles size={13} /> KELAJAGINGIZNI QURING</span><h2>Sizning orzuingiz.<br /><span>Bizning yo‘l xaritamiz.</span></h2><p>Eng yaxshi universitetlarni kashf eting, arizalarni bir joyda boshqaring va maqsadlaringizga yaqinlashing.</p><button className="btn btn-white" onClick={onExplore}>Universitetlarni ko‘rish <ArrowRight size={16} /></button></div>
      <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-cap"><GraduationCap size={85} strokeWidth={1.1} /></div><span className="hero-star star-one">✦</span><span className="hero-star star-two">✧</span><div className="hero-mini-card"><span className="mini-icon"><Check size={16} /></span><span><b>O‘qishga qabul!</b><small>Orzularingiz ro‘yobga chiqsin</small></span></div></div>
    </section>
    <div className="stats-grid">
      <StatCard label="JAMI ARIZALAR" value={applications.length} note={`${drafts} ta qoralama`} icon={<FileText size={19} />} tint="blue" trend={applications.length ? "Faol" : "Boshlash"} />
      <StatCard label="YUBORILGAN" value={submitted} note="Ko‘rib chiqilmoqda" icon={<ArrowUpRight size={19} />} tint="green" trend={submitted ? "Jarayonda" : "Hozircha yo‘q"} />
      <StatCard label="YUTUQLARIM" value={achievements.length} note="Profilingizda" icon={<Sparkles size={19} />} tint="amber" trend={achievements.length ? "Yaxshi!" : "Qo‘shing"} />
      <StatCard label="MOS DASTURLAR" value={programs.length} note="Siz uchun imkoniyatlar" icon={<GraduationCap size={19} />} tint="purple" trend="Ko‘rish" onClick={onExplore} />
    </div>
    <div className="dashboard-grid">
      <section className="panel suggested-panel"><div className="section-heading"><div><span className="section-kicker">SIZ UCHUN TANLANDI</span><h3>Ommabop dasturlar</h3></div><button className="text-link" onClick={onExplore}>Barchasini ko‘rish <ArrowRight size={15} /></button></div>
        {suggested.length ? <div className="suggestion-list">{suggested.map((program, index) => <ProgramRow key={program.id} program={program} university={universities.find((item) => item.id === program.university_id)} index={index} onClick={() => onOpenProgram(program)} />)}</div> : <EmptyState title="Dasturlar topilmadi" text="Universitetlar katalogini yangilab ko‘ring." action="Katalogga o‘tish" onAction={onExplore} />}
      </section>
      <div className="right-stack">
        <section className="panel progress-panel"><div className="section-heading"><div><span className="section-kicker">BIRINCHI QADAMLAR</span><h3>Profil holati</h3></div><span className="progress-percent">{Math.round(completedSteps / 3 * 100)}%</span></div><div className="progress-track"><span style={{ width: `${completedSteps / 3 * 100}%` }} /></div><p className="progress-copy">Yaxshi ariza uchun profilingizni to‘ldiring.</p><div className="checklist"><div className={profile?.first_name ? "done" : ""}><span>{profile?.first_name ? <Check size={12} /> : "1"}</span><p>Shaxsiy ma’lumotlar</p><b>{profile?.first_name ? "Tayyor" : "To‘ldirish"}</b></div><div className={achievements.length ? "done" : ""}><span>{achievements.length ? <Check size={12} /> : "2"}</span><p>Akademik yutuqlar</p><b>{achievements.length ? "Tayyor" : "Qo‘shish"}</b></div><div className={applications.length ? "done" : ""}><span>{applications.length ? <Check size={12} /> : "3"}</span><p>Birinchi arizangiz</p><b>{applications.length ? "Tayyor" : "Ko‘rish"}</b></div></div></section>
        <section className="panel journey-card"><span className="journey-spark">✦</span><span className="section-kicker">SIZNING YO‘LINGIZ</span><h3>Katta orzular<br />kichik qadamlardan.</h3><p>Har bir ariza — kelajakka yana bir qadam.</p><button onClick={onApplications}>Arizalarimga o‘tish <ArrowRight size={14} /></button></section>
      </div>
    </div>
    <section className="panel application-preview"><div className="section-heading"><div><span className="section-kicker">SO‘NGGI FAOLIYAT</span><h3>Arizalaringiz</h3></div><button className="text-link" onClick={onApplications}>Barchasi <ArrowRight size={15} /></button></div>
      {applications.length ? applications.slice(0, 3).map((application) => {
        const program = programs.find((item) => item.id === application.program_id);
        const university = program && universities.find((item) => item.id === program.university_id);
        return <div className="application-line" key={application.id}><span className="university-avatar">{initials(university?.name || "UA")}</span><span className="application-name"><b>{program?.name || `Dastur #${application.program_id}`}</b><small>{university?.name || "Universitet"} · {application.intake}</small></span><StatusBadge status={application.status} /><button className="row-arrow" onClick={onApplications} aria-label="Arizani ko‘rish"><ArrowRight size={16} /></button></div>;
      }) : <EmptyState title="Hali arizalar yo‘q" text="Sizga mos dasturlarni ko‘rib, ariza qoralamasini yarating." action="Dasturlarni ko‘rish" onAction={onExplore} />}
    </section>
  </>;
}

function StatCard({ label, value, note, icon, tint, trend, onClick }: { label: string; value: number; note: string; icon: React.ReactNode; tint: string; trend: string; onClick?: () => void }) {
  return <button className={`stat-card tint-${tint}`} onClick={onClick}><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-trend">{trend} <ArrowUpRight size={13} /></span></div><span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-note">{note}</span></button>;
}

function ProgramRow({ program, university, index, onClick }: { program: Program; university?: University; index: number; onClick: () => void }) {
  const palettes = ["program-mark-blue", "program-mark-coral", "program-mark-mint"];
  return <button className="program-row" onClick={onClick}><span className={`program-mark ${palettes[index % palettes.length]}`}><GraduationCap size={20} /></span><span className="program-row-main"><b>{program.name}</b><small>{university?.name || program.subject} · {program.degree}</small></span><span className="program-row-meta"><b>{money(program.tuition, program.currency)}</b><small>{program.intake}</small></span><ChevronRight className="program-chevron" size={16} /></button>;
}

function StaffOverview({ applications, reviewStats, programs, onQueue, onPrograms }: { applications: Application[]; reviewStats: { total: number; by_status: Record<string, number> } | null; programs: Program[]; onQueue: () => void; onPrograms: () => void }) {
  return <>
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> UNIVERSITET ISH JOYI</div><h1>Salom, hamkor <span className="wave">✦</span></h1><p>Nomzodlar arizasini baholang, qabul jarayonini boshqaring.</p></div><button className="btn btn-primary" onClick={onQueue}>Arizalarni ko‘rish <ArrowRight size={15} /></button></section>
    <div className="stats-grid"><StatCard label="JAMI ARIZALAR" value={reviewStats?.total || 0} note="Universitetingizda" icon={<FileText size={19} />} tint="blue" trend="Barchasi" onClick={onQueue} /><StatCard label="KO‘RIB CHIQILISHI KERAK" value={applications.filter((item) => item.status === "submitted").length} note="Navbatda" icon={<Clock3 size={19} />} tint="amber" trend="Yangi" onClick={onQueue} /><StatCard label="KO‘RIB CHIQILMOQDA" value={reviewStats?.by_status.under_review || 0} note="Jarayonda" icon={<Search size={19} />} tint="purple" trend="Faol" onClick={onQueue} /><StatCard label="DASTURLAR" value={programs.length} note="Katalogda" icon={<BookOpen size={19} />} tint="green" trend="Boshqarish" onClick={onPrograms} /></div>
    <div className="dashboard-grid"><section className="panel suggested-panel"><div className="section-heading"><div><span className="section-kicker">QABUL JARAYONI</span><h3>Oxirgi arizalar</h3></div><button className="text-link" onClick={onQueue}>Barcha arizalar <ArrowRight size={15} /></button></div>{applications.length ? applications.slice(0, 5).map((app) => <div className="application-line" key={app.id}><span className="university-avatar"><UserRound size={17} /></span><span className="application-name"><b>Ariza #{app.id}</b><small>{app.intake} · {dateLabel(app.submitted_at)}</small></span><StatusBadge status={app.status} /><button className="row-arrow" onClick={onQueue} aria-label="Ko‘rish"><ArrowRight size={16} /></button></div>) : <EmptyState title="Yangi arizalar yo‘q" text="Talabalar ariza yuborganda, ular shu yerda ko‘rinadi." action="Dasturlarni boshqarish" onAction={onPrograms} />}</section><section className="panel progress-panel"><div className="section-heading"><div><span className="section-kicker">SIZNING DASTURLARINGIZ</span><h3>Dastur katalogi</h3></div><BookOpen size={19} className="muted-icon" /></div><div className="big-number">{programs.length}</div><p className="progress-copy">Faol dasturlar talabalar katalogida ko‘rsatiladi.</p><button className="btn btn-soft full-button" onClick={onPrograms}>Dasturlarni boshqarish <ArrowRight size={15} /></button></section></div>
  </>;
}

function AdminOverview({ stats, pending, onPending, onUsers }: { stats: AdminStats | null; pending: University[]; onPending: () => void; onUsers: () => void }) {
  return <>
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> PLATFORMANI BOSHQARISH</div><h1>Admin paneli <span className="wave">✦</span></h1><p>UniApply platformasi holati va tasdiqlash jarayonlari.</p></div><span className="pill pill-green"><span className="status-dot" /> Tizim faol</span></section>
    <div className="stats-grid"><StatCard label="FOYDALANUVCHILAR" value={stats?.users || 0} note={`${stats?.students || 0} nafar talaba`} icon={<Users size={19} />} tint="blue" trend="Batafsil" onClick={onUsers} /><StatCard label="UNIVERSITETLAR" value={stats?.universities || 0} note={`${stats?.pending_universities || 0} ta kutilmoqda`} icon={<GraduationCap size={19} />} tint="green" trend="Tasdiqlash" onClick={onPending} /><StatCard label="DASTURLAR" value={stats?.programs || 0} note="Katalogda" icon={<BookOpen size={19} />} tint="purple" trend="Faol" /><StatCard label="ARIZALAR" value={stats?.applications || 0} note={`${stats?.staff || 0} universitet xodimi`} icon={<FileText size={19} />} tint="amber" trend="Ko‘rish" /></div>
    <section className="panel"><div className="section-heading"><div><span className="section-kicker">TASDIQLASH</span><h3>Ko‘rib chiqilayotgan universitetlar</h3></div><button className="text-link" onClick={onPending}>Barchasi <ArrowRight size={15} /></button></div>{pending.length ? pending.slice(0, 5).map((item) => <div className="application-line" key={item.id}><span className="university-avatar"><GraduationCap size={18} /></span><span className="application-name"><b>{item.name}</b><small>{item.city}, {item.country} · {item.contact_email}</small></span><span className="pill pill-amber">Ko‘rib chiqilmoqda</span><button className="row-arrow" onClick={onPending}><ArrowRight size={16} /></button></div>) : <EmptyState title="Kutilayotgan so‘rovlar yo‘q" text="Yangi universitetlar ro‘yxatdan o‘tganda shu yerda chiqadi." action="Universitetlar" onAction={onPending} />}</section>
  </>;
}

function ExplorePage({ user, query, setQuery, country, setCountry, universities, programs, onOpenProgram, onLogin }: { user: User | null; query: string; setQuery: (value: string) => void; country: string; setCountry: (value: string) => void; universities: University[]; programs: Program[]; onOpenProgram: (program: Program) => void; onLogin: () => void }) {
  const [tab, setTab] = useState<"programs" | "universities">("programs");
  const [degree, setDegree] = useState("");
  const filtered = programs.filter((program) => !degree || program.degree.toLowerCase() === degree.toLowerCase());
  const publicPage = !user;
  return <>
    {publicPage && <section className="public-hero"><div className="public-hero-text"><span className="pill pill-light"><Sparkles size={13} /> ORZUDAGI TA’LIMGA BIR QADAM</span><h1>Kelajagingizni<br /><span>tanlang.</span></h1><p>O‘zbekiston va dunyoning eng yaxshi universitetlarida o‘zingizga mos dasturni toping.</p><div className="public-hero-actions"><button className="btn btn-white" onClick={() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" })}>Dasturlarni ko‘rish <ArrowDownRight size={16} /></button><button className="hero-secondary" onClick={onLogin}>Hisobingiz bormi? <span>Kirish</span></button></div><div className="hero-trust"><div className="trust-avatars"><i>U</i><i>A</i><i>M</i><i>+</i></div><span><b>{universities.length}+ universitet</b><small>bir platformada</small></span><span className="trust-divider" /><span><b>Oddiy va oson</b><small>ariza topshirish</small></span></div></div><div className="public-hero-visual"><div className="hero-ring ring-a" /><div className="hero-ring ring-b" /><div className="hero-globe"><Globe2 size={120} strokeWidth={1.15} /></div><div className="floating-card float-card-top"><span className="float-icon"><GraduationCap size={19} /></span><span><b>O‘zingizga mos yo‘nalish</b><small>Tanlov sizdan boshlanadi</small></span></div><div className="floating-card float-card-bottom"><span className="float-icon float-lilac"><Check size={18} /></span><span><b>Arizalar — bir joyda</b><small>Jarayonni nazorat qiling</small></span></div><span className="visual-spark spark-a">✦</span><span className="visual-spark spark-b">✧</span></div></section>}
    <section id="catalog" className="catalog-section"><div className="catalog-heading"><div><span className="section-kicker">SIZ UCHUN IMKONIYATLAR</span><h2>{publicPage ? "Keyingi manzilingiz shu yerda." : "Orzuingizdagi dastur"}</h2><p>Dasturlarni o‘rganing va ta’lim safaringizni boshlang.</p></div><div className="catalog-count"><span>{tab === "programs" ? filtered.length : universities.length}</span> ta natija</div></div>
      <div className="catalog-toolbar"><div className="catalog-tabs"><button className={tab === "programs" ? "selected" : ""} onClick={() => setTab("programs")}><BookOpen size={16} /> Dasturlar</button><button className={tab === "universities" ? "selected" : ""} onClick={() => setTab("universities")}><GraduationCap size={17} /> Universitetlar</button></div><div className="catalog-filters"><label className="catalog-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nomi yoki yo‘nalish bo‘yicha..." /></label><label className="select-wrap"><Globe2 size={15} /><select value={country} onChange={(event) => setCountry(event.target.value)}><option value="">Barcha davlatlar</option><option value="Uzbekistan">O‘zbekiston</option><option value="United States">AQSh</option><option value="United Kingdom">Buyuk Britaniya</option><option value="Turkey">Turkiya</option><option value="South Korea">Janubiy Koreya</option></select><ChevronDown size={14} /></label>{tab === "programs" && <label className="select-wrap"><Settings2 size={15} /><select value={degree} onChange={(event) => setDegree(event.target.value)}><option value="">Barcha darajalar</option><option>Bachelor</option><option>Master</option><option>PhD</option><option>Foundation</option></select><ChevronDown size={14} /></label>}</div></div>
      {tab === "programs" ? filtered.length ? <div className="catalog-grid">{filtered.map((program) => <ProgramCard key={program.id} program={program} university={universities.find((item) => item.id === program.university_id)} onClick={() => onOpenProgram(program)} />)}</div> : <EmptyState title="Dastur topilmadi" text="Qidiruv so‘zlarini o‘zgartirib ko‘ring yoki filtrni tozalang." /> : universities.length ? <div className="university-grid">{universities.map((university) => <UniversityCard key={university.id} university={university} programs={programs.filter((program) => program.university_id === university.id).length} />)}</div> : <EmptyState title="Universitet topilmadi" text="Hozircha katalogda tasdiqlangan universitetlar yo‘q." />}
    </section>
    {publicPage && <section className="public-cta"><div className="cta-icon"><Sparkles size={23} /></div><div><h3>Yangi imkoniyatlar sizni kutmoqda.</h3><p>Bepul hisob yarating va arizalaringizni boshqarishni boshlang.</p></div><button className="btn btn-primary" onClick={onLogin}>Hisob yaratish <ArrowRight size={15} /></button></section>}
  </>;
}

function ProgramCard({ program, university, onClick }: { program: Program; university?: University; onClick: () => void }) {
  return <article className="catalog-card"><div className="catalog-card-top"><span className="uni-mark"><GraduationCap size={21} /></span><span className="pill pill-green"><span className="status-dot" /> Qabul ochiq</span></div><div className="card-uni-name">{university?.name || "Universitet"}</div><h3>{program.name}</h3><p className="card-program-subject">{program.subject} <span>·</span> {program.degree}</p><div className="card-meta"><span><Globe2 size={14} /> {program.language}</span><span><Clock3 size={14} /> {program.intake}</span></div><div className="card-bottom"><span><small>YILLIK KONTRAKT</small><b>{money(program.tuition, program.currency)}</b></span><button className="round-arrow" onClick={onClick} aria-label={`${program.name} haqida`}><ArrowUpRight size={17} /></button></div></article>;
}

function UniversityCard({ university, programs }: { university: University; programs: number }) {
  return <article className="university-card"><div className="university-card-top"><span className="uni-mark"><GraduationCap size={22} /></span><span className="pill pill-green">Tasdiqlangan</span></div><h3>{university.name}</h3><p><Globe2 size={14} /> {university.city}, {university.country}</p><div className="university-description">{university.description || "Universitet haqidagi batafsil ma’lumot hozircha kiritilmagan."}</div><div className="university-card-foot"><span><b>{programs}</b> ta dastur</span>{university.website && <a href={university.website} target="_blank" rel="noreferrer">Veb-sayt <ArrowUpRight size={13} /></a>}</div></article>;
}

function ApplicationsPage({ applications, programs, token, onSubmit, onWithdraw, onExplore }: { applications: Application[]; programs: Program[]; token: string | null; onSubmit: (app: Application) => void; onWithdraw: (app: Application) => void; onExplore: () => void }) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const shown = filter === "all" ? applications : applications.filter((item) => item.status === filter);
  const tabs = [["all", "Barchasi"], ["draft", "Qoralamalar"], ["submitted", "Yuborilgan"], ["under_review", "Jarayonda"], ["accepted", "Qabul qilingan"]] as const;
  return <><section className="page-intro"><div><span className="section-kicker">TA’LIM SAFARINGIZ</span><h1>Mening arizalarim</h1><p>Barcha universitet arizalaringiz va ularning holati bir joyda.</p></div><button className="btn btn-primary" onClick={onExplore}><Plus size={16} /> Yangi arиза</button></section>
    <div className="application-summary"><div><span>JAMI</span><b>{applications.length}</b></div><div><span>QORALAMA</span><b>{applications.filter((item) => item.status === "draft").length}</b></div><div><span>KO‘RIB CHIQILMOQDA</span><b>{applications.filter((item) => ["submitted", "under_review", "information_requested"].includes(item.status)).length}</b></div><div><span>QABUL QILINGAN</span><b>{applications.filter((item) => item.status === "accepted").length}</b></div></div>
    <section className="panel application-table-panel"><div className="table-toolbar"><div className="filter-tabs">{tabs.map(([key, label]) => <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{label}{key === "all" && <span>{applications.length}</span>}</button>)}</div><button className="filter-button"><Settings2 size={15} /> Filtr <ChevronDown size={13} /></button></div>
      {shown.length ? <div className="application-table">{shown.map((application) => {
        const program = programs.find((item) => item.id === application.program_id);
        return <div className="application-table-entry" key={application.id}>
          <div className="application-table-row"><span className="university-avatar"><GraduationCap size={17} /></span><div className="table-program"><b>{program?.name || `Dastur #${application.program_id}`}</b><small>{program?.subject || "Yo‘nalish"} · {program?.degree || ""}</small></div><div className="table-date"><small>QABUL DAVRI</small><b>{application.intake}</b></div><div className="table-date"><small>YARATILGAN</small><b>{dateLabel(application.created_at)}</b></div><StatusBadge status={application.status} /><div className="row-actions">{application.status === "draft" && <button className="btn btn-primary btn-xs" onClick={() => onSubmit(application)}>Yuborish <ArrowRight size={13} /></button>}{["draft", "submitted", "under_review", "information_requested"].includes(application.status) && <button className="icon-button small" title="Arizani qaytarib olish" onClick={() => onWithdraw(application)}><X size={15} /></button>}</div><button className="row-arrow" onClick={() => setExpanded(expanded === application.id ? null : application.id)} aria-label="Ariza tafsilotlarini ochish"><ArrowUpRight size={15} /></button></div>
          {expanded === application.id && <ApplicationDetails application={application} token={token} />}
        </div>;
      })}</div> : <EmptyState title={filter === "all" ? "Hali ariza yo‘q" : "Bu holatda arizalar yo‘q"} text="Dasturlar katalogidan o‘zingizga mos yo‘nalishni tanlang." action="Dasturlarni ko‘rish" onAction={onExplore} />}
    </section>
  </>;
}

function ApplicationDetails({ application, token }: { application: Application; token: string | null }) {
  const [documents, setDocuments] = useState<ApplicationDocument[]>([]);
  const [history, setHistory] = useState<ApplicationReview[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [docs, reviews] = await Promise.all([
        API.get<ApplicationDocument[]>(`/documents/applications/${application.id}`, token),
        API.get<ApplicationReview[]>(`/applications/${application.id}/reviews`, token),
      ]);
      setDocuments(docs);
      setHistory(reviews);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ariza tafsilotlarini yuklab bo‘lmadi");
    }
  }, [application.id, token]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (file?: File) => {
    if (!file || !token) return;
    const body = new FormData();
    body.append("file", file);
    setBusy(true);
    try {
      await API.request(`/documents/applications/${application.id}`, { method: "POST", body }, token);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Faylni yuklashda xatolik");
    } finally { setBusy(false); }
  };

  const download = async (document: ApplicationDocument) => {
    if (!token) return;
    try {
      const response = await API.fetch(`/documents/${document.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Faylni yuklab bo‘lmadi");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Yuklab olishda xatolik"); }
  };

  const remove = async (document: ApplicationDocument) => {
    if (!token || !window.confirm(`${document.filename} hujjatini o‘chirasizmi?`)) return;
    try {
      await API.del(`/documents/${document.id}`, token);
      setDocuments((items) => items.filter((item) => item.id !== document.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Hujjatni o‘chirishda xatolik"); }
  };

  return <div className="application-details">
    {error && <div className="alert alert-error">{error}</div>}
    <div className="details-columns">
      <section><div className="details-title"><span className="section-kicker">HUJJATLAR</span>{["draft", "information_requested"].includes(application.status) && <label className="btn btn-soft btn-xs upload-label">{busy ? "Yuklanmoqda…" : <><Plus size={12} /> Hujjat qo‘shish</>}<input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>}</div>{documents.length ? documents.map((document) => <div className="document-line" key={document.id}><FileText size={15} /><span><b>{document.filename}</b><small>{(document.size_bytes / 1024).toFixed(0)} KB · {document.is_verified ? "Tekshirilgan" : "Tekshirilmagan"}</small></span><button className="text-link" onClick={() => void download(document)}>Yuklash</button>{["draft", "information_requested"].includes(application.status) && <button className="icon-button small" onClick={() => void remove(document)} aria-label="Hujjatni o‘chirish"><X size={14} /></button>}</div>) : <p className="detail-empty">Hali hujjatlar yuklanmagan.</p>}<small className="document-help">PDF, PNG, JPG yoki DOCX · hajmi 10 MB gacha</small></section>
      <section><span className="section-kicker">ARIZA TARIXI</span>{history.length ? <div className="history-list">{history.map((entry) => <div className="history-line" key={entry.id}><span className="history-dot" /><span><b>{statusName(entry.to_status)}</b><small>{dateLabel(entry.created_at)}</small></span></div>)}</div> : <p className="detail-empty">Hali tarix mavjud emas.</p>}</section>
    </div>
    {application.eligibility.requirements && <section className="application-eligibility"><span className="section-kicker">TALABLARGA MOSLIK — TAXMINIY</span><div>{Object.entries(application.eligibility.requirements).map(([key, item]) => <span key={key} className={item.meets_requirement ? "meets" : "misses"}>{item.meets_requirement ? <CheckCircle2 size={13} /> : <X size={13} />}{key}: {item.student_score ?? "yo‘q"} / {item.required}</span>)}</div><small>{application.eligibility.disclaimer || "Baholash taxminiy va o‘qishga qabul kafolati emas."}</small></section>}
  </div>;
}

function ProfilePage({ user, profileForm, setProfileForm, onSave, onChangePassword, busy }: { user: User; profileForm: { first_name: string; last_name: string; date_of_birth: string; country: string; phone: string; education_level: string }; setProfileForm: (value: typeof profileForm) => void; onSave: (event: FormEvent) => void; onChangePassword: (current: string, next: string) => void; busy: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordBusy(true);
    try {
      await onChangePassword(currentPassword, nextPassword);
      setCurrentPassword("");
      setNextPassword("");
    } finally { setPasswordBusy(false); }
  };
  return <><section className="page-intro"><div><span className="section-kicker">HISOB SOZLAMALARI</span><h1>Mening profilim</h1><p>Ma’lumotlaringizni yangilab, universitetlarga o‘zingizni tanishtiring.</p></div><span className="pill pill-green"><ShieldCheck size={14} /> Hisob himoyalangan</span></section>
    <div className="profile-layout"><aside className="panel profile-id-card"><div className="profile-avatar">{initials(`${profileForm.first_name} ${profileForm.last_name}`) || <UserRound size={34} />}</div><h3>{`${profileForm.first_name} ${profileForm.last_name}`.trim() || user.username}</h3><p>@{user.username}</p><span className="pill pill-blue">Talaba</span><div className="profile-divider" /><div className="profile-info"><span>Email manzili</span><b>{user.email}</b></div><div className="profile-info"><span>Hisob raqami</span><b>UA-{String(user.id).padStart(5, "0")}</b></div></aside>
      <form className="panel profile-form" onSubmit={onSave}><div className="section-heading"><div><span className="section-kicker">SHAXSIY MA’LUMOTLAR</span><h3>Asosiy ma’lumotlar</h3></div><UserRound size={19} className="muted-icon" /></div><div className="form-grid"><Field label="Ism"><input required value={profileForm.first_name} onChange={(e) => setProfileForm({ ...profileForm, first_name: e.target.value })} /></Field><Field label="Familiya"><input required value={profileForm.last_name} onChange={(e) => setProfileForm({ ...profileForm, last_name: e.target.value })} /></Field><Field label="Tug‘ilgan sana"><input type="date" value={profileForm.date_of_birth} onChange={(e) => setProfileForm({ ...profileForm, date_of_birth: e.target.value })} /></Field><Field label="Davlat"><input value={profileForm.country} onChange={(e) => setProfileForm({ ...profileForm, country: e.target.value })} /></Field><Field label="Telefon raqam"><input type="tel" value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} placeholder="+998 90 123 45 67" /></Field><Field label="Ta’lim darajasi"><select value={profileForm.education_level} onChange={(e) => setProfileForm({ ...profileForm, education_level: e.target.value })}><option value="">Tanlang</option><option>High school</option><option>Bachelor</option><option>Master</option><option>Other</option></select></Field></div><div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? "Saqlanmoqda…" : "O‘zgarishlarni saqlash"} <Check size={15} /></button></div></form>
    </div>
    <form className="panel password-form" onSubmit={changePassword}><div className="section-heading"><div><span className="section-kicker">HISOB XAVFSIZLIGI</span><h3>Parolni almashtirish</h3></div><ShieldCheck size={18} className="muted-icon" /></div><div className="password-fields"><Field label="Joriy parol"><input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field><Field label="Yangi parol (kamida 8 belgi)"><input required minLength={8} type="password" autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></Field><button className="btn btn-soft" disabled={passwordBusy}>{passwordBusy ? "Yangilanmoqda…" : "Parolni yangilash"}</button></div></form></>;
}

function AchievementsPage({ achievements, onAdd, onDelete }: { achievements: Achievement[]; onAdd: () => void; onDelete: (id: number) => void }) {
  return <><section className="page-intro"><div><span className="section-kicker">AKADEMIK PROFIL</span><h1>Mening yutuqlarim</h1><p>Test natijalari, sertifikatlar va boshqa yutuqlaringizni boshqaring.</p></div><button className="btn btn-primary" onClick={onAdd}><Plus size={16} /> Yutuq qo‘shish</button></section><div className="achievement-grid">{achievements.map((item) => <article className="panel achievement-card" key={item.id}><div className="achievement-top"><span className={`achievement-icon achievement-${item.category.toLowerCase()}`}><Sparkles size={19} /></span><button className="icon-button small" onClick={() => onDelete(item.id)} title="O‘chirish"><X size={15} /></button></div><span className="section-kicker">{item.category}</span><h3>{item.title}</h3><div className="achievement-score">{item.score ?? "—"}<small>{item.category.toLowerCase() === "ielts" ? "/ 9.0" : ""}</small></div><div className="achievement-foot"><span>{item.issuer || "Beruvchi ko‘rsatilmagan"}</span><span>{dateLabel(item.awarded_at)}</span></div></article>)}
      <button className="add-achievement-card" onClick={onAdd}><span><Plus size={19} /></span><b>Yutuq qo‘shish</b><small>IELTS, SAT, GPA, sertifikatlar va boshqalar</small></button>
    </div>{!achievements.length && <div className="panel empty-achievement"><Sparkles size={25} /><h3>Yutuqlaringizni shu yerga qo‘shing</h3><p>Yutuqlar profilingizni boyitadi va dasturlarga mosligingizni baholashga yordam beradi.</p><button className="btn btn-primary" onClick={onAdd}><Plus size={15} /> Birinchi yutuqni qo‘shish</button></div>}</>;
}

function ReviewPage({ applications, programs, token, selected, setSelected, comments, setComments, onReview }: { applications: Application[]; programs: Program[]; token: string | null; selected: number | null; setSelected: (id: number | null) => void; comments: Record<number, string>; setComments: (value: Record<number, string>) => void; onReview: (id: number, action: "accept" | "reject" | "request_information" | "start_review") => void }) {
  const [documents, setDocuments] = useState<ApplicationDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const active = applications.find((item) => item.id === selected);

  useEffect(() => {
    if (!selected || !token) {
      setDocuments([]);
      setDocumentsError("");
      return;
    }
    let cancelled = false;
    setDocumentsLoading(true);
    setDocumentsError("");
    API.get<ApplicationDocument[]>(`/documents/applications/${selected}`, token)
      .then((items) => { if (!cancelled) setDocuments(items); })
      .catch((reason: unknown) => {
        if (!cancelled) setDocumentsError(reason instanceof Error ? reason.message : "Hujjatlarni yuklab bo‘lmadi");
      })
      .finally(() => { if (!cancelled) setDocumentsLoading(false); });
    return () => { cancelled = true; };
  }, [selected, token]);

  const downloadDocument = async (document: ApplicationDocument) => {
    if (!token) return;
    try {
      const response = await API.fetch(`/documents/${document.id}/download`, {
        headers: { Authorization: `******` },
      });
      if (!response.ok) throw new Error(`Hujjatni yuklab bo‘lmadi (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setDocumentsError(reason instanceof Error ? reason.message : "Hujjatni yuklab bo‘lmadi");
    }
  };

  return <><section className="page-intro"><div><span className="section-kicker">NOMZODLARNI KO‘RIB CHIQISH</span><h1>Arizalar navbati</h1><p>Universitetingizga yuborilgan arizalarni ko‘rib chiqing.</p></div><span className="pill pill-blue"><FileText size={14} /> {applications.length} ta navbatda</span></section>
    <div className={`review-layout ${active ? "has-active" : ""}`}><section className="panel review-list"><div className="review-list-heading"><div><span className="section-kicker">YANGI ARIZALAR</span><h3>Ko‘rib chiqish navbati</h3></div><span>{applications.length}</span></div>
      {applications.length ? applications.map((item) => { const program = programs.find((candidate) => candidate.id === item.program_id); return <button className={`review-item ${selected === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}><span className="university-avatar"><UserRound size={17} /></span><span className="review-item-copy"><b>Ariza #{item.id}</b><small>{program?.name || `Dastur #${item.program_id}`}</small><small>{dateLabel(item.submitted_at)}</small></span><StatusBadge status={item.status} /></button>; }) : <div className="review-empty"><CheckCircle2 size={25} /><b>Hammasi ko‘rib chiqilgan</b><span>Yangi arizalar yuborilganda bu yerda chiqadi.</span></div>}
    </section>{active && <section className="panel review-detail"><div className="review-detail-top"><div><span className="section-kicker">ARIZA #{active.id}</span><h3>{programs.find((item) => item.id === active.program_id)?.name || "Dastur arizasi"}</h3></div><button className="icon-button small" onClick={() => setSelected(null)}><X size={17} /></button></div><div className="detail-meta"><div><small>QABUL DAVRI</small><b>{active.intake}</b></div><div><small>YUBORILGAN VAQTI</small><b>{dateLabel(active.submitted_at)}</b></div><div><small>HOLATI</small><StatusBadge status={active.status} /></div></div><div className="review-statement"><span className="section-kicker">MOTIVATION LETTER</span><p>{active.personal_statement || "Talaba shaxsiy bayonot kiritmagan."}</p></div><section className="review-documents"><div className="section-heading"><div><span className="section-kicker">HUJJATLAR</span><h3>Talaba yuklagan hujjatlar</h3></div><span className="pill pill-blue">{documents.length} ta</span></div>{documentsLoading ? <p className="detail-empty">Hujjatlar yuklanmoqda…</p> : documentsError ? <p className="alert alert-error">{documentsError}</p> : documents.length ? documents.map((document) => <div className="document-line" key={document.id}><FileText size={15} /><span><b>{document.filename}</b><small>{(document.size_bytes / 1024).toFixed(0)} KB · {document.is_verified ? "Tekshirilgan" : "Tekshirilmagan"} · {dateLabel(document.created_at)}</small></span><button className="text-link" onClick={() => void downloadDocument(document)}>Yuklab olish</button></div>) : <p className="detail-empty">Bu arizaga hujjat yuklanmagan.</p>}</section><div className="eligibility-box"><div className="eligibility-head"><ShieldCheck size={17} /><b>Talablar bilan moslik</b></div><p>Bu faqat ma’lumot uchun berilgan taxminiy baho, qabul kafolati emas.</p>{Object.entries(active.eligibility.requirements || {}).map(([key, item]) => <div className="eligibility-row" key={key}><span>{key}: {item.student_score ?? "yo‘q"} / {item.required}</span>{item.meets_requirement ? <CheckCircle2 size={15} className="success-icon" /> : <X size={15} className="danger-icon" />}</div>)}</div><Field label="Ichki izoh / nomzodga xabar"><textarea rows={3} value={comments[active.id] || ""} onChange={(event) => setComments({ ...comments, [active.id]: event.target.value })} placeholder="Izoh kiriting..." /></Field><div className="review-actions">{active.status === "submitted" && <button className="btn btn-soft" onClick={() => onReview(active.id, "start_review")}><Search size={15} /> Ko‘rib chiqish</button>}<button className="btn btn-soft" onClick={() => onReview(active.id, "request_information")}><FileText size={15} /> Ma’lumot so‘rash</button><button className="btn btn-danger-soft" onClick={() => onReview(active.id, "reject")}>Rad etish</button><button className="btn btn-primary" onClick={() => onReview(active.id, "accept")}><Check size={15} /> Qabul qilish</button></div></section>}</div>
  </>;
}

function ProgramsAdminPage({ programs, onAdd, onDelete }: { programs: Program[]; onAdd: () => void; onDelete: (id: number) => void }) {
  return <><section className="page-intro"><div><span className="section-kicker">UNIVERSITET PROFILI</span><h1>O‘quv dasturlari</h1><p>Talabalar ko‘radigan dasturlar va qabul talablarini yangilang.</p></div><button className="btn btn-primary" onClick={onAdd}><Plus size={16} /> Dastur qo‘shish</button></section><section className="panel programs-admin"><div className="section-heading"><div><span className="section-kicker">DASTURLAR KATALOGI</span><h3>Faol dasturlar</h3></div><span className="pill pill-blue">{programs.length} ta dastur</span></div>{programs.length ? programs.map((program) => <div className="program-admin-row" key={program.id}><span className="program-mark program-mark-blue"><BookOpen size={18} /></span><span className="program-row-main"><b>{program.name}</b><small>{program.degree} · {program.subject} · {program.language}</small></span><span className="program-row-meta"><b>{money(program.tuition, program.currency)}</b><small>{program.intake} · deadline {dateLabel(program.deadline)}</small></span><button className="icon-button small" title="Dastur o‘chirish" onClick={() => onDelete(program.id)}><X size={15} /></button></div>) : <EmptyState title="Hali dastur qo‘shilmagan" text="Talabalar katalogida ko‘rinishi uchun birinchi dasturni yarating." action="Birinchi dastur" onAction={onAdd} />}</section></>;
}

function AdminUniversitiesPage({ pending, allUniversities, onDecision, onAdd, onInvite }: { pending: University[]; allUniversities: University[]; onDecision: (item: University, decision: "approve" | "reject") => void; onAdd: () => void; onInvite: () => void }) {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const shown = tab === "pending" ? pending : allUniversities;
  return <><section className="page-intro"><div><span className="section-kicker">HAMKORLAR KATALOGI</span><h1>Universitetlar</h1><p>Universitet profillarini tasdiqlang va xodimlarni taklif qiling.</p></div><div className="intro-actions"><button className="btn btn-soft" onClick={onInvite}><Users size={15} /> Xodim taklif qilish</button><button className="btn btn-primary" onClick={onAdd}><Plus size={15} /> Universitet qo‘shish</button></div></section>
    <section className="panel application-table-panel"><div className="table-toolbar"><div className="filter-tabs"><button className={tab === "pending" ? "selected" : ""} onClick={() => setTab("pending")}>Tasdiqlash kutilmoqda <span>{pending.length}</span></button><button className={tab === "all" ? "selected" : ""} onClick={() => setTab("all")}>Barcha universitetlar <span>{allUniversities.length}</span></button></div></div>{shown.length ? <div className="application-table">{shown.map((item) => <div className="application-table-row" key={item.id}><span className="university-avatar"><GraduationCap size={18} /></span><div className="table-program"><b>{item.name}</b><small>ID: {item.id} · {item.city}, {item.country} · {item.contact_email}</small></div><span className={`pill ${item.is_approved ? "pill-green" : item.review_status === "rejected" ? "pill-red" : "pill-amber"}`}>{item.review_status}</span><div className="row-actions">{!item.is_approved && item.review_status !== "rejected" && <><button className="btn btn-primary btn-xs" onClick={() => onDecision(item, "approve")}><Check size={13} /> Tasdiqlash</button><button className="btn btn-danger-soft btn-xs" onClick={() => onDecision(item, "reject")}>Rad etish</button></>}</div></div>)}</div> : <EmptyState title="Universitetlar mavjud emas" text="Tasdiqlash uchun so‘rovlar kelganda shu yerda ko‘rinadi." />}</section>
  </>;
}

function UsersPage({ users, onToggle }: { users: User[]; onToggle: (user: User) => void }) {
  const [query, setQuery] = useState("");
  const shown = users.filter((user) => `${user.username} ${user.email} ${user.role}`.toLowerCase().includes(query.toLowerCase()));
  return <><section className="page-intro"><div><span className="section-kicker">PLATFORMA HISOBLARI</span><h1>Foydalanuvchilar</h1><p>Hisoblar holati va ruxsatlarini boshqaring.</p></div><span className="pill pill-blue"><Users size={14} /> {users.length} ta hisob</span></section><section className="panel application-table-panel"><div className="table-toolbar"><div className="users-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ism, email yoki rol..." /></div><span className="muted-label">{shown.length} natija</span></div>{shown.length ? <div className="application-table">{shown.map((account) => <div className="application-table-row" key={account.id}><span className="avatar avatar-small">{initials(account.username)}</span><div className="table-program"><b>{account.username}</b><small>{account.email}</small></div><span className={`role-pill role-${account.role}`}>{account.role === "student" ? "Talaba" : account.role === "staff" ? "Xodim" : "Admin"}</span><span className={`pill ${account.is_active ? "pill-green" : "pill-red"}`}>{account.is_active ? "Faol" : "Faolsiz"}</span><button className={`btn btn-xs ${account.is_active ? "btn-danger-soft" : "btn-soft"}`} onClick={() => onToggle(account)}>{account.is_active ? "O‘chirish" : "Faollashtirish"}</button></div>)}</div> : <EmptyState title="Hisob topilmadi" text="Qidiruvni o‘zgartirib ko‘ring." />}</section></>;
}

function NotificationsPopover({ items, onRead, onReadAll, onClose }: { items: Notification[]; onRead: (item: Notification) => void; onReadAll: () => void; onClose: () => void }) {
  return <><button className="popover-backdrop" aria-label="Bildirishnomalarni yopish" onClick={onClose} /><section className="notification-popover"><div className="notification-heading"><div><b>Bildirishnomalar</b><small>{items.filter((item) => !item.is_read).length} ta o‘qilmagan</small></div><button className="text-link" onClick={onReadAll}>Barchasini o‘qish</button><button className="icon-button small" onClick={onClose}><X size={16} /></button></div><div className="notification-list">{items.length ? items.slice(0, 8).map((item) => <button className={`notification-item ${item.is_read ? "" : "unread"}`} key={item.id} onClick={() => onRead(item)}><span className="notification-icon"><Bell size={15} /></span><span><b>{item.title}</b><small>{item.message}</small><time>{dateLabel(item.created_at)}</time></span>{!item.is_read && <i />}</button>) : <div className="notification-empty"><Bell size={22} /><span>Hozircha bildirishnomalar yo‘q</span></div>}</div></section></>;
}

function ProgramModal({ program, university, user, onClose, onApply }: { program: Program; university?: University; user: User | null; onClose: () => void; onApply: () => void }) {
  return <Modal title="" onClose={onClose} wide><div className="program-detail"><div className="program-detail-banner"><div className="detail-uni-mark"><GraduationCap size={31} /></div><span className="pill pill-green"><span className="status-dot" /> Qabul ochiq</span><span className="program-detail-deco">✦</span></div><div className="program-detail-body"><span className="section-kicker">{university?.name || "Universitet"}</span><h2>{program.name}</h2><p className="detail-description">{program.description || `${program.subject} bo‘yicha ${program.degree} darajasida o‘qish imkoniyati.`}</p><div className="detail-chips"><span><BookOpen size={14} /> {program.degree}</span><span><Globe2 size={14} /> {program.language}</span><span><Clock3 size={14} /> {program.intake}</span></div><div className="program-detail-grid"><div><small>YILLIK KONTRAKT</small><b>{money(program.tuition, program.currency)}</b></div><div><small>ARIZA MUDDATI</small><b>{dateLabel(program.deadline)}</b></div><div><small>DAVLAT / SHAHAR</small><b>{university ? `${university.city}, ${university.country}` : program.subject}</b></div></div><div className="requirements"><h4>Qabul talablari</h4>{Object.entries(program.requirements || {}).length ? Object.entries(program.requirements).map(([key, value]) => <span key={key}><CheckCircle2 size={15} /> {key} kamida {value}</span>) : <p>Maxsus akademik talablar kiritilmagan.</p>}</div><div className="detail-apply-row"><p><ShieldCheck size={15} /> {user ? "Ariza qoralamasini bepul yarating." : "Ariza uchun tizimga kiring."}</p><button className="btn btn-primary" onClick={onApply}>{user ? "Arizani boshlash" : "Kirish va ariza berish"} <ArrowRight size={15} /></button></div></div></div></Modal>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title || "Dastur ma’lumoti"}><div className="modal-heading">{title && <h2>{title}</h2>}<button className="icon-button small" onClick={onClose} aria-label="Yopish"><X size={18} /></button></div>{children}</section></div>;
}

function AuthModal({ mode, setMode, onClose, loginForm, setLoginForm, onLogin, busy, registerForm, setRegisterForm, authStep, setAuthStep, onSendOtp, onVerifyOtp, onRegister, forgotForm, setForgotForm, onForgot, error, setError, staffAcceptForm, setStaffAcceptForm, onAcceptStaffInvitation, adminSetupAvailable, adminSetupForm, setAdminSetupForm, onRegisterAdmin }: {
  mode: "login" | "register" | "forgot" | "staff" | "admin-setup"; setMode: (mode: "login" | "register" | "forgot" | "staff" | "admin-setup" | null) => void; onClose: () => void;
  loginForm: { username: string; password: string }; setLoginForm: (value: { username: string; password: string }) => void; onLogin: (event: FormEvent) => void; busy: boolean;
  registerForm: { email: string; code: string; username: string; password: string; first_name: string; last_name: string }; setRegisterForm: (value: typeof registerForm) => void;
  authStep: "details" | "verified"; setAuthStep: (step: "details" | "verified") => void; onSendOtp: () => void; onVerifyOtp: () => void; onRegister: (event: FormEvent) => void;
  forgotForm: { email: string; code: string; new_password: string }; setForgotForm: (value: typeof forgotForm) => void; onForgot: (event: FormEvent) => void; error: string; setError: (value: string) => void;
  staffAcceptForm: { token: string; username: string; password: string; first_name: string; last_name: string }; setStaffAcceptForm: (value: typeof staffAcceptForm) => void; onAcceptStaffInvitation: (event: FormEvent) => void;
  adminSetupAvailable: boolean; adminSetupForm: { setup_token: string; email: string; username: string; password: string; first_name: string; last_name: string }; setAdminSetupForm: (value: typeof adminSetupForm) => void; onRegisterAdmin: (event: FormEvent) => void;
}) {
  return <div className="auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="auth-dialog"><div className="auth-side"><div className="brand brand-white"><span className="brand-mark"><GraduationCap size={22} /></span><span>uni<span className="brand-accent">apply</span></span></div><div className="auth-side-copy"><span className="pill pill-glass"><Sparkles size={13} /> SIZNING TA’LIM SAFARINGIZ</span><h2>Katta maqsadlar<br />shu yerdan<br /><span>boshlanadi.</span></h2><p>Eng yaxshi universitetlarga ariza topshirish endi osonroq.</p></div><div className="auth-side-bottom"><div className="auth-side-avatars"><i>A</i><i>M</i><i>S</i></div><span><b>Kelajagini tanlaganlar</b><small>siz bilan birga</small></span></div><span className="auth-decoration">✳</span></div><div className="auth-main"><button className="auth-close" onClick={onClose} aria-label="Yopish"><X size={19} /></button>
    {mode === "login" && <><div className="auth-heading"><span className="section-kicker">QAYTGANINGIZDAN XURSANDMIZ</span><h1>Xush kelibsiz</h1><p>Hisobingizga kiring va safaringizni davom ettiring.</p></div>{error && <div className="alert alert-error auth-error"><X size={15} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}<form className="auth-form" onSubmit={onLogin}><Field label="Foydalanuvchi nomi"><input autoFocus autoComplete="username" required value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} placeholder="username" /></Field><Field label="Parol"><input required type="password" autoComplete="current-password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder="Kamida 8 ta belgi" /></Field><button className="forgot-link" type="button" onClick={() => { setError(""); setMode("forgot"); }}>Parolni unutdingizmi?</button><button className="btn btn-primary auth-submit" disabled={busy}>{busy ? "Tekshirilmoqda…" : "Hisobga kirish"} <ArrowRight size={16} /></button></form><div className="auth-switch">Hisobingiz yo‘qmi? <button onClick={() => { setError(""); setAuthStep("details"); setMode("register"); }}>Bepul ro‘yxatdan o‘ting</button></div><div className="auth-switch staff-switch">Universitet xodimimisiz? <button onClick={() => { setError(""); setMode("staff"); }}>Taklifnomani qabul qilish</button></div>{adminSetupAvailable && <div className="auth-switch staff-switch">Birinchi admin hisobini yaratyapsizmi? <button onClick={() => { setError(""); setMode("admin-setup"); }}>Adminni ro‘yxatdan o‘tkazish</button></div>}</>}
    {mode === "register" && <><div className="auth-heading"><span className="section-kicker">BEPUL TALABA HISOBI</span><h1>Hisob yarating</h1><p>Yangi imkoniyatlar sari birinchi qadamingiz.</p></div>{error && <div className="alert alert-error auth-error"><X size={15} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}<form className="auth-form" onSubmit={authStep === "verified" ? onRegister : (event) => { event.preventDefault(); void onSendOtp(); }}>
      {authStep === "details" ? <><Field label="Gmail manzilingiz"><div className="input-action"><input required type="email" value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} placeholder="siz@gmail.com" /><button type="button" className="inline-action" onClick={onSendOtp} disabled={busy}>Kod yuborish</button></div></Field><Field label="Emailga yuborilgan 6 xonali kod"><div className="input-action"><input required inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={registerForm.code} onChange={(e) => setRegisterForm({ ...registerForm, code: e.target.value.replace(/\D/g, "") })} placeholder="000000" /><button type="button" className="inline-action" onClick={onVerifyOtp} disabled={busy || registerForm.code.length !== 6}>Tasdiqlash</button></div></Field><div className="auth-hint"><ShieldCheck size={15} /> Kod 5 daqiqa amal qiladi.</div><button type="submit" className="btn btn-primary auth-submit" disabled={busy}>Kod yuborish <ArrowRight size={16} /></button></> :
      <><div className="verified-banner"><CheckCircle2 size={17} /> Email tasdiqlandi: {registerForm.email}</div><div className="form-grid"><Field label="Ism"><input required autoFocus value={registerForm.first_name} onChange={(e) => setRegisterForm({ ...registerForm, first_name: e.target.value })} /></Field><Field label="Familiya"><input required value={registerForm.last_name} onChange={(e) => setRegisterForm({ ...registerForm, last_name: e.target.value })} /></Field></div><Field label="Foydalanuvchi nomi"><input required minLength={3} pattern="[A-Za-z0-9_.-]+" value={registerForm.username} onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })} placeholder="username" /></Field><Field label="Parol"><input required type="password" minLength={8} value={registerForm.password} onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })} placeholder="Kamida 8 ta belgi" /></Field><button type="submit" className="btn btn-primary auth-submit" disabled={busy}>{busy ? "Hisob yaratilmoqda…" : "Talaba hisobini yaratish"} <ArrowRight size={16} /></button></>}
    </form><div className="auth-switch">Hisobingiz bormi? <button onClick={() => { setError(""); setMode("login"); }}>Kirish</button></div></>}
    {mode === "forgot" && <><div className="auth-heading"><span className="section-kicker">HISOB XAVFSIZLIGI</span><h1>Parolni tiklash</h1><p>Email manzilingizga tasdiqlash kodini yuboramiz.</p></div>{error && <div className="alert alert-error auth-error"><X size={15} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}<form className="auth-form" onSubmit={onForgot}><Field label="Email manzili"><input required type="email" value={forgotForm.email} onChange={(e) => setForgotForm({ ...forgotForm, email: e.target.value })} placeholder="siz@gmail.com" /></Field><div className="input-action"><input inputMode="numeric" maxLength={6} value={forgotForm.code} onChange={(e) => setForgotForm({ ...forgotForm, code: e.target.value.replace(/\D/g, "") })} placeholder="6 xonali kod" /><button className="inline-action" type="button" onClick={onForgot} disabled={busy}>Kod yuborish</button></div>{forgotForm.code && <Field label="Yangi parol"><input required type="password" minLength={8} value={forgotForm.new_password} onChange={(e) => setForgotForm({ ...forgotForm, new_password: e.target.value })} /></Field>}<button className="btn btn-primary auth-submit" disabled={busy}>{busy ? "Bajarilmoqda…" : forgotForm.code ? "Parolni yangilash" : "Tasdiqlash kodini yuborish"} <ArrowRight size={16} /></button></form><div className="auth-switch"><button onClick={() => { setError(""); setMode("login"); }}>Kirishga qaytish</button></div></>}
    {mode === "staff" && <><div className="auth-heading"><span className="section-kicker">UNIVERSITET JAMOASIGA QO‘SHILING</span><h1>Xodim hisobini yarating</h1><p>Admin yuborgan taklifnoma tokenini kiriting.</p></div>{error && <div className="alert alert-error auth-error"><X size={15} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}<form className="auth-form" onSubmit={onAcceptStaffInvitation}><Field label="Taklifnoma tokeni"><input required value={staffAcceptForm.token} onChange={(event) => setStaffAcceptForm({ ...staffAcceptForm, token: event.target.value })} placeholder="Emaildagi taklifnoma tokeni" /></Field><div className="form-grid"><Field label="Ism"><input required value={staffAcceptForm.first_name} onChange={(event) => setStaffAcceptForm({ ...staffAcceptForm, first_name: event.target.value })} /></Field><Field label="Familiya"><input required value={staffAcceptForm.last_name} onChange={(event) => setStaffAcceptForm({ ...staffAcceptForm, last_name: event.target.value })} /></Field></div><Field label="Foydalanuvchi nomi"><input required minLength={3} pattern="[A-Za-z0-9_.-]+" value={staffAcceptForm.username} onChange={(event) => setStaffAcceptForm({ ...staffAcceptForm, username: event.target.value })} /></Field><Field label="Parol"><input required minLength={8} type="password" value={staffAcceptForm.password} onChange={(event) => setStaffAcceptForm({ ...staffAcceptForm, password: event.target.value })} /></Field><button className="btn btn-primary auth-submit" disabled={busy}>{busy ? "Hisob yaratilmoqda…" : "Xodim hisobini yaratish"} <ArrowRight size={16} /></button></form><div className="auth-switch"><button onClick={() => { setError(""); setMode("login"); }}>Kirishga qaytish</button></div></>}
    {mode === "admin-setup" && <><div className="auth-heading"><span className="section-kicker">BIR MARTALIK XAVFSIZ SOZLASH</span><h1>Birinchi admin hisobi</h1><p>Server egasi bergan maxfiy setup-kod kerak. Birinchi admin yaratilgach, bu bo‘lim yopiladi.</p></div>{error && <div className="alert alert-error auth-error"><X size={15} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}{adminSetupAvailable ? <form className="auth-form" onSubmit={onRegisterAdmin}><Field label="Maxfiy setup-kod"><input required minLength={32} type="password" autoComplete="off" value={adminSetupForm.setup_token} onChange={(event) => setAdminSetupForm({ ...adminSetupForm, setup_token: event.target.value })} /></Field><Field label="Admin email"><input required type="email" value={adminSetupForm.email} onChange={(event) => setAdminSetupForm({ ...adminSetupForm, email: event.target.value })} /></Field><Field label="Foydalanuvchi nomi"><input required minLength={3} pattern="[A-Za-z0-9_.-]+" value={adminSetupForm.username} onChange={(event) => setAdminSetupForm({ ...adminSetupForm, username: event.target.value })} /></Field><div className="form-grid"><Field label="Ism"><input required value={adminSetupForm.first_name} onChange={(event) => setAdminSetupForm({ ...adminSetupForm, first_name: event.target.value })} /></Field><Field label="Familiya"><input required value={adminSetupForm.last_name} onChange={(event) => setAdminSetupForm({ ...adminSetupForm, last_name: event.target.value })} /></Field></div><Field label="Kuchli parol (kamida 12 belgi)"><input required minLength={12} type="password" autoComplete="new-password" value={adminSetupForm.password} onChange={(event) => setAdminSetupForm({ ...adminSetupForm, password: event.target.value })} /></Field><button className="btn btn-primary auth-submit" disabled={busy}>{busy ? "Admin hisobi yaratilmoqda…" : "Birinchi adminni yaratish"} <ShieldCheck size={15} /></button></form> : <div className="alert alert-error">Admin setup hozir mavjud emas yoki admin avvaldan yaratilgan.</div>}<div className="auth-switch"><button onClick={() => { setError(""); setMode("login"); }}>Kirishga qaytish</button></div></>}
    <div className="auth-legal">Davom etish orqali siz <a href="#terms">Foydalanish shartlari</a> va <a href="#privacy">Maxfiylik siyosati</a>ga rozilik bildirasiz.</div>
  </div></section></div>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "accepted" ? "pill-green" : status === "rejected" || status === "withdrawn" ? "pill-red" : status === "draft" ? "pill-gray" : status === "information_requested" ? "pill-amber" : "pill-blue";
  return <span className={`pill status-badge ${tone}`}><i className="status-dot" />{statusName(status)}</span>;
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><GraduationCap size={22} /></span><b>{title}</b><p>{text}</p>{action && onAction && <button className="text-link" onClick={onAction}>{action} <ArrowRight size={14} /></button>}</div>;
}
