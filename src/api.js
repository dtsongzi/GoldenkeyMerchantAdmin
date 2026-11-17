// 后端 API 封装。接口统一在 /goldenkey/api 下（页面在 /goldenkeyadmin/，两者前缀不同）。
const BASE = '/goldenkey/api';

// 401 时清除失效 token 并回到登录页（自愈，避免卡在"已登录但接口全 401"）
function clearSessionAndRedirect() {
  localStorage.removeItem('gk_token');
  localStorage.removeItem('gk_user');
  // 回站点根（跟着 Vite base 走，避免写死路径）
  window.location.href = import.meta.env.BASE_URL || '/goldenkeyadmin/';
}

async function request(path, options = {}) {
  const token = localStorage.getItem('gk_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...options, headers });
  if (res.status === 401) {
    clearSessionAndRedirect();
    throw new Error('登录已失效，请重新登录');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function qs(obj) {
  const p = new URLSearchParams();
  for (const k in obj) if (obj[k] !== '' && obj[k] != null) p.set(k, obj[k]);
  const s = p.toString();
  return s ? '?' + s : '';
}

// 读取当前登录用户（角色 / teacherId）
export function currentUser() {
  try { return JSON.parse(localStorage.getItem('gk_user') || 'null'); } catch { return null; }
}

export const api = {
  login: (username, password) => request('/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/me'),

  // 概览
  stats: () => request('/admin/stats'),
  charts: () => request('/admin/charts'),

  teachers: () => request('/teachers'),

  // 教师管理（管理员）：档案 + 登录账号
  listAdminTeachers: (q = {}) => request('/admin/teachers' + qs(q)),
  // 单条详情：含履历与照片（列表为控制体积不含 base64 照片）
  adminTeacherDetail: (id) => request(`/admin/teachers/${id}`),
  createTeacher: (body) => request('/admin/teachers', { method: 'POST', body: JSON.stringify(body) }),
  updateTeacher: (id, body) => request(`/admin/teachers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  resetTeacherPassword: (id, password) =>
    request(`/admin/teachers/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  deleteTeacher: (id) => request(`/admin/teachers/${id}`, { method: 'DELETE' }),

  // 课程
  listCourses: () => request('/admin/courses'),
  teacherCourses: () => request('/teacher/courses'),
  createCourse: (body) => request('/admin/courses', { method: 'POST', body: JSON.stringify(body) }),
  applyCourse: (body) => request('/teacher/courses', { method: 'POST', body: JSON.stringify(body) }),
  updateCourse: (id, body) => request(`/admin/courses/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCourse: (id) => request(`/admin/courses/${id}`, { method: 'DELETE' }),
  reviewCourse: (id, action) => request(`/admin/courses/${id}/review`, { method: 'PUT', body: JSON.stringify({ action }) }),
  courseDetail: (id) => request(`/admin/courses/${id}/detail`),
  teacherCourseDetail: (id) => request(`/teacher/courses/${id}/detail`),

  // 学生
  listMembers: () => request('/admin/members'),
  teacherStudents: () => request('/teacher/students'),
  studentDetail: (id) => request(`/admin/members/${id}/detail`),
  teacherStudentDetail: (id) => request(`/teacher/students/${id}/detail`),

  // 课程报名审核（管理员看全部 / 教师限自己名下课程）
  enrollments: (q = {}) => request('/admin/enrollments' + qs(q)),
  enrollmentStats: () => request('/admin/enrollments/stats'),
  reviewEnrollment: (id, action, note) =>
    request(`/admin/enrollments/${id}/review`, { method: 'PUT', body: JSON.stringify({ action, note }) }),

  // 上课记录
  listRecords: (q = {}) => request('/admin/records' + qs(q)),
  teacherRecords: (q = {}) => request('/teacher/records' + qs(q)),

  // 排课
  scheduleGrid: (q = {}) => request('/admin/schedule' + qs(q)),
  updateScheduleBlock: (id, body) => request(`/admin/schedule/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteScheduleBlock: (id, kind) => request(`/admin/schedule/${id}?kind=${kind || 'avail'}`, { method: 'DELETE' }),
  createScheduleBlock: (body) => request('/admin/schedule', { method: 'POST', body: JSON.stringify(body) }),
  quickSchedule: (body) => request('/admin/quick-schedule', { method: 'POST', body: JSON.stringify(body) }),

  // 排课管理：课程实例（独立于可约时段，支持学生/备注/状态/循环系列/冲突预检）
  lessons: (query = {}) => request('/admin/lessons' + qs(query)),
  createLesson: (body) => request('/admin/lessons', { method: 'POST', body: JSON.stringify(body) }),
  updateLesson: (id, body) => request(`/admin/lessons/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteLesson: (id) => request(`/admin/lessons/${id}`, { method: 'DELETE' }),
  duplicateLesson: (id) => request(`/admin/lessons/${id}/duplicate`, { method: 'POST' }),
  batchLessons: (body) => request('/admin/lessons/batch', { method: 'POST', body: JSON.stringify(body) }),
  lessonConflicts: (body) => request('/admin/lessons/conflicts', { method: 'POST', body: JSON.stringify(body) }),
  updateLessonSeries: (seriesId, body) =>
    request(`/admin/lessons/series/${encodeURIComponent(seriesId)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteLessonSeries: (seriesId) =>
    request(`/admin/lessons/series/${encodeURIComponent(seriesId)}`, { method: 'DELETE' }),
  restoreLessons: (body) => request('/admin/lessons/restore', { method: 'POST', body: JSON.stringify(body) }),
  // 空壳课（网站自建、无学生、无系列）：小程序里没有对应可约时段，用于对账清理
  lessonOrphans: (query = {}) => request('/admin/lessons/orphans' + qs(query)),
  cleanupLessonOrphans: (ids) =>
    request('/admin/lessons/orphans/cleanup', { method: 'POST', body: JSON.stringify({ ids }) }),
  // 批量删除：复用 restore 的「空快照」语义（只给 ids、不传 lessons，事务内删除课程及学生关联）
  deleteLessons: (ids) => request('/admin/lessons/restore', {
    method: 'POST', body: JSON.stringify({ ids, lessons: [] }),
  }),
  exportLessons: async (query = {}) => {
    const token = localStorage.getItem('gk_token');
    const res = await fetch(`${BASE}/admin/lessons/export${qs(query)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { clearSessionAndRedirect(); throw new Error('登录已失效，请重新登录'); }
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `课表_${query.from || ''}_${query.to || ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // 教室 / 琴房
  classrooms: () => request('/admin/classrooms'),
  createClassroom: (body) => request('/admin/classrooms', { method: 'POST', body: JSON.stringify(body) }),
  updateClassroom: (id, body) => request(`/admin/classrooms/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteClassroom: (id) => request(`/admin/classrooms/${id}`, { method: 'DELETE' }),
  // 导出课表（带鉴权，前端 fetch + blob 下载）
  downloadSchedule: async (from, to, teacherId) => {
    const token = localStorage.getItem('gk_token');
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (teacherId) p.set('teacherId', teacherId);
    const res = await fetch(`${BASE}/admin/schedule/export?${p.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { clearSessionAndRedirect(); throw new Error('登录已失效，请重新登录'); }
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schedule.csv';
    a.click();
    URL.revokeObjectURL(url);
  },
};
