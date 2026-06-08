// ═══════════════════════════════════════════════════
// МарГУ ПОРТАЛ АТТЕСТАЦИИ — app.js (v2)
// ═══════════════════════════════════════════════════

// ── EmailJS CONFIG ──
// Uses EmailJS (emailjs.com) — free tier: 200 emails/month
// Service: Gmail relay, no backend needed
const EMAILJS_SERVICE  = 'service_margu';   // replace with your EmailJS service ID
const EMAILJS_TEMPLATE = 'template_margu';  // replace with your EmailJS template ID
const EMAILJS_KEY      = 'YOUR_PUBLIC_KEY'; // replace with your EmailJS public key

// ── DB HELPERS ──
const DB = {
  get(k)       { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v)    { localStorage.setItem(k, JSON.stringify(v)); },
  del(k)       { localStorage.removeItem(k); },
  getAll(pfx)  {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pfx)) { try { out.push(JSON.parse(localStorage.getItem(k))); } catch {} }
    }
    return out;
  }
};

// ── STATE ──
let currentUser = null;
let currentPage = null;
let pendingRegData = null;   // holds registration data while OTP pending
let currentOTP    = null;
let otpTimerInt   = null;

// ─────────────────────────────────────────────────
// SEED DEMO DATA
// ─────────────────────────────────────────────────
function seedData() {
  if (DB.get('seeded_v2')) return;

  const users = [
    {
      id:'u1', role:'student', name:'Иванов Иван Иванович',
      email:'student@margu.ru', phone:'+79001234567',
      group:'КСИ-21', pass:'123456', verified:true,
      createdAt: new Date().toISOString()
    },
    {
      id:'u2', role:'teacher', name:'Петрова Мария Сергеевна',
      email:'teacher@margu.ru', phone:'+79007654321',
      dept:'Кафедра информатики',
      disciplines:['Информационные системы','Базы данных','Программирование'],
      pass:'123456', verified:true,
      createdAt: new Date().toISOString()
    },
    {
      id:'u3', role:'teacher', name:'Смирнов Алексей Петрович',
      email:'teacher2@margu.ru', phone:'+79007654322',
      dept:'Кафедра математики',
      disciplines:['Математика','Линейная алгебра','Теория вероятностей'],
      pass:'123456', verified:true,
      createdAt: new Date().toISOString()
    },
    {
      id:'u4', role:'admin', name:'Администратор МарГУ',
      email:'admin@margu.ru', phone:'+79009999999',
      pass:'123456', verified:true,
      createdAt: new Date().toISOString()
    },
  ];
  users.forEach(u => DB.set('user:'+u.id, u));
  DB.set('users_index', users.map(u => ({ id:u.id, email:u.email, phone:u.phone })));
  DB.set('admin_exists', true);

  // Commissions
  [
    { id:'c1', name:'Комиссия по защите дипломных работ 2024',
      subject:'Информационные системы', teacherId:'u2',
      status:'active', date:'2024-06-25', createdAt: new Date().toISOString() },
    { id:'c2', name:'Комиссия по математическому анализу',
      subject:'Математика', teacherId:'u3',
      status:'active', date:'2024-06-28', createdAt: new Date().toISOString() },
  ].forEach(c => DB.set('commission:'+c.id, c));

  // Applications
  [
    {
      id:'a1', studentId:'u1', teacherId:'u2',
      discipline:'Информационные системы',
      commissionId:'c1', status:'pending', type:'Дипломная работа',
      title:'Разработка ИС управления учебным процессом',
      files:[{ name:'diplom.pdf', size:'2.4 МБ' }],
      createdAt: new Date(Date.now()-86400000).toISOString(), teacherComment:''
    },
  ].forEach(a => DB.set('app:'+a.id, a));

  DB.set('notifs:u1', [{ id:'n1', text:'Ваша заявка принята на проверку', unread:true, time:new Date().toISOString() }]);
  DB.set('notifs:u2', [{ id:'n1', text:'Новая заявка от студента Иванов И.И.', unread:true, time:new Date().toISOString() }]);
  DB.set('seeded_v2', true);
}

// ─────────────────────────────────────────────────
// AUTH — ROLE SELECT
// ─────────────────────────────────────────────────
let selectedRole = 'student';

function selectRole(role) {
  selectedRole = role;
  ['student','teacher','admin'].forEach(r => {
    document.getElementById('role-'+r).classList.toggle('active', r === role);
  });
  document.getElementById('group-field-student').classList.toggle('hidden', role !== 'student');
  document.getElementById('group-field-dept').classList.toggle('hidden', role === 'student');
  document.getElementById('group-field-disciplines').classList.toggle('hidden', role !== 'teacher');
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((el,i) =>
    el.classList.toggle('active', (i===0 && tab==='login') || (i===1 && tab==='register')));
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  // hide admin option if admin exists
  refreshAdminRoleBtn();
}

function refreshAdminRoleBtn() {
  const adminBtn = document.getElementById('role-admin');
  if (!adminBtn) return;
  const exists = DB.get('admin_exists');
  if (exists) {
    adminBtn.setAttribute('data-disabled','1');
    adminBtn.style.opacity = '0.35';
    adminBtn.style.cursor = 'not-allowed';
    adminBtn.style.pointerEvents = 'none';
    adminBtn.title = 'Администратор уже зарегистрирован в системе';
    // if currently selected admin, switch to student
    if (selectedRole === 'admin') selectRole('student');
  } else {
    adminBtn.removeAttribute('data-disabled');
    adminBtn.style.opacity = '';
    adminBtn.style.cursor = '';
    adminBtn.style.pointerEvents = '';
    adminBtn.title = '';
  }
}

// ─────────────────────────────────────────────────
// REGISTRATION FLOW
// ─────────────────────────────────────────────────
function startRegister() {
  const name   = document.getElementById('reg-name').value.trim();
  const email  = document.getElementById('reg-email').value.trim();
  const phone  = document.getElementById('reg-phone').value.trim();
  const pass   = document.getElementById('reg-pass').value;
  const group  = document.getElementById('reg-group').value.trim();
  const dept   = document.getElementById('reg-dept').value.trim();
  const discsRaw = document.getElementById('reg-disciplines').value.trim();

  if (!name)  return toast('Введите ФИО', 'error');
  if (!email) return toast('Email обязателен для подтверждения', 'error');
  if (!/\S+@\S+\.\S+/.test(email)) return toast('Введите корректный email', 'error');
  if (!pass || pass.length < 6) return toast('Пароль минимум 6 символов', 'error');
  if (selectedRole === 'admin' && DB.get('admin_exists')) return toast('Администратор уже существует', 'error');

  const index = DB.get('users_index') || [];
  if (index.find(u => u.email === email)) return toast('Email уже зарегистрирован', 'error');
  if (phone && index.find(u => u.phone === phone)) return toast('Телефон уже зарегистрирован', 'error');

  const disciplines = selectedRole === 'teacher'
    ? discsRaw.split(',').map(s=>s.trim()).filter(Boolean)
    : [];

  pendingRegData = { name, email, phone, pass, role: selectedRole, group, dept, disciplines };

  sendOTPEmail(email, name);
}

function sendOTPEmail(email, name) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  currentOTP  = code;

  // Show OTP screen
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('otp-screen').style.display  = 'flex';
  document.getElementById('otp-desc').textContent =
    `Мы отправили 6-значный код на ${email}. Введите его ниже для подтверждения.`;
  document.getElementById('otp0').focus();
  startOtpTimer();

  // Try real EmailJS send
  if (typeof emailjs !== 'undefined' && EMAILJS_KEY !== 'YOUR_PUBLIC_KEY') {
    emailjs.init(EMAILJS_KEY);
    emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
      to_email: email,
      to_name:  name,
      otp_code: code,
      reply_to: 'noreply@margu.ru'
    }).then(() => {
      toast('Код отправлен на ' + email, 'success');
    }).catch(err => {
      console.warn('EmailJS error:', err);
      // Fallback: show code in toast for demo
      toast('⚠️ Демо-режим: ваш код — ' + code, 'info');
    });
  } else {
    // Demo mode — show code directly
    setTimeout(() => {
      toast('📧 Демо-режим: код подтверждения — ' + code, 'success');
    }, 600);
  }
}

function startOtpTimer() {
  let secs = 60;
  clearInterval(otpTimerInt);
  document.getElementById('otp-timer-wrap').classList.remove('hidden');
  document.getElementById('otp-resend-link').classList.add('hidden');
  otpTimerInt = setInterval(() => {
    secs--;
    const el = document.getElementById('otp-timer');
    if (el) el.textContent = secs;
    if (secs <= 0) {
      clearInterval(otpTimerInt);
      document.getElementById('otp-timer-wrap').classList.add('hidden');
      document.getElementById('otp-resend-link').classList.remove('hidden');
    }
  }, 1000);
}

function resendOTP() {
  if (!pendingRegData) return;
  sendOTPEmail(pendingRegData.email, pendingRegData.name);
}

function cancelOTP() {
  clearInterval(otpTimerInt);
  currentOTP = null;
  pendingRegData = null;
  document.getElementById('otp-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  [0,1,2,3,4,5].forEach(i => { document.getElementById('otp'+i).value = ''; });
}

function getOTPValue() {
  return [0,1,2,3,4,5].map(i => document.getElementById('otp'+i).value).join('');
}

function otpNext(idx) {
  const val = document.getElementById('otp'+idx).value;
  if (val && idx < 5) document.getElementById('otp'+(idx+1)).focus();
  if (idx === 5 && getOTPValue().length === 6) verifyOTP();
}

function otpBack(e, idx) {
  if (e.key === 'Backspace' && !document.getElementById('otp'+idx).value && idx > 0) {
    document.getElementById('otp'+(idx-1)).focus();
  }
}

function verifyOTP() {
  const entered = getOTPValue();
  if (entered.length < 6) return toast('Введите все 6 цифр', 'error');
  if (entered !== currentOTP) return toast('Неверный код. Попробуйте ещё раз.', 'error');

  // Create user
  const d = pendingRegData;
  const id = 'u' + Date.now();
  const user = {
    id, role: d.role, name: d.name, email: d.email, phone: d.phone,
    pass: d.pass, group: d.group, dept: d.dept,
    disciplines: d.disciplines || [],
    verified: true, createdAt: new Date().toISOString()
  };
  DB.set('user:'+id, user);

  const index = DB.get('users_index') || [];
  index.push({ id, email: d.email, phone: d.phone || '' });
  DB.set('users_index', index);
  DB.set('notifs:'+id, []);

  if (d.role === 'admin') DB.set('admin_exists', true);

  clearInterval(otpTimerInt);
  currentOTP = null;
  pendingRegData = null;

  document.getElementById('otp-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';

  toast('✅ Аккаунт создан! Добро пожаловать!', 'success');
  loginSuccess(user);
}

// ─────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────
function doLogin() {
  const id   = document.getElementById('login-id').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!id || !pass) return toast('Заполните все поля', 'error');

  const index = DB.get('users_index') || [];
  const ref   = index.find(u => u.email === id || u.phone === id);
  if (!ref) return toast('Пользователь не найден', 'error');
  const user = DB.get('user:'+ref.id);
  if (!user || user.pass !== pass) return toast('Неверный пароль', 'error');

  loginSuccess(user);
}

function loginSuccess(user) {
  currentUser = user;
  DB.set('session', user.id);
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('otp-screen').style.display  = 'none';
  document.getElementById('app').style.display         = 'block';
  initApp();
}

function doLogout() {
  currentUser = null;
  DB.set('session', null);
  document.getElementById('app').style.display         = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  refreshAdminRoleBtn();
}

// ─────────────────────────────────────────────────
// APP INIT
// ─────────────────────────────────────────────────
function initApp() {
  const av = currentUser.name.split(' ').slice(0,2).map(w=>w[0]).join('');
  document.getElementById('user-avatar').textContent    = av;
  document.getElementById('user-name-chip').textContent =
    (currentUser.name.split(' ')[0]||'') + ' ' + (currentUser.name.split(' ')[1]||'');

  const navCfg = {
    student: [
      { id:'dashboard',    label:'🏠 Главная' },
      { id:'applications', label:'📋 Мои заявки' },
      { id:'documents',    label:'📁 Документы' },
      { id:'schedule',     label:'📅 Расписание' },
      { id:'profile',      label:'👤 Профиль' },
    ],
    teacher: [
      { id:'dashboard',   label:'🏠 Главная' },
      { id:'review',      label:'📋 Заявки студентов' },
      { id:'commissions', label:'🏛️ Комиссии' },
      { id:'students',    label:'👥 Студенты' },
      { id:'profile',     label:'👤 Профиль' },
    ],
    admin: [
      { id:'dashboard',   label:'🏠 Главная' },
      { id:'all-apps',    label:'📋 Все заявки' },
      { id:'users',       label:'👥 Пользователи' },
      { id:'commissions', label:'🏛️ Комиссии' },
      { id:'reports',     label:'📊 Отчёты' },
    ]
  };

  const tabs = navCfg[currentUser.role] || [];
  document.getElementById('nav-tabs').innerHTML = tabs.map(t =>
    `<button class="nav-btn" id="nav-${t.id}" onclick="navigateTo('${t.id}')">${t.label}</button>`
  ).join('');

  updateNotifBadge();
  navigateTo('dashboard');
}

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('nav-'+page);
  if (btn) btn.classList.add('active');
  const fns = {
    dashboard: renderDashboard, applications: renderApplications,
    documents: renderDocuments, schedule: renderSchedule,
    profile: renderProfile, review: renderReview,
    commissions: renderCommissions, students: renderStudents,
    'all-apps': renderAllApps, users: renderUsers, reports: renderReports,
  };
  if (fns[page]) fns[page]();
}

// ─────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────
function renderDashboard() {
  const role = currentUser.role;

  if (role === 'student') {
    const myApps     = DB.getAll('app:').filter(a => a.studentId === currentUser.id);
    const pending    = myApps.filter(a => a.status==='pending').length;
    const passed     = myApps.filter(a => a.status==='passed').length;
    const failed     = myApps.filter(a => a.status==='failed').length;
    const commissions = DB.getAll('commission:').filter(c => c.status==='active');

    document.getElementById('page-content').innerHTML = `
      <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">Добро пожаловать, ${currentUser.name.split(' ')[1]||currentUser.name}! 👋</h1>
      <p style="color:var(--text2);font-size:13px;margin-bottom:24px;">Ваш портал аттестации МарГУ</p>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-icon" style="background:#eef2ff;">📋</div><div><h3>${myApps.length}</h3><p>Всего заявок</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#fff8e6;">⏳</div><div><h3>${pending}</h3><p>На рассмотрении</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#e6f7ee;">✅</div><div><h3>${passed}</h3><p>Аттестован</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#fee6e6;">❌</div><div><h3>${failed}</h3><p>Не аттестован</p></div></div>
      </div>
      <div class="quick-actions">
        <div class="quick-card" onclick="navigateTo('applications')"><div class="quick-card-icon" style="background:#eef2ff;">📋</div><div><h3>Подать заявку</h3><p>На аттестацию</p></div></div>
        <div class="quick-card" onclick="navigateTo('documents')"><div class="quick-card-icon" style="background:#e6f7ee;">📁</div><div><h3>Мои документы</h3><p>Загруженные файлы</p></div></div>
        <div class="quick-card" onclick="navigateTo('schedule')"><div class="quick-card-icon" style="background:#fff8e6;">📅</div><div><h3>Расписание</h3><p>Дата заседания</p></div></div>
      </div>
      <div class="two-col">
        <div class="panel">
          <h2>Последние заявки</h2>
          ${myApps.length===0 ? emptyState('📭','Нет заявок') :
            `<div class="table-wrap"><table>
              <thead><tr><th>Дисциплина</th><th>Статус</th><th>Дата</th></tr></thead>
              <tbody>${myApps.slice(-4).map(a=>`<tr>
                <td><b>${a.discipline||a.type}</b></td>
                <td>${statusBadge(a.status)}</td>
                <td style="color:var(--text2)">${new Date(a.createdAt).toLocaleDateString('ru')}</td>
              </tr>`).join('')}</tbody>
            </table></div>`}
        </div>
        <div class="panel">
          <h2>Активные комиссии</h2>
          ${commissions.length===0 ? emptyState('🏛️','Нет активных комиссий') :
            commissions.map(c=>`
              <div style="padding:12px 0;border-bottom:1px solid var(--border);">
                <div style="font-weight:600;font-size:13px;">${c.name}</div>
                <div style="font-size:12px;color:var(--text2);margin-top:3px;">
                  <span class="disc-tag">${c.subject||'—'}</span>
                  📅 ${c.date?new Date(c.date).toLocaleDateString('ru'):'Уточняется'}
                </div>
              </div>`).join('')}
        </div>
      </div>`;

  } else if (role === 'teacher') {
    const myDiscs  = currentUser.disciplines || [];
    const allApps  = DB.getAll('app:');
    // Teacher sees ONLY apps for their disciplines or directly assigned to them
    const myApps   = allApps.filter(a => a.teacherId===currentUser.id || myDiscs.includes(a.discipline));
    const pending  = myApps.filter(a => a.status==='pending').length;
    const passed   = myApps.filter(a => a.status==='passed').length;
    const myComm   = DB.getAll('commission:').filter(c => c.teacherId===currentUser.id);

    document.getElementById('page-content').innerHTML = `
      <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">Добро пожаловать, ${currentUser.name.split(' ')[1]||currentUser.name}! 👨‍🏫</h1>
      <p style="color:var(--text2);font-size:13px;margin-bottom:24px;">Панель преподавателя — ваши дисциплины: ${myDiscs.map(d=>`<span class="disc-tag">${d}</span>`).join('')}</p>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-icon" style="background:#fff8e6;">📋</div><div><h3>${pending}</h3><p>Ожидают проверки</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#e6f7ee;">✅</div><div><h3>${passed}</h3><p>Аттестовано</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#eef2ff;">🏛️</div><div><h3>${myComm.length}</h3><p>Моих комиссий</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#f0e6ff;">📚</div><div><h3>${myDiscs.length}</h3><p>Дисциплин</p></div></div>
      </div>
      <div class="panel">
        <div class="flex justify-between items-center" style="margin-bottom:16px;">
          <h2 style="margin:0;">Заявки, ожидающие проверки</h2>
          <button class="btn btn-blue btn-sm" onclick="navigateTo('review')">Все заявки →</button>
        </div>
        ${pending===0 ? emptyState('✨','Нет заявок для проверки') :
          `<div class="table-wrap"><table>
            <thead><tr><th>Студент</th><th>Дисциплина</th><th>Тип работы</th><th>Дата</th><th>Действие</th></tr></thead>
            <tbody>${myApps.filter(a=>a.status==='pending').slice(0,5).map(a=>{
              const st = DB.get('user:'+a.studentId);
              return `<tr>
                <td><b>${st?st.name:'?'}</b><div style="font-size:11px;color:var(--text2)">${st?st.group||'':''}</div></td>
                <td><span class="disc-tag">${a.discipline||'—'}</span></td>
                <td>${a.type||'—'}</td>
                <td style="color:var(--text2)">${new Date(a.createdAt).toLocaleDateString('ru')}</td>
                <td><button class="btn btn-sm btn-blue" onclick="openReviewModal('${a.id}')">Рассмотреть</button></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`}
      </div>`;

  } else if (role === 'admin') {
    const allApps  = DB.getAll('app:');
    const allUsers = DB.getAll('user:');
    const students = allUsers.filter(u=>u.role==='student');
    const teachers = allUsers.filter(u=>u.role==='teacher');
    const comms    = DB.getAll('commission:');

    document.getElementById('page-content').innerHTML = `
      <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">Панель администратора ⚙️</h1>
      <p style="color:var(--text2);font-size:13px;margin-bottom:24px;">Аналитика и управление аттестацией МарГУ</p>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-icon" style="background:#eef2ff;">📋</div><div><h3>${allApps.length}</h3><p>Всего заявок</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#e6f7ee;">👨‍🎓</div><div><h3>${students.length}</h3><p>Студентов</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#f0e6ff;">🏛️</div><div><h3>${comms.length}/${comms.filter(c=>c.status==='active').length}</h3><p>Комиссий/Активных</p></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#fff8e6;">👨‍🏫</div><div><h3>${teachers.length}</h3><p>Преподавателей</p></div></div>
      </div>
      <div class="quick-actions">
        <div class="quick-card" onclick="showCreateCommissionModal()"><div class="quick-card-icon" style="background:#eef2ff;">+</div><div><h3>Создать комиссию</h3><p>Новая аттестационная комиссия</p></div></div>
        <div class="quick-card" onclick="navigateTo('users')"><div class="quick-card-icon" style="background:#e6f7ee;">👤</div><div><h3>Пользователи</h3><p>Управление аккаунтами</p></div></div>
        <div class="quick-card" onclick="navigateTo('reports')"><div class="quick-card-icon" style="background:#fff8e6;">📊</div><div><h3>Отчёты</h3><p>Экспорт данных</p></div></div>
      </div>
      <div class="two-col">
        <div class="panel"><h2>Статус заявок</h2>${renderStatusChart(allApps)}</div>
        <div class="panel"><h2>Решения комиссий</h2>${renderDecisionChart(allApps)}</div>
      </div>`;
  }
}

// ─────────────────────────────────────────────────
// STUDENT — APPLICATIONS
// ─────────────────────────────────────────────────
function renderApplications() {
  const myApps = DB.getAll('app:').filter(a => a.studentId===currentUser.id);
  document.getElementById('page-content').innerHTML = `
    <div class="flex justify-between items-center" style="margin-bottom:24px;">
      <div>
        <h1 style="font-size:22px;font-weight:700;">Мои заявки</h1>
        <p style="color:var(--text2);font-size:13px;">Заявки на аттестацию по дисциплинам</p>
      </div>
      <button class="btn btn-blue" onclick="showNewAppModal()">+ Новая заявка</button>
    </div>
    ${myApps.length===0 ? `<div class="panel">${emptyState('📭','Нет заявок. Подайте первую.', true)}</div>` :
      myApps.map(a => renderAppCard(a)).join('')}`;
}

function renderAppCard(a) {
  const commission = a.commissionId ? DB.get('commission:'+a.commissionId) : null;
  const teacher    = a.teacherId    ? DB.get('user:'+a.teacherId) : null;
  return `
  <div class="panel" style="margin-bottom:16px;">
    <div class="flex justify-between items-center" style="margin-bottom:12px;">
      <div>
        <div style="font-weight:700;font-size:15px;">${a.title||a.type}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:3px;">
          <span class="disc-tag">${a.discipline||'—'}</span>
          ${teacher?`• Преподаватель: ${teacher.name}`:''}
          ${commission?`• Комиссия: ${commission.name}`:''}
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px;">Подано: ${new Date(a.createdAt).toLocaleDateString('ru')}</div>
      </div>
      ${statusBadge(a.status)}
    </div>
    <div class="flow-steps" style="margin-bottom:12px;">${renderAppFlow(a.status)}</div>
    ${a.files&&a.files.length>0?`
    <div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:5px;text-transform:uppercase;">Документы</div>
      <div class="file-list">${a.files.map(f=>`<div class="file-item"><span>📄</span><span>${f.name}</span><span style="color:var(--text2)">${f.size||''}</span></div>`).join('')}</div>
    </div>`:''}
    ${a.teacherComment?`
    <div style="background:#f4f6fb;border-radius:8px;padding:12px;margin-bottom:10px;border-left:3px solid var(--primary);">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:3px;">КОММЕНТАРИЙ ПРЕПОДАВАТЕЛЯ</div>
      <div style="font-size:13px;">${a.teacherComment}</div>
    </div>`:''}
    ${a.status==='revision'?`<button class="btn btn-blue btn-sm" onclick="showRevisionModal('${a.id}')">📎 Загрузить исправления</button>`:''}
  </div>`;
}

function renderAppFlow(status) {
  const steps = ['Подача','Проверка','Комиссия','Результат'];
  const active = {pending:1, revision:1, passed:3, failed:3}[status]??0;
  return steps.map((s,i)=>`
    <div class="flow-step">
      <div class="flow-step-inner">
        <div class="flow-dot ${i<active?'done':i===active?'active':'pending'}">${i<active?'✓':i+1}</div>
        <div class="flow-label">${s}</div>
      </div>${i<steps.length-1?'<div class="flow-arrow">→</div>':''}
    </div>`).join('');
}

// ── NEW APP MODAL ──
function showNewAppModal() {
  const teachers = DB.getAll('user:').filter(u=>u.role==='teacher'&&u.disciplines&&u.disciplines.length>0);
  const comms    = DB.getAll('commission:').filter(c=>c.status==='active');

  openModal(`
    <h2>📋 Новая заявка на аттестацию</h2>
    <div class="form-group">
      <label>Преподаватель <span style="color:var(--danger)">*</span></label>
      <select id="m-teacher" onchange="onTeacherChange()">
        <option value="">— Выберите преподавателя —</option>
        ${teachers.map(t=>`<option value="${t.id}" data-discs="${(t.disciplines||[]).join('||')}">${t.name} (${t.dept||''})</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Дисциплина <span style="color:var(--danger)">*</span></label>
      <select id="m-disc" disabled>
        <option value="">— Сначала выберите преподавателя —</option>
      </select>
    </div>
    <div class="form-group">
      <label>Тип аттестации</label>
      <select id="m-type">
        <option>Дипломная работа</option><option>Курсовая работа</option>
        <option>Промежуточная аттестация</option><option>Государственный экзамен</option><option>Практика</option>
      </select>
    </div>
    <div class="form-group">
      <label>Название работы / темы <span style="color:var(--danger)">*</span></label>
      <input type="text" id="m-title" placeholder="Введите название..."/>
    </div>
    <div class="form-group">
      <label>Комиссия</label>
      <select id="m-commission">
        <option value="">Без комиссии</option>
        ${comms.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Документы (файлы)</label>
      <div class="file-drop" onclick="document.getElementById('m-file').click()"
           ondragover="onDragOver(event)" ondrop="onFileDrop(event,'m-files-list')">
        <div class="file-icon">📄</div>
        <p>Нажмите или перетащите файлы</p>
        <p style="font-size:11px;margin-top:2px;">PDF, DOCX, XLSX — до 20 МБ</p>
      </div>
      <input type="file" id="m-file" multiple style="display:none" onchange="onFileSelect(this,'m-files-list')">
      <div class="file-list" id="m-files-list"></div>
    </div>
    <div class="form-group">
      <label>Комментарий</label>
      <input type="text" id="m-comment" placeholder="Дополнительная информация..."/>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModalDirect()">Отмена</button>
      <button class="btn btn-blue" onclick="submitNewApp()">Подать заявку</button>
    </div>`);
}

function onTeacherChange() {
  const sel   = document.getElementById('m-teacher');
  const opt   = sel.options[sel.selectedIndex];
  const discs = opt.dataset.discs ? opt.dataset.discs.split('||').filter(Boolean) : [];
  const dSel  = document.getElementById('m-disc');
  dSel.innerHTML = discs.length===0
    ? '<option value="">— Нет дисциплин —</option>'
    : '<option value="">— Выберите дисциплину —</option>' + discs.map(d=>`<option value="${d}">${d}</option>`).join('');
  dSel.disabled = discs.length===0;
}

function submitNewApp() {
  const teacherId = document.getElementById('m-teacher').value;
  const disc      = document.getElementById('m-disc').value;
  const type      = document.getElementById('m-type').value;
  const title     = document.getElementById('m-title').value.trim();
  const commId    = document.getElementById('m-commission').value;
  const comment   = document.getElementById('m-comment').value;

  if (!teacherId) return toast('Выберите преподавателя', 'error');
  if (!disc)      return toast('Выберите дисциплину', 'error');
  if (!title)     return toast('Введите название работы', 'error');

  const fileItems = document.querySelectorAll('#m-files-list .file-item');
  const files = Array.from(fileItems).map(el => ({
    name: el.querySelector('span:nth-child(2)').textContent,
    size: el.querySelector('span:nth-child(3)').textContent,
  }));

  const id = 'a'+Date.now();
  const app = {
    id, studentId: currentUser.id, teacherId, discipline: disc,
    commissionId: commId||'', status:'pending', type, title, files,
    studentComment: comment, teacherComment:'',
    createdAt: new Date().toISOString()
  };
  DB.set('app:'+id, app);

  addNotification(teacherId, `📋 Новая заявка от ${currentUser.name} по дисциплине «${disc}»: «${title}»`);
  addNotification(currentUser.id, `✅ Заявка «${title}» успешно подана`);

  closeModalDirect();
  toast('Заявка подана!', 'success');
  renderApplications();
}

// ─────────────────────────────────────────────────
// STUDENT — DOCUMENTS
// ─────────────────────────────────────────────────
function renderDocuments() {
  const myApps = DB.getAll('app:').filter(a=>a.studentId===currentUser.id);
  const allFiles = myApps.flatMap(a=>(a.files||[]).map(f=>({...f, appTitle:a.title||a.type, disc:a.discipline, date:a.createdAt})));
  document.getElementById('page-content').innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:24px;">Мои документы</h1>
    <div class="panel">
      ${allFiles.length===0 ? emptyState('📁','Нет документов') :
        `<div class="table-wrap"><table>
          <thead><tr><th>Файл</th><th>Дисциплина</th><th>Заявка</th><th>Дата</th></tr></thead>
          <tbody>${allFiles.map(f=>`<tr>
            <td>📄 <b>${f.name}</b></td>
            <td><span class="disc-tag">${f.disc||'—'}</span></td>
            <td style="color:var(--text2)">${f.appTitle}</td>
            <td style="color:var(--text2)">${new Date(f.date).toLocaleDateString('ru')}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
    </div>`;
}

// ─────────────────────────────────────────────────
// STUDENT — SCHEDULE
// ─────────────────────────────────────────────────
function renderSchedule() {
  const comms = DB.getAll('commission:');
  document.getElementById('page-content').innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:24px;">Расписание аттестации</h1>
    <div class="panel">
      ${comms.length===0 ? emptyState('📅','Нет запланированных комиссий') :
        `<div class="table-wrap"><table>
          <thead><tr><th>Комиссия</th><th>Дисциплина</th><th>Дата</th><th>Статус</th></tr></thead>
          <tbody>${comms.map(c=>`<tr>
            <td><b>${c.name}</b></td>
            <td><span class="disc-tag">${c.subject||'—'}</span></td>
            <td>${c.date?new Date(c.date).toLocaleDateString('ru'):'Уточняется'}</td>
            <td>${c.status==='active'?'<span class="badge badge-green">Активна</span>':'<span class="badge badge-gray">Завершена</span>'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
    </div>`;
}

// ─────────────────────────────────────────────────
// TEACHER — REVIEW (only own disciplines)
// ─────────────────────────────────────────────────
function renderReview() {
  const myDiscs = currentUser.disciplines || [];
  const allApps = DB.getAll('app:')
    .filter(a => a.teacherId===currentUser.id || myDiscs.includes(a.discipline));

  document.getElementById('page-content').innerHTML = `
    <div style="margin-bottom:20px;">
      <h1 style="font-size:22px;font-weight:700;">Заявки студентов</h1>
      <p style="color:var(--text2);font-size:13px;margin-top:4px;">
        Ваши дисциплины: ${myDiscs.map(d=>`<span class="disc-tag">${d}</span>`).join(' ')}
      </p>
      ${myDiscs.length===0?`<div style="background:#fff3cd;border-radius:8px;padding:12px;font-size:13px;margin-top:8px;">
        ⚠️ У вас не указаны дисциплины. Обратитесь к администратору.</div>`:''}
    </div>
    <div class="page-tabs">
      <button class="page-tab active" onclick="filterApps('all',this,'teacher')">Все (${allApps.length})</button>
      <button class="page-tab" onclick="filterApps('pending',this,'teacher')">Ожидают (${allApps.filter(a=>a.status==='pending').length})</button>
      <button class="page-tab" onclick="filterApps('passed',this,'teacher')">Зачтено (${allApps.filter(a=>a.status==='passed').length})</button>
      <button class="page-tab" onclick="filterApps('failed',this,'teacher')">Не зачтено (${allApps.filter(a=>a.status==='failed').length})</button>
    </div>
    <div class="panel" id="apps-table">${renderAppsTable(allApps, 'teacher')}</div>`;
}

function filterApps(status, btn, ctx) {
  document.querySelectorAll('.page-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  let apps = DB.getAll('app:');
  if (ctx==='teacher') {
    const myDiscs = currentUser.disciplines||[];
    apps = apps.filter(a=>a.teacherId===currentUser.id||myDiscs.includes(a.discipline));
  }
  if (status!=='all') apps = apps.filter(a=>a.status===status);
  document.getElementById('apps-table').innerHTML = renderAppsTable(apps, ctx);
}

function renderAppsTable(apps, ctx) {
  if (apps.length===0) return emptyState('📭','Нет заявок');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Студент</th><th>Дисциплина</th><th>Работа</th><th>Файлы</th><th>Статус</th><th>Дата</th><th>Действие</th></tr></thead>
    <tbody>${apps.map(a=>{
      const st = DB.get('user:'+a.studentId);
      return `<tr>
        <td><b>${st?st.name:'?'}</b><div style="font-size:11px;color:var(--text2)">${st?st.group||'':''}</div></td>
        <td><span class="disc-tag">${a.discipline||'—'}</span></td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.title||a.type}</td>
        <td>${(a.files||[]).length>0?`<span class="badge badge-blue">📄 ${a.files.length}</span>`:'<span class="badge badge-gray">—</span>'}</td>
        <td>${statusBadge(a.status)}</td>
        <td style="color:var(--text2)">${new Date(a.createdAt).toLocaleDateString('ru')}</td>
        <td><button class="btn btn-sm btn-blue" onclick="openReviewModal('${a.id}')">Рассмотреть</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function openReviewModal(appId) {
  const app  = DB.get('app:'+appId);
  if (!app) return toast('Заявка не найдена','error');
  const st   = DB.get('user:'+app.studentId);
  const comm = app.commissionId ? DB.get('commission:'+app.commissionId) : null;
  const tch  = app.teacherId    ? DB.get('user:'+app.teacherId) : null;

  // Security: teacher can only review apps of their disciplines
  if (currentUser.role==='teacher') {
    const myDiscs = currentUser.disciplines||[];
    if (app.teacherId!==currentUser.id && !myDiscs.includes(app.discipline)) {
      return toast('❌ Эта заявка не относится к вашим дисциплинам','error');
    }
  }

  openModal(`
    <h2>📋 Заявка на аттестацию</h2>
    <div style="background:#f4f6fb;border-radius:10px;padding:14px;margin-bottom:18px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
        <div><span style="color:var(--text2)">Студент:</span><br><b>${st?st.name:'—'}</b></div>
        <div><span style="color:var(--text2)">Группа:</span><br>${st?st.group||'—':'—'}</div>
        <div><span style="color:var(--text2)">Дисциплина:</span><br><span class="disc-tag">${app.discipline||'—'}</span></div>
        <div><span style="color:var(--text2)">Тип работы:</span><br>${app.type}</div>
        <div style="grid-column:1/-1"><span style="color:var(--text2)">Название:</span><br><b>${app.title||'—'}</b></div>
        ${comm?`<div style="grid-column:1/-1"><span style="color:var(--text2)">Комиссия:</span><br>${comm.name}</div>`:''}
        <div><span style="color:var(--text2)">Дата подачи:</span><br>${new Date(app.createdAt).toLocaleDateString('ru')}</div>
        <div><span style="color:var(--text2)">Текущий статус:</span><br>${statusBadge(app.status)}</div>
      </div>
    </div>
    ${app.files&&app.files.length>0?`
    <div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px;text-transform:uppercase;">Загруженные документы</div>
      <div class="file-list">${app.files.map(f=>`<div class="file-item"><span>📄</span><span>${f.name}</span><span style="color:var(--text2)">${f.size||''}</span></div>`).join('')}</div>
    </div>`:`<div style="background:#fff8e6;border-radius:8px;padding:12px;font-size:13px;margin-bottom:16px;">⚠️ Студент не загрузил документы</div>`}
    <div class="form-group">
      <label>Комментарий / отзыв преподавателя</label>
      <input type="text" id="rv-comment" placeholder="Комментарий отправится студенту..." value="${app.teacherComment||''}"/>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModalDirect()">Закрыть</button>
      <button class="btn btn-outline" onclick="setAppStatus('${appId}','revision')">🔄 На доработку</button>
      <button class="btn btn-red" onclick="setAppStatus('${appId}','failed')">❌ Не зачтено</button>
      <button class="btn btn-green" onclick="setAppStatus('${appId}','passed')">✅ Зачтено</button>
    </div>`);
}

function setAppStatus(appId, status) {
  const app = DB.get('app:'+appId);
  const comment = document.getElementById('rv-comment')?.value||'';
  app.status = status; app.teacherComment = comment;
  app.reviewedAt = new Date().toISOString(); app.reviewedBy = currentUser.id;
  DB.set('app:'+appId, app);
  const labels = {passed:'зачтена ✅',failed:'не зачтена ❌',revision:'отправлена на доработку 🔄'};
  addNotification(app.studentId, `Заявка «${app.title||app.type}» ${labels[status]||'обновлена'}${comment?': '+comment:''}`);
  closeModalDirect();
  toast('Статус обновлён','success');
  if (currentPage==='review') renderReview();
  else if (currentPage==='all-apps') renderAllApps();
  else renderDashboard();
}

// ─────────────────────────────────────────────────
// TEACHER — COMMISSIONS
// ─────────────────────────────────────────────────
function renderCommissions() {
  const all  = DB.getAll('commission:');
  const mine = currentUser.role==='teacher' ? all.filter(c=>c.teacherId===currentUser.id) : all;
  document.getElementById('page-content').innerHTML = `
    <div class="flex justify-between items-center" style="margin-bottom:24px;">
      <h1 style="font-size:22px;font-weight:700;">Аттестационные комиссии</h1>
      ${currentUser.role==='admin'?`<button class="btn btn-blue" onclick="showCreateCommissionModal()">+ Создать</button>`:''}
    </div>
    <div class="panel">
      ${mine.length===0 ? emptyState('🏛️','Нет комиссий') :
        `<div class="table-wrap"><table>
          <thead><tr><th>Название</th><th>Дисциплина</th><th>Дата</th><th>Статус</th><th>Заявок</th></tr></thead>
          <tbody>${mine.map(c=>{
            const cnt = DB.getAll('app:').filter(a=>a.commissionId===c.id).length;
            return `<tr>
              <td><b>${c.name}</b></td>
              <td><span class="disc-tag">${c.subject||'—'}</span></td>
              <td>${c.date?new Date(c.date).toLocaleDateString('ru'):'—'}</td>
              <td>${c.status==='active'?'<span class="badge badge-green">Активна</span>':'<span class="badge badge-gray">Завершена</span>'}</td>
              <td><span class="badge badge-blue">${cnt}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
    </div>`;
}

function showCreateCommissionModal() {
  const teachers = DB.getAll('user:').filter(u=>u.role==='teacher');
  openModal(`
    <h2>🏛️ Создать комиссию</h2>
    <div class="form-group"><label>Название</label><input type="text" id="c-name" placeholder="Комиссия по защите..."/></div>
    <div class="form-group"><label>Дисциплина / предмет</label><input type="text" id="c-subject" placeholder="Информационные системы"/></div>
    <div class="form-group">
      <label>Председатель</label>
      <select id="c-teacher">
        <option value="">Выберите преподавателя</option>
        ${teachers.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Дата заседания</label><input type="date" id="c-date"/></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModalDirect()">Отмена</button>
      <button class="btn btn-blue" onclick="createCommission()">Создать</button>
    </div>`);
}

function createCommission() {
  const name = document.getElementById('c-name').value.trim();
  const subj = document.getElementById('c-subject').value.trim();
  const tId  = document.getElementById('c-teacher').value;
  const date = document.getElementById('c-date').value;
  if (!name) return toast('Укажите название','error');
  const id = 'c'+Date.now();
  DB.set('commission:'+id, {id,name,subject:subj,teacherId:tId,date,status:'active',createdAt:new Date().toISOString()});
  if (tId) addNotification(tId,`Вы назначены председателем комиссии: ${name}`);
  closeModalDirect(); toast('Комиссия создана','success'); renderCommissions();
}

// ─────────────────────────────────────────────────
// TEACHER — STUDENTS
// ─────────────────────────────────────────────────
function renderStudents() {
  const students = DB.getAll('user:').filter(u=>u.role==='student');
  const allApps  = DB.getAll('app:');
  document.getElementById('page-content').innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:24px;">Студенты</h1>
    <div class="panel">
      ${students.length===0 ? emptyState('👥','Нет студентов') :
        `<div class="table-wrap"><table>
          <thead><tr><th>ФИО</th><th>Группа</th><th>Email</th><th>Заявок</th><th>Статус</th></tr></thead>
          <tbody>${students.map(s=>{
            const apps   = allApps.filter(a=>a.studentId===s.id);
            const passed = apps.filter(a=>a.status==='passed').length;
            const pend   = apps.filter(a=>a.status==='pending').length;
            return `<tr>
              <td><b>${s.name}</b></td>
              <td>${s.group||'—'}</td>
              <td style="color:var(--text2)">${s.email||s.phone||'—'}</td>
              <td>${apps.length} <span style="color:var(--text2);font-size:11px">(✅${passed})</span></td>
              <td>${pend>0?'<span class="badge badge-yellow">Ожидает</span>':passed>0?'<span class="badge badge-green">Аттестован</span>':'<span class="badge badge-gray">—</span>'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
    </div>`;
}

// ─────────────────────────────────────────────────
// ADMIN — ALL APPS
// ─────────────────────────────────────────────────
function renderAllApps() {
  const allApps = DB.getAll('app:');
  document.getElementById('page-content').innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:24px;">Все заявки</h1>
    <div class="panel">${renderAppsTable(allApps,'admin')}</div>`;
}

// ─────────────────────────────────────────────────
// ADMIN — USERS
// ─────────────────────────────────────────────────
function renderUsers() {
  const users = DB.getAll('user:');
  document.getElementById('page-content').innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:24px;">Пользователи системы</h1>
    <div class="panel">
      <div class="table-wrap"><table>
        <thead><tr><th>ФИО</th><th>Роль</th><th>Email</th><th>Дисциплины</th><th>Группа</th><th>Дата рег.</th></tr></thead>
        <tbody>${users.map(u=>`<tr>
          <td><b>${u.name}</b></td>
          <td>${{student:'<span class="badge badge-blue">Студент</span>',teacher:'<span class="badge badge-green">Преподаватель</span>',admin:'<span class="badge badge-yellow">Администратор</span>'}[u.role]||u.role}</td>
          <td style="color:var(--text2)">${u.email||'—'}</td>
          <td>${(u.disciplines||[]).map(d=>`<span class="disc-tag">${d}</span>`).join('')||'—'}</td>
          <td>${u.group||'—'}</td>
          <td style="color:var(--text2)">${new Date(u.createdAt).toLocaleDateString('ru')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

// ─────────────────────────────────────────────────
// ADMIN — REPORTS
// ─────────────────────────────────────────────────
function renderReports() {
  const allApps = DB.getAll('app:');
  const students = DB.getAll('user:').filter(u=>u.role==='student');
  const comms    = DB.getAll('commission:');
  document.getElementById('page-content').innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:24px;">Отчёты по аттестации</h1>
    <div class="two-col" style="margin-bottom:24px;">
      <div class="panel">
        <h2>Сводный отчёт</h2>
        <div style="display:flex;flex-direction:column;gap:12px;font-size:14px;">
          <div class="flex justify-between"><span>Всего заявок:</span><b>${allApps.length}</b></div>
          <div class="flex justify-between"><span>Аттестовано:</span><b style="color:#4CAF82">${allApps.filter(a=>a.status==='passed').length}</b></div>
          <div class="flex justify-between"><span>Не аттестовано:</span><b style="color:#e05252">${allApps.filter(a=>a.status==='failed').length}</b></div>
          <div class="flex justify-between"><span>На рассмотрении:</span><b style="color:#e8a020">${allApps.filter(a=>a.status==='pending').length}</b></div>
          <div class="flex justify-between"><span>На доработке:</span><b style="color:#2354a0">${allApps.filter(a=>a.status==='revision').length}</b></div>
          <div style="border-top:1px solid var(--border);padding-top:12px;" class="flex justify-between"><span>Студентов:</span><b>${students.length}</b></div>
          <div class="flex justify-between"><span>Комиссий:</span><b>${comms.length}</b></div>
        </div>
        <button class="btn btn-blue w-full" style="margin-top:20px;" onclick="exportReport()">📥 Экспорт CSV</button>
      </div>
      <div class="panel"><h2>Решения комиссий</h2>${renderDecisionChart(allApps)}</div>
    </div>
    <div class="panel"><h2>Статус заявок</h2>${renderStatusChart(allApps)}</div>`;
}

function exportReport() {
  const apps = DB.getAll('app:');
  let csv = 'ФИО;Группа;Дисциплина;Тип;Название;Статус;Дата подачи;Дата решения\n';
  apps.forEach(a=>{
    const s = DB.get('user:'+a.studentId);
    const sl = {pending:'На рассмотрении',passed:'Аттестован',failed:'Не аттестован',revision:'На доработке'}[a.status]||a.status;
    csv += `${s?s.name:'?'};${s?s.group||'—':'—'};${a.discipline||'—'};${a.type};${a.title||''};${sl};${new Date(a.createdAt).toLocaleDateString('ru')};${a.reviewedAt?new Date(a.reviewedAt).toLocaleDateString('ru'):'—'}\n`;
  });
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href=url; link.download='margu_report.csv'; link.click();
  toast('Отчёт выгружен','success');
}

// ─────────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────────
function renderProfile() {
  const u = currentUser;
  document.getElementById('page-content').innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:24px;">Мой профиль</h1>
    <div class="two-col">
      <div class="panel">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="width:80px;height:80px;border-radius:50%;background:var(--primary);color:white;font-size:30px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
            ${u.name.split(' ').slice(0,2).map(w=>w[0]).join('')}
          </div>
          <div style="font-weight:700;font-size:18px;">${u.name}</div>
          <div style="font-size:13px;color:var(--text2);">${{student:'Студент',teacher:'Преподаватель',admin:'Администратор'}[u.role]}</div>
          <span class="badge badge-green" style="margin-top:6px;">✅ Email подтверждён</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">
          ${u.email?`<div class="flex justify-between"><span style="color:var(--text2)">Email:</span><b>${u.email}</b></div>`:''}
          ${u.phone?`<div class="flex justify-between"><span style="color:var(--text2)">Телефон:</span><b>${u.phone}</b></div>`:''}
          ${u.group?`<div class="flex justify-between"><span style="color:var(--text2)">Группа:</span><b>${u.group}</b></div>`:''}
          ${u.dept?`<div class="flex justify-between"><span style="color:var(--text2)">Кафедра:</span><b>${u.dept}</b></div>`:''}
          ${(u.disciplines||[]).length>0?`<div><span style="color:var(--text2)">Дисциплины:</span><br>${u.disciplines.map(d=>`<span class="disc-tag">${d}</span>`).join(' ')}</div>`:''}
          <div class="flex justify-between"><span style="color:var(--text2)">Регистрация:</span><b>${new Date(u.createdAt).toLocaleDateString('ru')}</b></div>
        </div>
      </div>
      <div class="panel">
        <h2>Изменить пароль</h2>
        <div class="form-group"><label>Текущий пароль</label><input type="password" id="p-old" placeholder="Текущий пароль"/></div>
        <div class="form-group"><label>Новый пароль</label><input type="password" id="p-new" placeholder="Мин. 6 символов"/></div>
        <button class="btn btn-blue w-full" onclick="changePassword()">Сохранить</button>
      </div>
    </div>`;
}

function changePassword() {
  const oldP = document.getElementById('p-old').value;
  const newP = document.getElementById('p-new').value;
  if (oldP!==currentUser.pass) return toast('Неверный текущий пароль','error');
  if (newP.length<6) return toast('Минимум 6 символов','error');
  currentUser.pass = newP;
  DB.set('user:'+currentUser.id, currentUser);
  toast('Пароль изменён','success');
}

// ─────────────────────────────────────────────────
// CHARTS
// ─────────────────────────────────────────────────
function renderStatusChart(apps) {
  const total = apps.length;
  if (!total) return emptyState('📊','Нет данных');
  return [
    ['⏳ На рассмотрении','#e8a020',apps.filter(a=>a.status==='pending').length],
    ['✅ Аттестованы','#4CAF82',apps.filter(a=>a.status==='passed').length],
    ['❌ Не аттестованы','#e05252',apps.filter(a=>a.status==='failed').length],
    ['🔄 На доработке','#2354a0',apps.filter(a=>a.status==='revision').length],
  ].map(([label,color,count])=>`
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
        <span>${label}</span><span style="font-weight:700">${count}</span>
      </div>
      <div style="background:#f0f3fa;border-radius:4px;height:8px;">
        <div style="background:${color};height:8px;border-radius:4px;width:${Math.round(count/total*100)}%;transition:width .5s;"></div>
      </div>
    </div>`).join('');
}

function renderDecisionChart(apps) {
  const passed = apps.filter(a=>a.status==='passed').length;
  const failed = apps.filter(a=>a.status==='failed').length;
  const total  = passed+failed;
  if (!total) return emptyState('🏛️','Нет данных решений');
  const pct = Math.round(passed/total*100);
  return `<div style="display:flex;align-items:center;gap:24px;">
    <div style="position:relative;width:100px;height:100px;flex-shrink:0;">
      <svg viewBox="0 0 36 36" style="width:100%;height:100%;">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f0f3fa" stroke-width="3"/>
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#4CAF82" stroke-width="3"
          stroke-dasharray="${pct} ${100-pct}" stroke-dashoffset="25" transform="rotate(-90 18 18)"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;">${pct}%</div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
      <div class="flex justify-between" style="font-size:13px;"><span>✅ Аттестовано</span><b style="color:#4CAF82">${passed}</b></div>
      <div class="flex justify-between" style="font-size:13px;"><span>❌ Не аттестовано</span><b style="color:#e05252">${failed}</b></div>
      <div class="flex justify-between" style="font-size:13px;border-top:1px solid var(--border);padding-top:8px;"><span>Всего решений</span><b>${total}</b></div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────
// FILE HANDLING
// ─────────────────────────────────────────────────
function onDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('dragover'); }
function onFileDrop(e, listId) { e.preventDefault(); e.currentTarget.classList.remove('dragover'); addFilesToList(e.dataTransfer.files, listId); }
function onFileSelect(input, listId) { addFilesToList(input.files, listId); input.value=''; }
function addFilesToList(files, listId) {
  const list = document.getElementById(listId);
  Array.from(files).forEach(f => {
    const size = f.size>1024*1024 ? (f.size/1024/1024).toFixed(1)+' МБ' : Math.round(f.size/1024)+' КБ';
    const div  = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `<span>📄</span><span>${f.name}</span><span style="color:var(--text2)">${size}</span><button onclick="this.parentElement.remove()">×</button>`;
    list.appendChild(div);
  });
}

// ─────────────────────────────────────────────────
// REVISION MODAL
// ─────────────────────────────────────────────────
function showRevisionModal(appId) {
  openModal(`
    <h2>🔄 Загрузить исправления</h2>
    <div class="form-group">
      <label>Исправленные документы</label>
      <div class="file-drop" onclick="document.getElementById('rv-file').click()">
        <div class="file-icon">📄</div><p>Нажмите для выбора файлов</p>
      </div>
      <input type="file" id="rv-file" multiple style="display:none" onchange="onFileSelect(this,'rv-files-list')">
      <div class="file-list" id="rv-files-list"></div>
    </div>
    <div class="form-group"><label>Комментарий</label><input type="text" id="rv-note" placeholder="Опишите изменения..."/></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModalDirect()">Отмена</button>
      <button class="btn btn-blue" onclick="submitRevision('${appId}')">Отправить</button>
    </div>`);
}

function submitRevision(appId) {
  const app     = DB.get('app:'+appId);
  const items   = document.querySelectorAll('#rv-files-list .file-item');
  const newFiles = Array.from(items).map(el=>({ name:el.querySelector('span:nth-child(2)').textContent, size:el.querySelector('span:nth-child(3)').textContent }));
  app.files  = [...(app.files||[]), ...newFiles];
  app.status = 'pending';
  app.revisedAt = new Date().toISOString();
  DB.set('app:'+appId, app);
  if (app.teacherId) addNotification(app.teacherId, `Студент загрузил исправления: «${app.title||app.type}»`);
  closeModalDirect(); toast('Исправления отправлены','success'); renderApplications();
}

// ─────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────
function addNotification(userId, text) {
  let notifs = DB.get('notifs:'+userId)||[];
  notifs.unshift({id:'n'+Date.now(), text, unread:true, time:new Date().toISOString()});
  if (notifs.length>30) notifs=notifs.slice(0,30);
  DB.set('notifs:'+userId, notifs);
  if (userId===currentUser?.id) updateNotifBadge();
}

function updateNotifBadge() {
  const notifs = DB.get('notifs:'+currentUser.id)||[];
  const unread = notifs.filter(n=>n.unread).length;
  const badge  = document.getElementById('notif-badge');
  if (badge) { badge.textContent=unread; badge.classList.toggle('hidden',unread===0); }
}

function toggleNotif() {
  const panel = document.getElementById('notif-panel');
  panel.classList.toggle('show');
  if (panel.classList.contains('show')) renderNotifPanel();
}

function renderNotifPanel() {
  const notifs = DB.get('notifs:'+currentUser.id)||[];
  notifs.forEach(n=>n.unread=false);
  DB.set('notifs:'+currentUser.id, notifs);
  updateNotifBadge();
  document.getElementById('notif-list').innerHTML = notifs.length===0
    ? `<div style="padding:20px;text-align:center;color:var(--text2);font-size:13px;">Нет уведомлений</div>`
    : notifs.map(n=>`<div class="notif-item"><strong>${n.text}</strong><time>${new Date(n.time).toLocaleString('ru')}</time></div>`).join('');
}

function clearNotifications() {
  DB.set('notifs:'+currentUser.id,[]);
  updateNotifBadge(); renderNotifPanel();
}

document.addEventListener('click', e=>{
  const panel=document.getElementById('notif-panel');
  const btn=document.getElementById('notif-btn');
  if(panel&&!panel.contains(e.target)&&btn&&!btn.contains(e.target)) panel.classList.remove('show');
});

// ─────────────────────────────────────────────────
// MODAL / TOAST / HELPERS
// ─────────────────────────────────────────────────
function openModal(html) { document.getElementById('modal-body').innerHTML=html; document.getElementById('modal-overlay').classList.add('show'); }
function closeModal(e)   { if(e.target.id==='modal-overlay') closeModalDirect(); }
function closeModalDirect() { document.getElementById('modal-overlay').classList.remove('show'); }

function toast(msg, type='info') {
  const t=document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(()=>t.remove(),3500);
}

function statusBadge(s) {
  return {
    pending: '<span class="badge badge-yellow">⏳ На рассмотрении</span>',
    passed:  '<span class="badge badge-green">✅ Зачтено</span>',
    failed:  '<span class="badge badge-red">❌ Не зачтено</span>',
    revision:'<span class="badge badge-blue">🔄 На доработке</span>',
  }[s]||`<span class="badge badge-gray">${s}</span>`;
}

function emptyState(icon, msg, withBtn) {
  return `<div class="empty-state">
    <div class="icon">${icon}</div><p>${msg}</p>
    ${withBtn?`<button class="btn btn-blue" style="margin-top:14px;" onclick="showNewAppModal()">Подать заявку</button>`:''}
  </div>`;
}

// ─────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────
seedData();
refreshAdminRoleBtn();

const saved = DB.get('session');
if (saved) {
  const u = DB.get('user:'+saved);
  if (u) loginSuccess(u);
}
