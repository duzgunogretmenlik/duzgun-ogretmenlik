// ============================================================
// DüzgünÖğretmenlik - Ana JavaScript Modülü
// ============================================================

// ---- SUPABASE YAPILANDIRMASI VE URL (?etkinlik=ID) UYUMLULUK KÖPRÜSÜ ----
const SUPABASE_CONFIG = {
  RAW_URL: 'https://andkfcqviwyyfbsxaqok.supabase.co/rest/v1/',
  URL: 'https://andkfcqviwyyfbsxaqok.supabase.co',
  KEY: 'sb_publishable_JJfo32_NV_vChwJU3lGl0w_BE_x-7iD',
  TABLE: 'etkinlikler'
};

(function patchEtkinlikUrlParam() {
  if (typeof URLSearchParams === 'undefined') return;
  const origGet = URLSearchParams.prototype.get;
  URLSearchParams.prototype.get = function(name) {
    const val = origGet.call(this, name);
    if ((val === null || val === '') && name === 'id') {
      return origGet.call(this, 'etkinlik');
    }
    return val;
  };
})();

// ---- YEREL VERİTABANI (Bellek Korumalı & Hata Toleranslı) ----
const DB = {
  _mem: {},

  get(key) {
    try {
      // 1. Standart düzgün anahtar
      let raw = localStorage.getItem('duzgunogretmenlik_' + key);
      // 2. Önceki yazım hatası olan anahtar
      if (!raw) raw = localStorage.getItem('dugrunogretmenlik_' + key);
      // 3. İlk versiyon eduplay anahtarı
      if (!raw) raw = localStorage.getItem('eduplay_' + key);

      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('Yerel veri okuma uyarısı, bellekten okunuyor:', e);
    }
    return this._mem[key] !== undefined ? this._mem[key] : null;
  },

  set(key, value) {
    this._mem[key] = value;
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem('duzgunogretmenlik_' + key, serialized);
      localStorage.setItem('dugrunogretmenlik_' + key, serialized);
    } catch (e) {
      console.warn('Yerel veri yazma uyarısı (bellekte korundu):', e);
    }
  }
};

// ---- ÖĞRETMEN KİMLİK DOĞRULAMA VE YETKİ YÖNETİMİ ----
const AuthStore = {
  ACCOUNT_KEY: 'teacher_account',
  USERS_KEY: 'teacher_users',
  SESSION_KEY: 'duzgunogretmenlik_auth',
  ADMIN_SUPABASE_UID: 'ebebc725-e02a-4fc2-aacb-b3de413dbfa0',

  _isAdminUid(uid) {
    return String(uid || '').trim().toLowerCase() === this.ADMIN_SUPABASE_UID;
  },

  hash(str) {
    const s = String(str || '');
    let h1 = 0xdeadbeef ^ s.length;
    let h2 = 0x41c6ce57 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  },

  _isInPagesDir() {
    return /\/pages\/[^/]*$/i.test(window.location.pathname.replace(/\\/g, '/'));
  },

  _pageUrl(inRoot, inPages) {
    return this._isInPagesDir() ? inPages : inRoot;
  },

  getUsers() {
    let users = DB.get(this.USERS_KEY);
    if (!Array.isArray(users)) {
      users = [];
    }
    // Sabit varsayılan yönetici/öğretmen profillerini yerel depolamadan temizle
    const filtered = users.filter(u =>
      u &&
      typeof u === 'object' &&
      u.id !== 'u_primary' &&
      u.isDefaultPassword !== true
    );
    if (filtered.length !== users.length) {
      DB.set(this.USERS_KEY, filtered);
    }
    try {
      const legacy = DB.get(this.ACCOUNT_KEY);
      if (legacy && typeof legacy === 'object' && (legacy.id === 'u_primary' || legacy.isDefaultPassword === true)) {
        localStorage.removeItem('duzgunogretmenlik_' + this.ACCOUNT_KEY);
        localStorage.removeItem('dugrunogretmenlik_' + this.ACCOUNT_KEY);
      }
    } catch (e) {}
    return filtered.map(u => ({
      ...u,
      isPrimary: this._isAdminUid(u.supabaseUid || u.id)
    }));
  },

  saveUsers(users) {
    const clean = (Array.isArray(users) ? users : [])
      .filter(u => u && typeof u === 'object' && u.id !== 'u_primary' && u.isDefaultPassword !== true)
      .map(u => ({
        ...u,
        isPrimary: this._isAdminUid(u.supabaseUid || u.id)
      }));
    DB.set(this.USERS_KEY, clean);
    return clean;
  },

  isAdmin(user) {
    const supaUser = (typeof SupabaseService !== 'undefined' && SupabaseService.getSupabaseUser)
      ? SupabaseService.getSupabaseUser()
      : null;
    if (user) {
      const uid = user.supabaseUid
        || (supaUser && supaUser.email && user.email && String(supaUser.email).toLowerCase() === String(user.email).toLowerCase() ? supaUser.id : '')
        || user.id;
      return this._isAdminUid(uid);
    }
    const cur = this.getCurrentUser();
    const activeUid = (cur && cur.supabaseUid) || (supaUser && supaUser.id) || (cur && cur.id) || '';
    return this._isAdminUid(activeUid);
  },

  findUserByUsername(username) {
    const clean = String(username || '').trim().toLowerCase();
    if (!clean) return null;
    return this.getUsers().find(u =>
      String(u.username || '').trim().toLowerCase() === clean ||
      (u.email && String(u.email || '').trim().toLowerCase() === clean)
    ) || null;
  },

  findUserByEmail(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) return null;
    return this.getUsers().find(u =>
      (u.email && String(u.email || '').trim().toLowerCase() === clean) ||
      String(u.username || '').trim().toLowerCase() === clean
    ) || null;
  },

  findUserById(id) {
    if (!id) return null;
    return this.getUsers().find(u => u.id === id || (u.supabaseUid && u.supabaseUid === id)) || null;
  },

  _getActiveToken() {
    try {
      const sessToken = sessionStorage.getItem(this.SESSION_KEY);
      const localToken = localStorage.getItem(this.SESSION_KEY);
      return sessToken || localToken || this._memToken || null;
    } catch (e) {
      return this._memToken || null;
    }
  },

  getCurrentUser() {
    const token = this._getActiveToken();
    const users = this.getUsers();
    if (token) {
      const matched = users.find(u => this._expectedToken(u) === token);
      if (matched) return matched;
    }
    const supaUser = (typeof SupabaseService !== 'undefined' && SupabaseService.getSupabaseUser)
      ? SupabaseService.getSupabaseUser()
      : null;
    if (supaUser && supaUser.id) {
      const cleanEmail = String(supaUser.email || '').trim().toLowerCase();
      const existing = users.find(u =>
        (u.supabaseUid && u.supabaseUid === supaUser.id) ||
        (cleanEmail && u.email && String(u.email).trim().toLowerCase() === cleanEmail)
      );
      if (existing) {
        if (existing.supabaseUid !== supaUser.id) {
          existing.supabaseUid = supaUser.id;
          existing.isPrimary = this._isAdminUid(supaUser.id);
          this.saveUsers(users);
        }
        return existing;
      }
      const sess = SupabaseService.getAuthSession();
      const rem = !!localStorage.getItem(SupabaseService.SESSION_STORAGE_KEY);
      return this.syncSupabaseUser(supaUser, sess, rem);
    }
    return null;
  },

  getAccount() {
    return this.getCurrentUser() || this.getUsers()[0] || null;
  },

  saveAccount(acc) {
    if (!acc) return null;
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === acc.id);
    if (idx >= 0) {
      users[idx] = acc;
    } else {
      users.push(acc);
    }
    this.saveUsers(users);
    return acc;
  },

  _expectedToken(acc) {
    const a = acc || this.getCurrentUser() || this.getAccount();
    if (!a) return '';
    return `${String(a.username || '').toLowerCase()}:${a.passwordHash}`;
  },

  _saveSessionToken(token, remember = true) {
    try {
      sessionStorage.setItem(this.SESSION_KEY, token);
      if (remember) {
        localStorage.setItem(this.SESSION_KEY, token);
      } else {
        localStorage.removeItem(this.SESSION_KEY);
      }
    } catch (e) {
      this._memToken = token;
    }
  },

  isLoggedIn() {
    return !!this.getCurrentUser();
  },

  login(username, password, remember = true) {
    const user = this.findUserByUsername(username);
    const passHash = this.hash(String(password || ''));
    if (!user || passHash !== user.passwordHash) {
      return { ok: false, error: 'Kullanıcı adı veya şifre hatalı!' };
    }
    const token = this._expectedToken(user);
    this._saveSessionToken(token, remember);
    return { ok: true, account: user };
  },

  register({ displayName, username, password, securityQuestion, securityAnswer }, remember = true) {
    const cleanDisplay = String(displayName || '').trim();
    if (cleanDisplay.length < 2) {
      return { ok: false, error: 'Ad Soyad / Görünen ad en az 2 karakter olmalıdır.' };
    }
    const lowerDisplay = cleanDisplay.toLocaleLowerCase('tr-TR');
    if (lowerDisplay === 'türkçe öğretmeni' || lowerDisplay === 'turkce ogretmeni') {
      return { ok: false, error: '"Türkçe Öğretmeni" yönetici görünen adıdır ve yeni kayıtlarda kullanılamaz.' };
    }
    const cleanUser = String(username || '').trim();
    if (cleanUser.length < 3) {
      return { ok: false, error: 'Kullanıcı adı en az 3 karakter olmalıdır.' };
    }
    if (/\s/.test(cleanUser)) {
      return { ok: false, error: 'Kullanıcı adı boşluk içeremez.' };
    }
    if (this.findUserByUsername(cleanUser)) {
      return { ok: false, error: 'Bu kullanıcı adı zaten alınmış. Lütfen farklı bir kullanıcı adı seçin.' };
    }
    const rawPass = String(password || '');
    if (rawPass.length < 4) {
      return { ok: false, error: 'Şifre en az 4 karakter olmalıdır.' };
    }
    const cleanQ = String(securityQuestion || '').trim() || 'En sevdiğiniz Türk şairi veya ilk görev okulunuz?';
    const cleanAns = String(securityAnswer || '').trim().toLowerCase();
    if (cleanAns.length < 2) {
      return { ok: false, error: 'Güvenlik yanıtı en az 2 karakter olmalıdır.' };
    }

    const users = this.getUsers();
    const newUser = {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: cleanUser,
      passwordHash: this.hash(rawPass),
      displayName: cleanDisplay,
      securityQuestion: cleanQ,
      securityAnswerHash: this.hash(cleanAns),
      isDefaultPassword: false,
      isPrimary: false,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    this.saveUsers(users);
    this._saveSessionToken(this._expectedToken(newUser), remember);
    return { ok: true, account: newUser };
  },

  syncSupabaseUser(supaUser, session, remember = true, rawPassword = '') {
    if (!supaUser || !supaUser.email) return null;
    const cleanEmail = String(supaUser.email).trim().toLowerCase();
    const isAdminUid = this._isAdminUid(supaUser.id);
    const users = this.getUsers();
    let existing = users.find(u =>
      (u.supabaseUid && u.supabaseUid === supaUser.id) ||
      (u.email && String(u.email).trim().toLowerCase() === cleanEmail) ||
      String(u.username || '').trim().toLowerCase() === cleanEmail
    );

    const metaName = String(supaUser.user_metadata?.display_name || supaUser.user_metadata?.full_name || '').trim();
    const lowerMeta = metaName.toLocaleLowerCase('tr-TR');
    const safeDisplay = (isAdminUid || (metaName && lowerMeta !== 'türkçe öğretmeni' && lowerMeta !== 'turkce ogretmeni'))
      ? (metaName || cleanEmail.split('@')[0])
      : cleanEmail.split('@')[0];

    if (existing) {
      existing.email = cleanEmail;
      existing.supabaseUid = supaUser.id;
      existing.isPrimary = isAdminUid;
      if (metaName) existing.displayName = safeDisplay;
      if (rawPassword) existing.passwordHash = this.hash(rawPassword);
    } else {
      existing = {
        id: isAdminUid ? supaUser.id : ('sb_' + String(supaUser.id || generateId())),
        supabaseUid: supaUser.id,
        username: String(supaUser.user_metadata?.username || cleanEmail).trim(),
        email: cleanEmail,
        passwordHash: this.hash(rawPassword || supaUser.id),
        displayName: safeDisplay,
        securityQuestion: 'E-posta ile kayıt olunan hesap',
        securityAnswerHash: this.hash(cleanEmail),
        isDefaultPassword: false,
        isPrimary: isAdminUid,
        createdAt: supaUser.created_at || new Date().toISOString()
      };
      users.push(existing);
    }

    this.saveUsers(users);
    this._saveSessionToken(this._expectedToken(existing), remember);
    if (typeof SupabaseService !== 'undefined') {
      SupabaseService.saveAuthSession(session, supaUser, remember);
    }
    return existing;
  },

  async loginWithEmail(emailOrUsername, password, remember = true) {
    const cleanInput = String(emailOrUsername || '').trim();
    const rawPass = String(password || '');
    if (!cleanInput || !rawPass) {
      return { ok: false, error: 'Lütfen e-posta adresinizi ve şifrenizi girin.' };
    }

    // "@" içermeyen yerel kullanıcı adı girişi
    if (!cleanInput.includes('@')) {
      return this.login(cleanInput, rawPass, remember);
    }

    const cleanEmail = cleanInput.toLowerCase();

    let supaRes = null;
    if (typeof SupabaseService !== 'undefined') {
      supaRes = await SupabaseService.signInWithEmail(cleanEmail, rawPass);
      if (supaRes && supaRes.ok && supaRes.user) {
        const synced = this.syncSupabaseUser(supaRes.user, supaRes.session, remember, rawPass);
        return { ok: true, account: synced, provider: 'supabase' };
      }
      if (supaRes && supaRes.emailNotConfirmed) {
        const localUser = this.findUserByEmail(cleanEmail);
        if (localUser && this.hash(rawPass) === localUser.passwordHash) {
          this._saveSessionToken(this._expectedToken(localUser), remember);
          return {
            ok: true,
            account: localUser,
            warning: 'E-posta onayınız henüz tamamlanmadığı için yerel öğretmen oturumu açıldı.'
          };
        }
        return {
          ok: false,
          error: 'E-posta adresiniz henüz onaylanmamış. Lütfen e-posta kutunuzdaki doğrulama bağlantısına tıklayın.'
        };
      }
      if (supaRes && supaRes.invalidCredentials) {
        const localOnlyUser = this.findUserByEmail(cleanEmail);
        // Sadece daha önce Supabase UID almamış yerel hesapsa şifreyi yerelde kontrol et
        if (localOnlyUser && !localOnlyUser.supabaseUid && this.hash(rawPass) === localOnlyUser.passwordHash) {
          this._saveSessionToken(this._expectedToken(localOnlyUser), remember);
          return { ok: true, account: localOnlyUser, provider: 'local' };
        }
        return { ok: false, error: 'E-posta adresi veya şifre hatalı!' };
      }
    }

    // Ağ bağlantısı yoksa veya Supabase istemcisi hazır değilse yerel hesaba düş
    const fallbackRes = this.login(cleanEmail, rawPass, remember);
    if (fallbackRes.ok) return fallbackRes;
    return {
      ok: false,
      error: (supaRes && supaRes.error) ? supaRes.error : 'E-posta adresi veya şifre hatalı!'
    };
  },

  async registerWithEmail({ email, displayName, username, password, securityQuestion, securityAnswer }, remember = true) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return { ok: false, error: 'Lütfen geçerli bir e-posta adresi girin (örn: ad@okul.com).' };
    }

    const cleanDisplay = String(displayName || '').trim() || cleanEmail.split('@')[0];
    if (cleanDisplay.length < 2) {
      return { ok: false, error: 'Ad Soyad / Görünen ad en az 2 karakter olmalıdır.' };
    }
    const lowerDisplay = cleanDisplay.toLocaleLowerCase('tr-TR');
    if (lowerDisplay === 'türkçe öğretmeni' || lowerDisplay === 'turkce ogretmeni') {
      return { ok: false, error: '"Türkçe Öğretmeni" yönetici görünen adıdır ve yeni kayıtlarda kullanılamaz.' };
    }

    const rawPass = String(password || '');
    if (rawPass.length < 6) {
      return { ok: false, error: 'Şifre en az 6 karakter olmalıdır.' };
    }

    const cleanUser = String(username || '').trim() || cleanEmail;
    const cleanQ = String(securityQuestion || '').trim() || 'Kayıt e-posta adresiniz?';
    const cleanAns = String(securityAnswer || cleanEmail).trim().toLowerCase();

    let supaRes = null;
    if (typeof SupabaseService !== 'undefined') {
      supaRes = await SupabaseService.signUpWithEmail(cleanEmail, rawPass, {
        display_name: cleanDisplay,
        username: cleanUser
      });

      if (supaRes && supaRes.ok && supaRes.user) {
        const synced = this.syncSupabaseUser(supaRes.user, supaRes.session, remember, rawPass);
        const needsConfirm = !supaRes.session;
        return {
          ok: true,
          account: synced,
          provider: 'supabase',
          needsEmailConfirmation: needsConfirm
        };
      }

      if (supaRes && supaRes.alreadyExists) {
        return {
          ok: false,
          error: 'Bu e-posta adresi ile daha önce kayıt olunmuş. Lütfen Giriş Yap sekmesini kullanın.'
        };
      }

      if (supaRes && !supaRes.networkError && supaRes.error) {
        return { ok: false, error: supaRes.error };
      }
    }

    // Ağ hatası veya çevrimdışı durum yedeği: yerel hesap oluştur
    if (this.findUserByEmail(cleanEmail)) {
      return { ok: false, error: 'Bu e-posta adresi zaten kayıtlı!' };
    }
    const users = this.getUsers();
    const newUser = {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: cleanUser,
      email: cleanEmail,
      passwordHash: this.hash(rawPass),
      displayName: cleanDisplay,
      securityQuestion: cleanQ,
      securityAnswerHash: this.hash(cleanAns),
      isDefaultPassword: false,
      isPrimary: false,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    this.saveUsers(users);
    this._saveSessionToken(this._expectedToken(newUser), remember);
    return { ok: true, account: newUser, provider: 'local' };
  },

  logout() {
    try {
      sessionStorage.removeItem(this.SESSION_KEY);
      localStorage.removeItem(this.SESSION_KEY);
      this._memToken = null;
      if (typeof SupabaseService !== 'undefined') {
        SupabaseService.clearAuthStorage();
        const client = SupabaseService.getClient();
        if (client && client.auth && typeof client.auth.signOut === 'function') {
          client.auth.signOut().catch(() => {});
        }
      }
    } catch (e) {}
    window.location.href = this._pageUrl('index.html', '../index.html');
  },

  updateCredentials({ currentPassword, newUsername, newPassword, displayName, securityQuestion, securityAnswer }) {
    const acc = this.getCurrentUser();
    if (!acc) {
      return { ok: false, error: 'Önce öğretmen hesabınızla giriş yapmalısınız!' };
    }
    if (this.hash(String(currentPassword || '')) !== acc.passwordHash) {
      return { ok: false, error: 'Mevcut şifreniz hatalı!' };
    }
    const cleanUser = String(newUsername || acc.username).trim();
    if (cleanUser.length < 3) {
      return { ok: false, error: 'Kullanıcı adı en az 3 karakter olmalıdır.' };
    }
    if (/\s/.test(cleanUser)) {
      return { ok: false, error: 'Kullanıcı adı boşluk içeremez.' };
    }
    const conflict = this.getUsers().find(
      u => u.id !== acc.id && String(u.username || '').trim().toLowerCase() === cleanUser.toLowerCase()
    );
    if (conflict) {
      return { ok: false, error: 'Bu kullanıcı adı başka bir öğretmen tarafından kullanılıyor!' };
    }
    if (newPassword !== undefined && newPassword !== null && String(newPassword).length > 0) {
      if (String(newPassword).length < 4) {
        return { ok: false, error: 'Yeni şifre en az 4 karakter olmalıdır.' };
      }
      acc.passwordHash = this.hash(String(newPassword));
      acc.isDefaultPassword = false;
    }
    acc.username = cleanUser;
    if (displayName && String(displayName).trim()) {
      const nextDisplay = String(displayName).trim();
      const lowerNextDisplay = nextDisplay.toLocaleLowerCase('tr-TR');
      if (!this.isAdmin(acc) && (lowerNextDisplay === 'türkçe öğretmeni' || lowerNextDisplay === 'turkce ogretmeni')) {
        return { ok: false, error: '"Türkçe Öğretmeni" adı yalnızca birincil yönetici hesabına aittir.' };
      }
      acc.displayName = nextDisplay;
    }
    if (securityQuestion && String(securityQuestion).trim()) {
      acc.securityQuestion = String(securityQuestion).trim();
    }
    if (securityAnswer && String(securityAnswer).trim()) {
      acc.securityAnswerHash = this.hash(String(securityAnswer).trim().toLowerCase());
    }
    this.saveAccount(acc);
    const remember = !!localStorage.getItem(this.SESSION_KEY);
    this._saveSessionToken(this._expectedToken(acc), remember);
    return { ok: true, account: acc };
  },

  resetPasswordWithAnswer(usernameOrAnswer, maybeNewPassword, thirdArg) {
    let targetUsername = null;
    let answer = usernameOrAnswer;
    let newPassword = maybeNewPassword;
    if (thirdArg !== undefined) {
      targetUsername = usernameOrAnswer;
      answer = maybeNewPassword;
      newPassword = thirdArg;
    }
    const acc = targetUsername ? this.findUserByUsername(targetUsername) : this.getAccount();
    if (!acc) {
      return { ok: false, error: 'Bu kullanıcı adına sahip bir hesap bulunamadı!' };
    }
    const cleanAns = String(answer || '').trim().toLowerCase();
    if (!cleanAns || this.hash(cleanAns) !== acc.securityAnswerHash) {
      return { ok: false, error: 'Güvenlik sorusu yanıtı hatalı!' };
    }
    if (!newPassword || String(newPassword).length < 4) {
      return { ok: false, error: 'Yeni şifre en az 4 karakter olmalıdır.' };
    }
    acc.passwordHash = this.hash(String(newPassword));
    acc.isDefaultPassword = false;
    this.saveAccount(acc);
    this._saveSessionToken(this._expectedToken(acc), true);
    return { ok: true, account: acc };
  },

  isProtectedPage() {
    const path = window.location.pathname.replace(/\\/g, '/').toLowerCase();
    return path.includes('/sinifim.html') || path.includes('/paylasimlar.html') || path.includes('/editor-') || path.endsWith('sinifim.html') || path.endsWith('paylasimlar.html') || /editor-[a-z0-9_-]+\.html$/i.test(path);
  },

  requireTeacher() {
    if (this.isProtectedPage() && !this.isLoggedIn()) {
      document.documentElement.style.visibility = 'hidden';
      const path = window.location.pathname.replace(/\\/g, '/');
      const fileName = path.split('/').pop() || 'index.html';
      const redirectParam = encodeURIComponent(fileName + window.location.search);
      const loginTarget = this._pageUrl(`pages/login.html?redirect=${redirectParam}`, `login.html?redirect=${redirectParam}`);
      window.location.replace(loginTarget);
      return false;
    }
    return true;
  },

  syncNavbarAndRoleUI() {
    const loggedIn = this.isLoggedIn();
    const isAdminUser = loggedIn && this.isAdmin();
    const acc = this.getCurrentUser() || this.getAccount();
    const loginHref = this._pageUrl('pages/login.html', 'login.html');
    const paylasimHref = this._pageUrl('pages/paylasimlar.html', 'paylasimlar.html');

    // Üst menüde "Paylaşımlar" bağlantısı eksikse otomatik ekle
    const navList = document.querySelector('.navbar-nav');
    if (navList && !navList.querySelector('a[href*="paylasimlar.html"]')) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = paylasimHref;
      a.textContent = '🤝 Paylaşımlar';
      if (window.location.pathname.replace(/\\/g, '/').toLowerCase().includes('paylasimlar.html')) {
        a.className = 'active';
      }
      li.appendChild(a);
      const sinifimAnchor = navList.querySelector('a[href*="sinifim.html"]');
      const refLi = sinifimAnchor ? sinifimAnchor.closest('li') : navList.querySelector('li');
      if (refLi && refLi.nextSibling) {
        navList.insertBefore(li, refLi.nextSibling);
      } else {
        navList.appendChild(li);
      }
    }

    const pendingCount = (isAdminUser && typeof SharedActivityStore !== 'undefined' && SharedActivityStore.getPendingCount)
      ? SharedActivityStore.getPendingCount()
      : 0;

    // Menü bağlantılarını role göre güncelle
    document.querySelectorAll('.navbar-nav a').forEach(link => {
      const href = (link.getAttribute('href') || '').toLowerCase();
      if (href.includes('sinifim.html') || href.includes('paylasimlar.html')) {
        const li = link.closest('li');
        if (li) li.style.display = loggedIn ? '' : 'none';
        else link.style.display = loggedIn ? '' : 'none';
      }
      if (href.includes('paylasimlar.html')) {
        link.querySelectorAll('.share-pending-pill').forEach(p => p.remove());
        if (pendingCount > 0) {
          const pill = document.createElement('span');
          pill.className = 'share-pending-pill';
          pill.style.cssText = 'margin-left:5px; background:#F59E0B; color:#fff; font-size:0.72rem; font-weight:900; padding:1px 6px; border-radius:999px;';
          pill.textContent = String(pendingCount);
          link.appendChild(pill);
        }
      }
      if (href.endsWith('index.html')) {
        link.textContent = loggedIn ? '📋 Öğretmen Paneli' : '🏠 Etkinlikler';
      }
    });

    // Etkinlik oynatıcılarındaki öğretmen düğmelerini misafirlere gizle
    if (!loggedIn) {
      const editLink = document.getElementById('editLink');
      if (editLink) editLink.style.display = 'none';
      const noteBtn = document.getElementById('noteBtn');
      if (noteBtn) noteBtn.style.display = 'none';
    }

    // Giriş sayfasında ekstra hesap/giriş butonu basma
    const isLoginPage = window.location.pathname.replace(/\\/g, '/').toLowerCase().includes('login.html');
    if (isLoginPage) return;

    // Navbar aksiyon çubuğu
    const actionsEl = document.querySelector('.navbar-actions');
    if (actionsEl) {
      // Önceki auth elemanlarını temizle
      actionsEl.querySelectorAll('.auth-ui-el').forEach(el => el.remove());

      // Öğretmene özel üst menü butonlarını misafir modunda gizle
      if (!loggedIn) {
        actionsEl.querySelectorAll('[onclick*="newActivityModal"], [onclick*="newStudentModal"], [onclick*="bulkStudentModal"], [onclick*="newCustomBadgeModal"]').forEach(btn => {
          btn.style.display = 'none';
        });
      }

      if (loggedIn && acc) {
        const badge = document.createElement('span');
        badge.className = 'auth-ui-el teacher-badge';
        badge.style.cssText = isAdminUser
          ? 'font-size:0.82rem; font-weight:800; background:#FEF3C7; color:#92400E; border:1px solid #FCD34D; padding:5px 12px; border-radius:50px; display:inline-flex; align-items:center; gap:5px; white-space:nowrap;'
          : 'font-size:0.82rem; font-weight:800; background:var(--primary-light); color:var(--primary); padding:5px 12px; border-radius:50px; display:inline-flex; align-items:center; gap:5px; white-space:nowrap;';
        badge.textContent = isAdminUser ? `🛡️ ${acc.displayName} (Yönetici)` : `👩‍🏫 ${acc.displayName}`;

        const accBtn = document.createElement('button');
        accBtn.type = 'button';
        accBtn.className = 'btn btn-outline btn-sm auth-ui-el';
        accBtn.textContent = '⚙️ Hesap & Şifre';
        accBtn.onclick = () => AuthStore.openAccountModal();

        const logoutBtn = document.createElement('button');
        logoutBtn.type = 'button';
        logoutBtn.className = 'btn btn-outline btn-sm auth-ui-el';
        logoutBtn.style.cssText = 'color:var(--danger); border-color:var(--danger);';
        logoutBtn.textContent = '🚪 Çıkış';
        logoutBtn.onclick = () => AuthStore.logout();

        actionsEl.appendChild(badge);
        actionsEl.appendChild(accBtn);
        actionsEl.appendChild(logoutBtn);
      } else {
        const loginBtn = document.createElement('a');
        loginBtn.href = loginHref;
        loginBtn.className = 'btn btn-outline btn-sm auth-ui-el';
        loginBtn.style.cssText = 'border-color:var(--primary); color:var(--primary); font-weight:800;';
        loginBtn.textContent = '🔐 Öğretmen Girişi';

        const regBtn = document.createElement('a');
        regBtn.href = `${loginHref}?mode=register`;
        regBtn.className = 'btn btn-primary btn-sm auth-ui-el';
        regBtn.style.cssText = 'font-weight:800;';
        regBtn.textContent = '✨ Kayıt Ol';

        actionsEl.appendChild(loginBtn);
        actionsEl.appendChild(regBtn);
      }
    }
  },

  openAccountModal() {
    if (!this.isLoggedIn()) return;
    const acc = this.getCurrentUser();
    if (!acc) return;
    let modal = document.getElementById('teacherAccountModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'teacherAccountModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:520px;">
          <div class="modal-header">
            <h2 class="modal-title">⚙️ Öğretmen Hesabı ve Şifre Ayarları</h2>
            <button class="modal-close" onclick="closeModal('teacherAccountModal')">✕</button>
          </div>
          <div id="accAlertArea"></div>
          <div class="form-group">
            <label class="form-label">Görünen Adınız (Öğretmen Panelinde görünür)</label>
            <input type="text" class="form-control" id="accDisplayName" placeholder="Örn: Ahmet Öğretmen" />
          </div>
          <div class="form-group">
            <label class="form-label">Kullanıcı Adı <span style="color:var(--danger)">*</span></label>
            <input type="text" class="form-control" id="accUsername" placeholder="Kullanıcı adı..." />
          </div>
          <div class="form-group">
            <label class="form-label">Mevcut Şifre <span style="color:var(--danger)">*</span></label>
            <input type="password" class="form-control" id="accCurrentPassword" placeholder="Değişiklikleri onaylamak için mevcut şifreniz" />
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
              <label class="form-label">Yeni Şifre (İsteğe bağlı)</label>
              <input type="password" class="form-control" id="accNewPassword" placeholder="Boş bırakılabilir" />
            </div>
            <div class="form-group">
              <label class="form-label">Yeni Şifre Tekrar</label>
              <input type="password" class="form-control" id="accNewPasswordConfirm" placeholder="Tekrar yazın" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Güvenlik Sorusu (Şifre sıfırlama için)</label>
            <input type="text" class="form-control" id="accSecurityQuestion" />
          </div>
          <div class="form-group">
            <label class="form-label">Yeni Güvenlik Yanıtı (Değiştirmek istemiyorsanız boş bırakın)</label>
            <input type="text" class="form-control" id="accSecurityAnswer" placeholder="Yeni güvenlik yanıtı..." />
          </div>
          <div style="display:flex; gap:12px; justify-content:flex-end; margin-top:20px;">
            <button type="button" class="btn btn-outline" onclick="closeModal('teacherAccountModal')">İptal</button>
            <button type="button" class="btn btn-primary" onclick="AuthStore._handleAccountSave()">💾 Bilgileri Güncelle</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('accAlertArea').innerHTML = '';
    document.getElementById('accDisplayName').value = acc.displayName || '';
    document.getElementById('accUsername').value = acc.username || '';
    document.getElementById('accCurrentPassword').value = '';
    document.getElementById('accNewPassword').value = '';
    document.getElementById('accNewPasswordConfirm').value = '';
    document.getElementById('accSecurityQuestion').value = acc.securityQuestion || '';
    document.getElementById('accSecurityAnswer').value = '';
    openModal('teacherAccountModal');
  },

  _handleAccountSave() {
    const displayName = document.getElementById('accDisplayName').value.trim();
    const newUsername = document.getElementById('accUsername').value.trim();
    const currentPassword = document.getElementById('accCurrentPassword').value;
    const newPassword = document.getElementById('accNewPassword').value;
    const newPasswordConfirm = document.getElementById('accNewPasswordConfirm').value;
    const securityQuestion = document.getElementById('accSecurityQuestion').value.trim();
    const securityAnswer = document.getElementById('accSecurityAnswer').value.trim();

    if (!currentPassword) {
      showToast('Değişiklikleri kaydetmek için mevcut şifrenizi girin!', 'warning');
      return;
    }
    if (newPassword && newPassword !== newPasswordConfirm) {
      showToast('Yeni şifre ve tekrarı birbiriyle eşleşmiyor!', 'error');
      return;
    }

    const res = this.updateCredentials({
      currentPassword,
      newUsername,
      newPassword,
      displayName,
      securityQuestion,
      securityAnswer
    });

    if (!res.ok) {
      showToast(res.error, 'error');
      return;
    }

    closeModal('teacherAccountModal');
    this.syncNavbarAndRoleUI();
    showToast('Öğretmen hesap ve şifre bilgileri güncellendi!', 'success');
    if (typeof initPage === 'function') initPage();
  }
};

// Sayfa yetki kontrolünü dosya yüklenir yüklenmez uygula
AuthStore.requireTeacher();

// ---- TÜRK ALFABESİ (29 HARF) ----
const TURKISH_ALPHABET = ['A','B','C','Ç','D','E','F','G','Ğ','H','I','İ','J','K','L','M','N','O','Ö','P','R','S','Ş','T','U','Ü','V','Y','Z'];

// ---- VARSAYILAN PAROLLA SORULARI (A-Z TÜRKÇE MÜFREDAT) ----
const DEFAULT_PAROLLA_QUESTIONS = [
  { letter: 'A', question: 'Bir durumu veya varlığı olduğundan çok daha büyük ya da küçük gösterme sanatı', answer: 'Abartma' },
  { letter: 'B', question: 'Divan şiirinde iki dizeden oluşan nazım birimi', answer: 'Beyit' },
  { letter: 'C', question: 'Bir duyguyu, düşünceyi ya da durumu tam olarak anlatan sözcük dizisi', answer: 'Cümle' },
  { letter: 'Ç', question: 'Bir dizedeki kafiyeli sözcüklerin çaprazlama (abab) dizilişi', answer: 'Çapraz' },
  { letter: 'D', question: 'Şiirin her bir satırına verilen Türkçe karşılık', answer: 'Dize' },
  { letter: 'E', question: 'Tek başına anlamı olmayıp cümle içinde anlam ilgisi kuran sözcük türü', answer: 'Edat' },
  { letter: 'F', question: 'İş, oluş, hareket ve durum bildiren sözcük türü (eylem)', answer: 'Fiil' },
  { letter: 'G', question: 'Divan edebiyatında 5 ile 15 beyit arasında yazılan lirik nazım biçimi', answer: 'Gazel' },
  { letter: 'Ğ', question: 'Sözcük başında bulunmayan, Türkçeye özgü yumuşak ünsüz harf', answer: 'Yumuşak G' },
  { letter: 'H', question: 'Şiirde dizelerdeki hece sayılarının eşitliğine dayanan Türk milli ölçüsü', answer: 'Hece' },
  { letter: 'I', question: 'Uzak anlamına gelen ve "gözden ... olan gönülden de ... olur" atasözünde geçen sözcük', answer: 'Irak' },
  { letter: 'İ', question: 'Varlıkları ve kavramları karşılayan sözcük türü (ad)', answer: 'İsim' },
  { letter: 'J', question: 'Tiyatro veya sinemada bir sahne ya da rolü oynamak için kullanılan terim', answer: 'Jön' },
  { letter: 'K', question: 'Dize sonlarındaki ses benzerliği (uyak)', answer: 'Kafiye' },
  { letter: 'L', question: 'Duygu ve coşkuların yoğun olarak işlendiği şiir türü', answer: 'Lirik' },
  { letter: 'M', question: '7\'li hece ölçüsüyle yazılan ve aaxa kafiye düzenine sahip anonim halk şiiri', answer: 'Mâni' },
  { letter: 'N', question: 'Tamamlanmış cümlenin sonuna konulan temel noktalama işareti', answer: 'Nokta' },
  { letter: 'O', question: 'Şiirde hece veya aruz kalıplarıyla sağlanan tartım ve ahenk kuralı', answer: 'Ölçü' },
  { letter: 'Ö', question: 'Cümlede yüklemin bildirdiği işi yapan veya yargının konusu olan temel öge', answer: 'Özne' },
  { letter: 'P', question: 'Tiyatro eserinin bölümlerine verilen ad', answer: 'Perde' },
  { letter: 'R', question: 'Dize sonlarında kafiyeden sonra gelen aynı görevdeki ek veya sözcük', answer: 'Redif' },
  { letter: 'S', question: 'İsimlerin önüne gelerek onları niteleyen veya belirten sözcük (önad)', answer: 'Sıfat' },
  { letter: 'Ş', question: 'Duygu, hayal ve ahengin dizelerle anlatıldığı edebi tür', answer: 'Şiir' },
  { letter: 'T', question: 'Aralarında ilgi bulunan iki şeyden zayıf olanı güçlü olana benzetme sanatı', answer: 'Teşbih' },
  { letter: 'U', question: 'Şiirde dize sonlarındaki kafiyenin Türkçe karşılığı', answer: 'Uyak' },
  { letter: 'Ü', question: 'Sevinç, korku, heyecan gibi ani duyguları bildiren sözcük türü', answer: 'Ünlem' },
  { letter: 'V', question: 'Eş görevli sözcükleri veya sıralı cümleleri ayırmada kullanılan noktalama işareti', answer: 'Virgül' },
  { letter: 'Y', question: 'Cümledeki işi, hareketi veya yargıyı üzerinde toplayan en temel öge', answer: 'Yüklem' },
  { letter: 'Z', question: 'Fiilleri, sıfatları ve zarfları durum, zaman veya miktar yönünden belirten sözcük', answer: 'Zarf' }
];

// ---- AKTİVİTELER ----
const ActivityStore = {
  STORAGE_KEY: 'activities',
  SEED_OVERRIDES_PREFIX: 'seed_overrides_',
  HIDDEN_SEEDS_PREFIX: 'hidden_seeds_',

  getSeedIds() {
    return new Set(getSeedActivities().map(a => a.id));
  },

  isSeedActivity(activity) {
    if (!activity) return false;
    return activity.isSeed === true || this.getSeedIds().has(activity.id);
  },

  _userScopeId() {
    const u = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;
    return u ? u.id : 'guest';
  },

  _seedOverridesKey(uid) {
    return `${this.SEED_OVERRIDES_PREFIX}${uid || this._userScopeId()}`;
  },

  _hiddenSeedsKey(uid) {
    return `${this.HIDDEN_SEEDS_PREFIX}${uid || this._userScopeId()}`;
  },

  getCustomActivitiesRaw() {
    let list = DB.get(this.STORAGE_KEY);
    if (!Array.isArray(list)) return [];
    const seedIds = this.getSeedIds();
    const migratedFlag = DB.get('activities_v2_owner_migrated');
    let changed = false;

    const customOnly = [];
    for (const item of list) {
      if (!item || typeof item !== 'object' || !item.id) {
        changed = true;
        continue;
      }
      if (seedIds.has(item.id) || item.isSeed === true) {
        changed = true;
        continue;
      }
      if (!item.ownerId || item.ownerId === ('u_' + 'primary')) {
        item.ownerId = (typeof AuthStore !== 'undefined' && AuthStore.ADMIN_SUPABASE_UID) ? AuthStore.ADMIN_SUPABASE_UID : 'owner_admin';
        if (!item.ownerName) item.ownerName = 'Yönetici Öğretmen';
        item.isSeed = false;
        changed = true;
      }
      const upgradedItem = typeof _upgradeActivityUrlsToHttps === 'function' ? _upgradeActivityUrlsToHttps(item) : item;
      if (JSON.stringify(upgradedItem) !== JSON.stringify(item)) changed = true;
      customOnly.push(upgradedItem);
    }

    if (changed || !migratedFlag) {
      DB.set(this.STORAGE_KEY, customOnly);
      DB.set('activities_v2_owner_migrated', true);
    }
    return customOnly;
  },

  getAll() {
    const currentUser = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;
    const seeds = getSeedActivities().map(a => ({ ...a, isSeed: true }));

    if (!currentUser) {
      return seeds;
    }

    const uid = currentUser.id;
    const isAdminUser = !!(typeof AuthStore !== 'undefined' && AuthStore.isAdmin && AuthStore.isAdmin(currentUser));
    const overrides = DB.get(this._seedOverridesKey(uid)) || {};
    const hiddenArr = DB.get(this._hiddenSeedsKey(uid)) || [];
    const hiddenSet = new Set(Array.isArray(hiddenArr) ? hiddenArr : []);

    const scopedSeeds = seeds
      .filter(s => !hiddenSet.has(s.id))
      .map(s => (overrides[s.id] ? { ...s, ...overrides[s.id], isSeed: true } : s));

    const myCustom = this.getCustomActivitiesRaw()
      .filter(a => a.ownerId === uid || (currentUser.supabaseUid && a.ownerId === currentUser.supabaseUid) || (isAdminUser && a.ownerId === AuthStore.ADMIN_SUPABASE_UID))
      .map(a => ({ ...a, isSeed: false }));

    return [...myCustom, ...scopedSeeds];
  },

  getById(id) {
    if (!id) return null;
    const strId = String(id);
    const inScope = this.getAll().find(a =>
      String(a.id) === strId || (a.supabaseId && String(a.supabaseId) === strId)
    );
    if (inScope) return inScope;

    // Uzak (?etkinlik=ID) önbelleğinden kontrol et
    const remoteCached = (typeof SupabaseService !== 'undefined' && SupabaseService.getCachedEtkinlik)
      ? SupabaseService.getCachedEtkinlik(strId)
      : null;

    // Korumalı düzenleme sayfalarında sadece öğretmenin kendi erişebildiği veya önbelleğe alınan dersler döner
    if (typeof AuthStore !== 'undefined' && AuthStore.isProtectedPage && AuthStore.isProtectedPage()) {
      return remoteCached || null;
    }

    // Öğrenci/oynatıcı sayfalarında herhangi bir öğretmenin paylaştığı ders bağlantısı çalışsın
    const customMatch = this.getCustomActivitiesRaw().find(a =>
      String(a.id) === strId || (a.supabaseId && String(a.supabaseId) === strId)
    );
    if (customMatch) return { ...customMatch, isSeed: false };
    const seedMatch = getSeedActivities().find(a => String(a.id) === strId);
    if (seedMatch) return { ...seedMatch, isSeed: true };
    if (remoteCached) return remoteCached;
    if (typeof SharedActivityStore !== 'undefined' && SharedActivityStore.findPlayableSnapshot) {
      return SharedActivityStore.findPlayableSnapshot(id);
    }
    return null;
  },

  findByCode(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return null;
    const inScope = this.getAll().find(a => String(a.code || '').toUpperCase() === clean);
    if (inScope) return inScope;
    const customMatch = this.getCustomActivitiesRaw().find(a => String(a.code || '').toUpperCase() === clean);
    if (customMatch) return { ...customMatch, isSeed: false };
    const seedMatch = getSeedActivities().find(a => String(a.code || '').toUpperCase() === clean);
    return seedMatch ? { ...seedMatch, isSeed: true } : null;
  },

  save(activity) {
    if (!activity) return null;
    if (activity.isSharedPreview) return activity;
    if (typeof _upgradeActivityUrlsToHttps === 'function') {
      activity = _upgradeActivityUrlsToHttps(activity);
    }
    const currentUser = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;

    if (this.isSeedActivity(activity)) {
      if (!currentUser) return activity;
      const overrides = DB.get(this._seedOverridesKey(currentUser.id)) || {};
      overrides[activity.id] = { ...activity, isSeed: true };
      DB.set(this._seedOverridesKey(currentUser.id), overrides);
      if (typeof SupabaseService !== 'undefined') SupabaseService._lastSavedActivity = overrides[activity.id];
      return overrides[activity.id];
    }

    const list = this.getCustomActivitiesRaw();
    const idx = list.findIndex(a => a.id === activity.id);

    if (idx >= 0) {
      const existing = list[idx];
      const isProtected = typeof AuthStore !== 'undefined' && AuthStore.isProtectedPage && AuthStore.isProtectedPage();
      if (currentUser && existing.ownerId && existing.ownerId !== currentUser.id) {
        if (isProtected) {
          if (typeof SupabaseService !== 'undefined') SupabaseService._lastSavedActivity = existing;
          return existing;
        }
        // Misafir/öğrenci veya başka kullanıcı oynatırken yalnızca oynanma sayacını günceller
        list[idx] = { ...existing, playCount: activity.playCount ?? existing.playCount };
        DB.set(this.STORAGE_KEY, list);
        if (typeof SupabaseService !== 'undefined') SupabaseService._lastSavedActivity = list[idx];
        return list[idx];
      }
      if (!currentUser && existing.ownerId) {
        list[idx] = { ...existing, playCount: activity.playCount ?? existing.playCount };
        DB.set(this.STORAGE_KEY, list);
        if (typeof SupabaseService !== 'undefined') SupabaseService._lastSavedActivity = list[idx];
        return list[idx];
      }
      const fallbackOwnerId = (currentUser && (currentUser.supabaseUid || currentUser.id))
        || ((typeof AuthStore !== 'undefined' && AuthStore.ADMIN_SUPABASE_UID) ? AuthStore.ADMIN_SUPABASE_UID : 'owner_admin');
      const fallbackOwnerName = (currentUser && (currentUser.displayName || currentUser.email)) || 'Öğretmen';
      const updated = {
        ...activity,
        ownerId: existing.ownerId || fallbackOwnerId,
        ownerName: existing.ownerName || fallbackOwnerName,
        isSeed: false
      };
      list[idx] = updated;
      DB.set(this.STORAGE_KEY, list);
      if (typeof SupabaseService !== 'undefined') SupabaseService._lastSavedActivity = updated;
      return updated;
    }

    const fallbackOwnerId = (currentUser && (currentUser.supabaseUid || currentUser.id))
      || ((typeof AuthStore !== 'undefined' && AuthStore.ADMIN_SUPABASE_UID) ? AuthStore.ADMIN_SUPABASE_UID : 'owner_admin');
    const fallbackOwnerName = (currentUser && (currentUser.displayName || currentUser.email)) || 'Öğretmen';
    const toSave = {
      ...activity,
      ownerId: activity.ownerId || fallbackOwnerId,
      ownerName: activity.ownerName || fallbackOwnerName,
      isSeed: false
    };
    list.unshift(toSave);
    DB.set(this.STORAGE_KEY, list);
    if (typeof SupabaseService !== 'undefined') SupabaseService._lastSavedActivity = toSave;
    return toSave;
  },

  delete(id) {
    const currentUser = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;
    if (!currentUser) return this.getAll();

    if (this.getSeedIds().has(id)) {
      const hiddenKey = this._hiddenSeedsKey(currentUser.id);
      const hiddenArr = DB.get(hiddenKey) || [];
      if (!hiddenArr.includes(id)) {
        hiddenArr.push(id);
        DB.set(hiddenKey, hiddenArr);
      }
      return this.getAll();
    }

    const list = this.getCustomActivitiesRaw().filter(a => !(a.id === id && a.ownerId === currentUser.id));
    DB.set(this.STORAGE_KEY, list);
    return this.getAll();
  },

  resetToDefaults() {
    const currentUser = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;
    if (currentUser) {
      DB.set(this._seedOverridesKey(currentUser.id), {});
      DB.set(this._hiddenSeedsKey(currentUser.id), []);
    }
    DB.set('maarif_v2026_model_v1', true);
    DB.set('sezdirme_v1_loaded', true);
    return this.getAll();
  },

  createNew(type, grade = '5', theme = '') {
    const normalizedType = type === 'quiz' ? 'minideneme' : type;
    const defaults = {
      minideneme: {
        title: 'Yeni Mini Deneme',
        description: 'Türkçe dersi çoktan seçmeli deneme soruları',
        settings: { timePerQuestion: 40, showFeedback: true },
        questions: [
          {
            id: generateId(),
            text: 'Aşağıdaki cümlelerin hangisinde bir yazım yanlışı vardır?',
            options: [
              'Türk Dili ve Edebiyatı dersi çok keyifli geçti.',
              'Yarın sabah erken den yola çıkacağız.',
              'Kitaptaki soruların tamamını çözdüm.',
              'Güneş batarken gökyüzü kızıllaştı.'
            ],
            correct: 1,
            explanation: '"erkenden" sözcüğü bitişik yazılır.'
          }
        ]
      },
      presentation: {
        title: 'Yeni Etkileşimli Sunum',
        description: 'Slaytlar, şiirler ve tıkla-keşfet düğmeleri',
        settings: { autoPlay: false, autoPlayDelay: 5 },
        slides: [
          {
            id: generateId(),
            type: 'title',
            title: 'Ders ve Konu Başlığı',
            subtitle: 'Türkçe Dersi Etkileşimli Sunumu',
            image: ''
          },
          {
            id: generateId(),
            type: 'content',
            title: 'Konu Özeti',
            content: 'Bu alanda dersinizin önemli kazanımlarını ve konu anlatımını paylaşabilirsiniz.',
            image: ''
          }
        ]
      },
      blank: {
        title: 'Yeni Boşluk Doldurma',
        description: 'Cümledeki boşlukları uygun kelimelerle doldurun',
        settings: { showHint: true },
        questions: [
          {
            id: generateId(),
            rawText: 'Tamamlanmış cümlenin sonuna [nokta] konulur.',
            parts: [
              { type: 'text', value: 'Tamamlanmış cümlenin sonuna ' },
              { type: 'blank', answer: 'nokta', hint: 'n...' },
              { type: 'text', value: ' konulur.' }
            ]
          }
        ]
      },
      wheel: {
        title: 'Yeni Çarkıfelek',
        description: 'Rastgele öğrenci veya soru seçimi çarkı',
        settings: { removeOnSpin: false },
        items: ['İsim', 'Sıfat', 'Zamir', 'Zarf', 'Fiil', 'Edat', 'Bağlaç', 'Ünlem']
      },
      matching: {
        title: 'Yeni Kelime Eşleştirme',
        description: 'Kavramları doğru açıklamalarıyla eşleştirin',
        settings: { showTimer: true },
        pairs: [
          { id: generateId(), left: 'Ağzı sıkı', right: 'Sır saklamayı bilen' },
          { id: generateId(), left: 'Kulak kabartmak', right: 'Gizlice dinlemek' }
        ]
      },
      flashcard: {
        title: 'Yeni Hafıza Kartları',
        description: 'Kartları çevirerek kavramları öğrenin',
        settings: { shuffle: true },
        cards: [
          { id: generateId(), front: 'Teşbih (Benzetme)', back: 'Bir varlığı başka bir varlığa benzeterek anlatma sanatıdır.' }
        ]
      },
      sezdirme: {
        title: 'Yeni Sezdirme Dersi',
        description: 'Kuralı doğrudan vermeden, örneklerden keşfettiren ders akışı',
        objective: '',
        settings: { showTeacherNotes: false },
        steps: ['hazirlik', 'gozlem', 'karsilastir', 'soru', 'siniflandir', 'cikarim', 'kural', 'uygulama']
          .map(t => createSezdirmeStep(t))
      },
      parolla: {
        title: 'Yeni Parolla (Alfabe Çarkı)',
        description: 'A\'dan Z\'ye harf çarkı maratonu',
        settings: { timeLimit: 180, allowPass: true },
        questions: JSON.parse(JSON.stringify(DEFAULT_PAROLLA_QUESTIONS))
      }
    };

    const typeConfig = defaults[normalizedType] || defaults.minideneme;
    const currentUser = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;

    return {
      id: generateId(),
      type: normalizedType,
      grade: grade || '5',
      theme: theme || 'Genel Türkçe',
      code: generateCode(),
      ownerId: currentUser ? (currentUser.supabaseUid || currentUser.id) : ((typeof AuthStore !== 'undefined' && AuthStore.ADMIN_SUPABASE_UID) ? AuthStore.ADMIN_SUPABASE_UID : 'owner_admin'),
      ownerName: currentUser ? (currentUser.displayName || currentUser.email) : 'Öğretmen',
      isSeed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      playCount: 0,
      ...JSON.parse(JSON.stringify(typeConfig))
    };
  }
};

// ---- ÖĞRETMENLER ARASI İÇERİK PAYLAŞIM HAVUZU (ONAY AKIŞLI) ----
function getSeedSharedActivities() {
  const now = Date.now();
  return [
    {
      id: 'sh_seed_1',
      sourceActivityId: 'demo_ext_1',
      title: '5. Sınıf Günlük Yaşamdan Deyimler Eşleştirme',
      description: 'Öğrencilerin konuşma ve yazma becerilerinde sık kullandığı temel deyimleri anlamlarıyla eşleştirme çalışması.',
      type: 'matching',
      grade: '5',
      theme: 'Dilimizin Zenginliği',
      outcome: 'T.O.5.4',
      teacherNote: '5. sınıflarda deyimler konusunu pekiştirmek için 5 dakikalık grup yarışması şeklinde uyguladım, çok ilgi gördü.',
      authorId: 'u_demo_ayse',
      authorName: 'Ayşe Yılmaz (Türkçe Zümresi)',
      authorUsername: 'ayse_turkce',
      status: 'approved',
      rejectionReason: '',
      submittedAt: new Date(now - 86400000 * 5).toISOString(),
      reviewedAt: new Date(now - 86400000 * 4).toISOString(),
      reviewedBy: 'Türkçe Öğretmeni',
      usageCount: 14,
      activitySnapshot: {
        id: 'sh_seed_1',
        type: 'matching',
        grade: '5',
        theme: 'Dilimizin Zenginliği',
        outcome: 'T.O.5.4',
        title: '5. Sınıf Günlük Yaşamdan Deyimler Eşleştirme',
        description: 'Öğrencilerin sık kullandığı deyimleri gerçek anlamlarıyla eşleştirin.',
        code: 'PAY001',
        settings: { showTimer: true },
        pairs: [
          { id: 'sp_1', left: 'Gözden düşmek', right: 'Eski değerini ve saygınlığını yitirmek' },
          { id: 'sp_2', left: 'Dil dökmek', right: 'İnandırmak veya gönül almak için tatlı sözler söylemek' },
          { id: 'sp_3', left: 'Kulak asmamak', right: 'Söyleneni önemsememek, dinlememek' },
          { id: 'sp_4', left: 'Etekleri zil çalmak', right: 'Çok sevinmek, coşku duymak' },
          { id: 'sp_5', left: 'Burnunun dikine gitmek', right: 'Başkasının öğüdünü dinlemeyip bildiğini yapmak' }
        ]
      }
    },
    {
      id: 'sh_seed_2',
      sourceActivityId: 'demo_ext_2',
      title: '6. Sınıf İsim Tamlamaları ve Sıfatlar Mini Deneme',
      description: 'Belirtili, belirtisiz isim tamlamaları ile niteleme sıfatlarını ayırt etmeye yönelik 3 soruluk hızlı sınıf taraması.',
      type: 'minideneme',
      grade: '6',
      theme: 'Erdemlerimiz',
      outcome: 'DYS.DO.6.3',
      teacherNote: 'Konu anlatımı sonrası çıkış kartı yerine hızlı tarama olarak kullanabilirsiniz.',
      authorId: 'u_demo_mehmet',
      authorName: 'Mehmet Demir (Türkçe Öğretmeni)',
      authorUsername: 'mehmet_trk',
      status: 'approved',
      rejectionReason: '',
      submittedAt: new Date(now - 86400000 * 3).toISOString(),
      reviewedAt: new Date(now - 86400000 * 2).toISOString(),
      reviewedBy: 'Türkçe Öğretmeni',
      usageCount: 9,
      activitySnapshot: {
        id: 'sh_seed_2',
        type: 'minideneme',
        grade: '6',
        theme: 'Erdemlerimiz',
        outcome: 'DYS.DO.6.3',
        title: '6. Sınıf İsim Tamlamaları ve Sıfatlar Mini Deneme',
        description: 'İsim tamlamaları ve sıfatları ayırt etme soruları',
        code: 'PAY002',
        settings: { timePerQuestion: 45, showFeedback: true },
        questions: [
          {
            id: 'sq_1',
            text: 'Aşağıdaki dizelerin hangisinde belirtili isim tamlaması kullanılmıştır?',
            options: [
              'Mavi deniz kıyıya usulca vuruyordu.',
              'Sonbaharın sarı yaprakları bahçeyi süsledi.',
              'Sabah güneşin altında yürüyüş yaptık.',
              'Çocukluk yılları hafızamdan hiç silinmiyor.'
            ],
            correct: 1,
            explanation: '"Sonbaharın yaprakları" hem tamlayan hem de tamlanan eki aldığı için belirtili isim tamlamasıdır.'
          },
          {
            id: 'sq_2',
            text: '"Bahçedeki yaşlı çınar gölgesinde kitap okuduk." cümlesindeki altı çizili olabilecek niteleme sıfatı hangisidir?',
            options: [
              'bahçedeki',
              'yaşlı',
              'gölgesinde',
              'kitap'
            ],
            correct: 1,
            explanation: '"Yaşlı" sözcüğü çınar isminin özelliğini nitelediği için niteleme sıfatıdır.'
          },
          {
            id: 'sq_3',
            text: 'Aşağıdakilerden hangisi belirtisiz isim tamlamasıdır?',
            options: [
              'Türkçe defteri',
              'Defterin kapağı',
              'Güzel defter',
              'Benim kalemim'
            ],
            correct: 0,
            explanation: 'Tamlayanı ek almayıp tamlananı iyelik eki alan "Türkçe defteri" tamlaması belirtisiz isim tamlamasıdır.'
          }
        ]
      }
    },
    {
      id: 'sh_seed_3',
      sourceActivityId: 'demo_ext_3',
      title: '7. Sınıf Zarflar (Belirteçler) Boşluk Doldurma',
      description: 'Cümlede fiilleri zaman, durum, yer-yön ve miktar bakımından tamamlayan zarfları yerleştirme etkinliği.',
      type: 'blank',
      grade: '7',
      theme: 'Bilim ve Teknoloji',
      outcome: 'DYS.DO.7.2',
      teacherNote: 'Türkçe Öğretmeni hocam, 7. sınıflar için hazırladığım pekiştirme metnini paylaşıma sunuyorum.',
      authorId: 'u_demo_elif',
      authorName: 'Elif Kaya',
      authorUsername: 'elif_kaya',
      status: 'pending',
      rejectionReason: '',
      submittedAt: new Date(now - 3600000 * 4).toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      usageCount: 0,
      activitySnapshot: {
        id: 'sh_seed_3',
        type: 'blank',
        grade: '7',
        theme: 'Bilim ve Teknoloji',
        outcome: 'DYS.DO.7.2',
        title: '7. Sınıf Zarflar (Belirteçler) Boşluk Doldurma',
        description: 'Cümlelerdeki boşlukları uygun zarf türleriyle tamamlayın.',
        code: 'PAY003',
        settings: { showHint: true },
        questions: [
          {
            id: 'sb_1',
            rawText: 'Deney raporumuzu [yarın] öğretmenimize teslim edeceğiz.',
            parts: [
              { type: 'text', value: 'Deney raporumuzu ' },
              { type: 'blank', answer: 'yarın', hint: 'Zaman zarfı (y...)' },
              { type: 'text', value: ' öğretmenimize teslim edeceğiz.' }
            ]
          },
          {
            id: 'sb_2',
            rawText: 'Öğrenciler laboratuvardaki yönergeleri [dikkatlice] okuyup uyguladı.',
            parts: [
              { type: 'text', value: 'Öğrenciler laboratuvardaki yönergeleri ' },
              { type: 'blank', answer: 'dikkatlice', hint: 'Durum zarfı (d...)' },
              { type: 'text', value: ' okuyup uyguladı.' }
            ]
          },
          {
            id: 'sb_3',
            rawText: 'Bu yeni tasarım eskisinden [daha] hızlı çalışıyor.',
            parts: [
              { type: 'text', value: 'Bu yeni tasarım eskisinden ' },
              { type: 'blank', answer: 'daha', hint: 'Miktar/üstünlük zarfı (d...)' },
              { type: 'text', value: ' hızlı çalışıyor.' }
            ]
          }
        ]
      }
    }
  ];
}

const SharedActivityStore = {
  STORAGE_KEY: 'shared_activities_pool',
  SEEDED_KEY: 'shared_activities_seeded_v1',

  getAllRaw() {
    let list = DB.get(this.STORAGE_KEY);
    if (!Array.isArray(list) || !DB.get(this.SEEDED_KEY)) {
      if (!Array.isArray(list) || list.length === 0) {
        list = getSeedSharedActivities();
      }
      DB.set(this.STORAGE_KEY, list);
      DB.set(this.SEEDED_KEY, true);
    }
    return list;
  },

  saveAllRaw(list) {
    const clean = Array.isArray(list) ? list : [];
    DB.set(this.STORAGE_KEY, clean);
    DB.set(this.SEEDED_KEY, true);
    return clean;
  },

  getById(shareId) {
    return this.getAllRaw().find(item => item.id === shareId) || null;
  },

  getApproved() {
    return this.getAllRaw().filter(item => item.status === 'approved');
  },

  getMySubmissions() {
    const currentUser = AuthStore.getCurrentUser();
    if (!currentUser) return [];
    return this.getAllRaw().filter(item => item.authorId === currentUser.id);
  },

  getPendingForAdmin() {
    if (!AuthStore.isAdmin()) return [];
    return this.getAllRaw().filter(item => item.status === 'pending');
  },

  getAllForAdmin() {
    if (!AuthStore.isAdmin()) return [];
    return this.getAllRaw();
  },

  getPendingCount() {
    return this.getAllRaw().filter(item => item.status === 'pending').length;
  },

  submitActivity(activityId, teacherNote = '') {
    const currentUser = AuthStore.getCurrentUser();
    if (!currentUser) {
      return { ok: false, error: 'İçerik paylaşmak için önce öğretmen girişi yapmalısınız.' };
    }
    const activity = ActivityStore.getAll().find(a => a.id === activityId);
    if (!activity) {
      return { ok: false, error: 'Seçilen etkinlik bulunamadı.' };
    }
    if (ActivityStore.isSeedActivity(activity)) {
      return { ok: false, error: 'Sistemdeki hazır dersler yerine yalnızca kendi oluşturduğunuz etkinlikleri paylaşabilirsiniz.' };
    }

    const snapshot = JSON.parse(JSON.stringify(activity));
    delete snapshot.isSharedPreview;
    snapshot.isSeed = false;

    const list = this.getAllRaw();
    const existingIdx = list.findIndex(
      item => item.sourceActivityId === activity.id && item.authorId === currentUser.id
    );
    const existing = existingIdx >= 0 ? list[existingIdx] : null;

    // Paylaşılan hiçbir içerik doğrudan yayınlanmaz; mutlaka Türkçe Öğretmeni onayına gider
    const record = {
      id: existing ? existing.id : ('sh_' + generateId()),
      sourceActivityId: activity.id,
      title: activity.title || 'İsimsiz Etkinlik',
      description: activity.description || '',
      type: activity.type,
      grade: activity.grade || '5',
      theme: activity.theme || 'Genel Türkçe',
      outcome: activity.outcome || '',
      teacherNote: String(teacherNote || '').trim(),
      authorId: currentUser.id,
      authorName: currentUser.displayName,
      authorUsername: currentUser.username,
      status: 'pending',
      rejectionReason: '',
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      usageCount: existing ? (existing.usageCount || 0) : 0,
      activitySnapshot: snapshot
    };

    if (existingIdx >= 0) {
      list[existingIdx] = record;
    } else {
      list.unshift(record);
    }
    this.saveAllRaw(list);
    return { ok: true, item: record };
  },

  approve(shareId) {
    if (!AuthStore.isAdmin()) {
      return { ok: false, error: 'Bu işlem için yalnızca Türkçe Öğretmeni yönetici hesabı yetkilidir!' };
    }
    const adminUser = AuthStore.getCurrentUser();
    const list = this.getAllRaw();
    const idx = list.findIndex(item => item.id === shareId);
    if (idx < 0) {
      return { ok: false, error: 'Paylaşım kaydı bulunamadı.' };
    }
    list[idx] = {
      ...list[idx],
      status: 'approved',
      rejectionReason: '',
      reviewedAt: new Date().toISOString(),
      reviewedBy: adminUser.displayName
    };
    this.saveAllRaw(list);
    return { ok: true, item: list[idx] };
  },

  reject(shareId, reason = '') {
    if (!AuthStore.isAdmin()) {
      return { ok: false, error: 'Bu işlem için yalnızca Türkçe Öğretmeni yönetici hesabı yetkilidir!' };
    }
    const adminUser = AuthStore.getCurrentUser();
    const list = this.getAllRaw();
    const idx = list.findIndex(item => item.id === shareId);
    if (idx < 0) {
      return { ok: false, error: 'Paylaşım kaydı bulunamadı.' };
    }
    list[idx] = {
      ...list[idx],
      status: 'rejected',
      rejectionReason: String(reason || '').trim() || 'Yönetici tarafından yayınlanmaya uygun görülmedi.',
      reviewedAt: new Date().toISOString(),
      reviewedBy: adminUser.displayName
    };
    this.saveAllRaw(list);
    return { ok: true, item: list[idx] };
  },

  unpublishOrDelete(shareId) {
    const currentUser = AuthStore.getCurrentUser();
    if (!currentUser) {
      return { ok: false, error: 'Önce giriş yapmalısınız.' };
    }
    const list = this.getAllRaw();
    const item = list.find(i => i.id === shareId);
    if (!item) {
      return { ok: false, error: 'Paylaşım bulunamadı.' };
    }
    if (!AuthStore.isAdmin() && item.authorId !== currentUser.id) {
      return { ok: false, error: 'Yalnızca kendi paylaşımınızı veya Türkçe Öğretmeni yöneticisi bu içeriği kaldırabilir.' };
    }
    this.saveAllRaw(list.filter(i => i.id !== shareId));
    return { ok: true };
  },

  importToMyActivities(shareId) {
    const currentUser = AuthStore.getCurrentUser();
    if (!currentUser) {
      return { ok: false, error: 'Ders eklemek için önce giriş yapmalısınız.' };
    }
    const list = this.getAllRaw();
    const idx = list.findIndex(item => item.id === shareId);
    if (idx < 0) {
      return { ok: false, error: 'Paylaşılan etkinlik bulunamadı.' };
    }
    const item = list[idx];
    if (item.status !== 'approved' && !AuthStore.isAdmin()) {
      return { ok: false, error: 'Henüz onaylanmamış bir paylaşım derslere eklenemez.' };
    }

    const nowIso = new Date().toISOString();
    const cloned = JSON.parse(JSON.stringify(item.activitySnapshot || {}));
    cloned.id = generateId();
    cloned.code = generateCode();
    cloned.ownerId = currentUser.id;
    cloned.ownerName = currentUser.displayName;
    cloned.sharedFromAuthor = item.authorName;
    cloned.sharedSourceId = item.id;
    cloned.isSeed = false;
    cloned.playCount = 0;
    cloned.createdAt = nowIso;
    cloned.updatedAt = nowIso;
    delete cloned.isSharedPreview;

    if (Array.isArray(cloned.questions)) cloned.questions = cloned.questions.map(q => ({ ...q, id: generateId() }));
    if (Array.isArray(cloned.pairs)) cloned.pairs = cloned.pairs.map(p => ({ ...p, id: generateId() }));
    if (Array.isArray(cloned.cards)) cloned.cards = cloned.cards.map(c => ({ ...c, id: generateId() }));
    if (Array.isArray(cloned.slides)) cloned.slides = cloned.slides.map(s => ({ ...s, id: generateId() }));
    if (Array.isArray(cloned.steps)) cloned.steps = cloned.steps.map(s => ({ ...s, id: generateId() }));

    ActivityStore.save(cloned);
    list[idx] = { ...item, usageCount: (item.usageCount || 0) + 1 };
    this.saveAllRaw(list);
    return { ok: true, activity: cloned };
  },

  findPlayableSnapshot(id) {
    if (!id) return null;
    const item = this.getById(id);
    if (!item || !item.activitySnapshot) return null;
    const currentUser = AuthStore.getCurrentUser();
    const canViewUnapproved = AuthStore.isAdmin() || (currentUser && item.authorId === currentUser.id);
    if (item.status !== 'approved' && !canViewUnapproved) {
      return null;
    }
    const snap = JSON.parse(JSON.stringify(item.activitySnapshot));
    snap.id = item.id;
    snap.isSeed = false;
    snap.isSharedPreview = true;
    return snap;
  }
};

// ---- VARSAYILAN PEDAGOJİK ROZETLER ----
const DEFAULT_BADGES = [
  { id: 'b_kitap', name: 'Kitap Kurdu', icon: '📖', desc: 'Düzenli kitap okuma ve özetleme başarısı', points: 15 },
  { id: 'b_imla', name: 'İmla Ustası', icon: '✍️', desc: 'Yazım ve noktalama kurallarına tam uyum', points: 15 },
  { id: 'b_aktif', name: 'Aktif Katılım', icon: '🎯', desc: 'Ders içi tartışma ve etkinliklere hevesli katılım', points: 15 },
  { id: 'b_fikir', name: 'Yaratıcı Fikir', icon: '💡', desc: 'Özgün düşünce ve yaratıcı kompozisyon', points: 15 },
  { id: 'b_davranis', name: 'Örnek Davranış', icon: '🤝', desc: 'Sınıf içi nezaket ve arkadaşlarına yardım', points: 15 },
  { id: 'b_siir', name: 'Şiir Sevdalısı', icon: '📜', desc: 'Şiir okuma, ezberleme ve ahenk yeteneği', points: 15 },
  { id: 'b_kelime', name: 'Kelime Avcısı', icon: '🔍', desc: 'Zengin sözcük dağarcığı ve deyim kullanımı', points: 15 },
  { id: 'b_hitabet', name: 'Hitabet Ustası', icon: '🎙️', desc: 'Etkili Türkçe konuşma ve sunum becerisi', points: 15 }
];

// ---- ÖĞRENCİ VE SINIF VERİ YÖNETİMİ (Sınıfım Modülü) ----
const StudentStore = {
  STORAGE_KEY: 'students',
  SEEDED_KEY: 'students_seeded_v1',
  CLASSES_KEY: 'classes',
  BADGES_KEY: 'custom_badges',

  _key(base) {
    const u = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;
    if (!u || (typeof AuthStore !== 'undefined' && AuthStore.isAdmin && AuthStore.isAdmin(u))) return base;
    return `${base}_${u.id}`;
  },

  getAvailableBadges() {
    const custom = DB.get(this._key(this.BADGES_KEY)) || [];
    return [...DEFAULT_BADGES, ...custom];
  },

  addCustomBadge(badge) {
    const key = this._key(this.BADGES_KEY);
    const list = DB.get(key) || [];
    const newBadge = {
      id: generateId(),
      name: (badge.name || '').trim(),
      icon: (badge.icon || '🏅').trim(),
      desc: (badge.desc || '').trim(),
      points: parseInt(badge.points) || 15,
      isCustom: true,
      createdAt: new Date().toISOString()
    };
    list.push(newBadge);
    DB.set(key, list);
    return newBadge;
  },

  deleteCustomBadge(badgeId) {
    const key = this._key(this.BADGES_KEY);
    let list = DB.get(key) || [];
    list = list.filter(b => b.id !== badgeId);
    DB.set(key, list);
    return list;
  },

  getClasses() {
    return DB.get(this._key(this.CLASSES_KEY)) || ['5-A', '6-B', '7-A', '8-A'];
  },

  addClass(className) {
    const key = this._key(this.CLASSES_KEY);
    const list = this.getClasses();
    if (!list.includes(className)) {
      list.push(className);
      DB.set(key, list);
    }
  },

  getAll() {
    const storageKey = this._key(this.STORAGE_KEY);
    const seededKey = this._key(this.SEEDED_KEY);
    const currentUser = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;
    const isPrimaryUser = !currentUser || (typeof AuthStore !== 'undefined' && AuthStore.isAdmin && AuthStore.isAdmin(currentUser));
    let list = DB.get(storageKey);
    const seeded = DB.get(seededKey);
    if (!Array.isArray(list)) {
      if (!seeded && isPrimaryUser) {
        list = getSeedStudents();
        DB.set(storageKey, list);
        DB.set(seededKey, true);
      } else {
        list = [];
        DB.set(storageKey, list);
        DB.set(seededKey, true);
      }
    } else if (!seeded) {
      DB.set(seededKey, true);
    }
    return list;
  },

  restoreDemoStudents() {
    const list = getSeedStudents();
    DB.set(this._key(this.STORAGE_KEY), list);
    DB.set(this._key(this.SEEDED_KEY), true);
    return list;
  },

  getById(id) {
    return this.getAll().find(s => s.id === id) || null;
  },

  save(student) {
    const storageKey = this._key(this.STORAGE_KEY);
    const seededKey = this._key(this.SEEDED_KEY);
    const list = this.getAll();
    const idx = list.findIndex(s => s.id === student.id);
    if (idx >= 0) list[idx] = student;
    else list.unshift(student);
    DB.set(storageKey, list);
    DB.set(seededKey, true);
    return student;
  },

  delete(id) {
    const storageKey = this._key(this.STORAGE_KEY);
    const seededKey = this._key(this.SEEDED_KEY);
    const list = this.getAll().filter(s => s.id !== id);
    DB.set(seededKey, true);
    DB.set(storageKey, list);
    return list;
  },

  deleteByClass(className) {
    const storageKey = this._key(this.STORAGE_KEY);
    const seededKey = this._key(this.SEEDED_KEY);
    const list = this.getAll().filter(s => s.className !== className);
    DB.set(seededKey, true);
    DB.set(storageKey, list);
    return list;
  },

  clearAll() {
    DB.set(this._key(this.SEEDED_KEY), true);
    DB.set(this._key(this.STORAGE_KEY), []);
    return [];
  },

  deleteNote(studentId, noteId) {
    const student = this.getById(studentId);
    if (!student || !Array.isArray(student.notes)) return null;
    student.notes = student.notes.filter(n => n.id !== noteId);
    this.save(student);
    return student;
  },

  deleteBadge(studentId, badgeId) {
    const student = this.getById(studentId);
    if (!student || !Array.isArray(student.badges)) return null;
    student.badges = student.badges.filter(b => b.id !== badgeId);
    this.save(student);
    return student;
  },

  addPoint(studentId, delta, reason = '') {
    const student = this.getById(studentId);
    if (!student) return null;
    student.points = (student.points || 0) + delta;
    if (!student.history) student.history = [];
    student.history.unshift({
      id: generateId(),
      type: delta >= 0 ? 'plus' : 'minus',
      amount: delta,
      reason: reason || (delta >= 0 ? 'Derse Katılım Puanı' : 'Puan Düzenlemesi'),
      date: new Date().toISOString()
    });
    this.save(student);
    return student;
  },

  addPoints(studentId, delta, reason = '') {
    return this.addPoint(studentId, delta, reason);
  },

  addBadge(studentId, badgeObjOrName, maybeIcon = '🏅', customPoints = 15) {
    const student = this.getById(studentId);
    if (!student) return null;
    if (!student.badges) student.badges = [];

    const badgeName = typeof badgeObjOrName === 'object' ? badgeObjOrName.name : badgeObjOrName;
    const badgeIcon = typeof badgeObjOrName === 'object' ? (badgeObjOrName.icon || '🏅') : maybeIcon;
    const pointsAwarded = typeof badgeObjOrName === 'object' && badgeObjOrName.points ? badgeObjOrName.points : customPoints;

    student.badges.push({
      id: generateId(),
      name: badgeName,
      icon: badgeIcon,
      date: new Date().toISOString()
    });
    student.points = (student.points || 0) + pointsAwarded;
    if (!student.history) student.history = [];
    student.history.unshift({
      id: generateId(),
      type: 'badge',
      amount: pointsAwarded,
      reason: `"${badgeName}" rozeti kazanıldı`,
      date: new Date().toISOString()
    });
    this.save(student);
    return student;
  },

  addNote(studentId, noteText) {
    const student = this.getById(studentId);
    if (!student) return null;
    if (!student.notes) student.notes = [];
    student.notes.unshift({
      id: generateId(),
      text: noteText,
      date: new Date().toISOString()
    });
    this.save(student);
    return student;
  }
};

// ---- YARDIMCI FONKSİYONLAR ----
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} gün önce`;
  return formatDate(isoString);
}

function typeLabel(type) {
  const labels = {
    minideneme:   '📝 Mini Deneme',
    quiz:         '📝 Mini Deneme',
    presentation: '📊 Sunum',
    blank:        '✏️ Boşluk Doldurma',
    wheel:        '🎡 Çarkıfelek',
    matching:     '🔗 Kelime Eşleştirme',
    flashcard:    '🃏 Hafıza Kartları',
    parolla:      '🔤 Parolla (Alfabe Çarkı)',
    sezdirme:     '🔍 Sezdirme Dersi'
  };
  return labels[type] || type;
}

function typeIcon(type) {
  const icons = {
    minideneme: '📝', quiz: '📝', presentation: '📊', blank: '✏️',
    wheel: '🎡', matching: '🔗', flashcard: '🃏', parolla: '🔤', sezdirme: '🔍'
  };
  return icons[type] || '📄';
}

function typeColor(type) {
  const colors = {
    minideneme: '#6C63FF', quiz: '#6C63FF', presentation: '#43C6AC',
    blank: '#FFB347', wheel: '#FF6584',
    matching: '#9B59B6', flashcard: '#3498DB', parolla: '#E67E22', sezdirme: '#0D9488'
  };
  return colors[type] || '#6C63FF';
}

// ---- HTML KAÇIŞ YARDIMCISI VE HTTPS DÖNÜŞTÜRÜCÜ ----
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ensureHttpsUrl(url) {
  if (typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!trimmed || /^(?:data|blob|mailto|tel):/i.test(trimmed)) return url;
  if (/^http:\/\/(?!localhost\b|127\.0\.0\.1\b)/i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  return url;
}

function _upgradeActivityUrlsToHttps(value) {
  if (typeof value === 'string') {
    if (!value || /^(?:data|blob|mailto|tel):/i.test(value)) return value;
    if (/^http:\/\/(?!localhost\b|127\.0\.0\.1\b)/i.test(value)) {
      return value.replace(/^http:\/\//i, 'https://');
    }
    return value.replace(/\bhttp:\/\/(?!localhost\b|127\.0\.0\.1\b)/gi, 'https://');
  }
  if (Array.isArray(value)) {
    return value.map(item => _upgradeActivityUrlsToHttps(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(k => {
      out[k] = _upgradeActivityUrlsToHttps(value[k]);
    });
    return out;
  }
  return value;
}

// ============================================================
// SEZDİRME YÖNTEMİ (Tümevarım / Keşfettirerek Öğretim)
// Kural doğrudan verilmez; öğrenci örneklerden yola çıkarak kuralı kendisi bulur.
// ============================================================
const SEZDIRME_STAGES = {
  dedektif:    { label: 'Dedektiflik Vakası',   icon: '🕵️', color: '#0F172A', desc: 'Telsiz diyaloğu, ipuçları ve şüpheli eleme ile dil kuralının işlevini sezdirme' },
  hazirlik:    { label: 'Merak Uyandırma',      icon: '💭', color: '#8B5CF6', desc: 'Konunun adını söylemeden dikkat çeken bir durum, hikâye ya da soru' },
  gozlem:      { label: 'Gözlem',               icon: '👀', color: '#0EA5E9', desc: 'Kuralın gizlendiği örnek cümleler; dikkat çekilecek yerler sonradan vurgulanır' },
  karsilastir: { label: 'Karşılaştırma',        icon: '⚖️', color: '#F59E0B', desc: 'İki örnek grubu yan yana; aradaki farkı öğrenci bulur' },
  soru:        { label: 'Yönlendirici Sorular', icon: '❓', color: '#EC4899', desc: 'Öğrenciyi adım adım kurala götüren sorular, ipuçları ve beklenen cevaplar' },
  siniflandir: { label: 'Sınıflandırma',        icon: '🧩', color: '#10B981', desc: 'Öğrenci örnekleri gruplara ayırır; grup adları en sonda açılır' },
  cikarim:     { label: 'Çıkarım',              icon: '✍️', color: '#6366F1', desc: 'Öğrenciler kuralı kendi cümleleriyle yazar, sınıf panosunda toplanır' },
  kural:       { label: 'Kuralın Keşfi',        icon: '💡', color: '#CA8A04', desc: 'Kural en sonda açılır ve sınıfın tahminleriyle karşılaştırılır' },
  uygulama:    { label: 'Pekiştirme',           icon: '🎯', color: '#EF4444', desc: 'Keşfedilen kuralı yeni örneklere uygulama' }
};

function createSezdirmeStep(type) {
  const base = { id: generateId(), type, title: SEZDIRME_STAGES[type]?.label || 'Adım', note: '' };
  switch (type) {
    case 'dedektif':
      return {
        ...base,
        title: 'Dedektiflik Vakası: Telsiz Hattı ve Şüpheliler',
        caseBrief: 'Sahadaki dedektif telsizle merkeze bilgi veriyor ancak bazı sözcükleri ya da kuralları kullanmadığı için iletişim kopuyor. Mesajları sırayla açıp eksik olan dil unsurunu keşfedelim!',
        dialogues: [
          {
            speaker: 'dedektif',
            speakerName: 'Sahadaki Memur',
            text: 'Alo merkez! Şüpheli az önce [şeye] bindi ve [oraya] doğru kaçıyor!',
            clueNote: 'Burada varlığın adı yerine belirsiz sözcükler kullanıldığı için iletişim kurulamıyor.'
          },
          {
            speaker: 'merkez',
            speakerName: 'Merkez Komiseri',
            text: 'Neye bindi, nereye kaçıyor? Daha net konuş, seni anlamıyorum!',
            clueNote: ''
          },
          {
            speaker: 'dedektif',
            speakerName: 'Sahadaki Memur',
            text: 'Pardon şefim! Şüpheli [kırmızı] ve [hızlı] bir [arabaya] bindi. Üzerinde [mavi şapka] var.',
            clueNote: 'Somut adlar ve ayırt edici özellikler eklenince merkez harekete geçebildi.'
          },
          {
            speaker: 'merkez',
            speakerName: 'Merkez Komiseri',
            text: 'Anlaşıldı! Şimdi eşkâli tarayıp doğru şüpheliyi yakalıyoruz.',
            clueNote: 'Şimdi aşağıdan eşkâle uymayanları eleyip doğru şüpheliyi seçin.'
          }
        ],
        suspects: [
          { name: '1. Şüpheli', avatar: '🧢', traits: 'Mavi şapkalı, kırmızı arabanın sürücüsü', isCulprit: true },
          { name: '2. Şüpheli', avatar: '🕶️', traits: 'Siyah şapkalı, kırmızı arabanın sürücüsü', isCulprit: false },
          { name: '3. Şüpheli', avatar: '👒', traits: 'Mavi şapkalı, beyaz minibüste', isCulprit: false },
          { name: '4. Şüpheli', avatar: '🎩', traits: 'Yeşil şapkalı, motosikletli', isCulprit: false }
        ],
        question: 'Dedektif ilk mesajlarında neden merkeze derdini anlatamadı? Vaka sonunda iletişimi netleştiren sözcüklerin ortak özelliği nedir?',
        image: ''
      };
    case 'hazirlik':
      return { ...base, title: 'Merak Kapısı', content: 'Öğrencilerin ilgisini çekecek bir durum, hikâye ya da günlük hayattan bir örnek yazın. Konunun adını söylemeyin.', question: 'Sınıfa yönelteceğiniz düşündürücü soru...', image: '' };
    case 'gozlem':
      return { ...base, title: 'Cümleleri İnceleyelim', instruction: 'Aşağıdaki cümleleri dikkatle okuyun. Ortak bir şey fark ediyor musunuz?', examples: ['Dikkat çekilecek sözcüğü [köşeli parantez] içine yazın.', 'İkinci örnek [cümle] buraya.'], image: '' };
    case 'karsilastir':
      return { ...base, title: 'İki Grubu Karşılaştıralım', instruction: 'İki gruptaki cümleler arasında nasıl bir fark var?', groupA: { title: 'A Grubu', items: ['Birinci grup örneği'] }, groupB: { title: 'B Grubu', items: ['İkinci grup [örneği]'] }, question: 'Bu iki grubu birbirinden ayıran özellik nedir?' };
    case 'soru':
      return { ...base, title: 'Düşünelim, Bulalım', questions: [{ q: 'Öğrenciyi kurala yaklaştıran ilk soru...', hint: 'İpucu...', answer: 'Beklenen cevap...' }] };
    case 'siniflandir':
      return { ...base, title: 'Gruplara Ayıralım', instruction: 'Sözcükleri benzerliklerine göre gruplara ayırın. Grup adlarını sonra birlikte bulacağız!', hideNames: true, categories: ['1. özellik', '2. özellik'], items: [{ text: 'örnek 1', c: 0 }, { text: 'örnek 2', c: 1 }] };
    case 'cikarim':
      return { ...base, title: 'Kuralı Siz Bulun!', prompt: 'Gördüğünüz örneklerden yola çıkarak kendi kuralınızı yazın.', placeholder: 'Bence kural şu: ...' };
    case 'kural':
      return { ...base, title: 'Birlikte Bulduğumuz Kural', rule: 'Öğrencilerin keşfettiği kuralın son hâli buraya yazılır.', image: '' };
    case 'uygulama':
      return { ...base, title: 'Kuralı Uygulayalım', items: [{ q: 'Yeni bir örnek üzerinde soru...', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: '' }] };
    default:
      return base;
  }
}

// Dedektiflik tarzı sezdirme ders akışı şablon üreticisi
function createDetectiveSezdirmeSteps(preset = 'soyguncu') {
  if (preset === 'soyguncu') {
    return [
      {
        id: generateId(),
        type: 'dedektif',
        title: 'Telsiz Operasyonu: Soyguncu Neye Bindi?',
        caseBrief: 'Banka soygununun ardından sahadaki memur heyecanla merkeze telsiz geçiyor. Telsiz mesajlarını sırayla açın ve merkezdeki dedektifin soyguncuyu nasıl yakalayabildiğini keşfedin!',
        dialogues: [
          { speaker: 'dedektif', speakerName: 'Sahadaki Memur', text: 'Alo merkez! Soyguncu [şeye] bindi. Çabuk [şeyi] takip edin. Eee [şeye] doğru gidiyorlar.', clueNote: 'Hiçbir varlık ve yer adı verilmediği için "neyi, nereyi" takip edeceğimiz anlaşılmıyor!' },
          { speaker: 'merkez', speakerName: 'Merkez Dedektifi', text: 'Soyguncu neye bindi? Daha net konuş. Dediklerini anlamıyorum.', clueNote: '' },
          { speaker: 'dedektif', speakerName: 'Sahadaki Memur', text: 'Kusura bakmayın. Soyguncu [arabaya] bindi. [Manavgat’a] doğru gidiyorlar.', clueNote: 'Varlık adı (araba) ve yer adı (Manavgat) iletişimdeki ilk düğümü çözdü.' },
          { speaker: 'merkez', speakerName: 'Merkez Dedektifi', text: 'Burada bir sürü araba var. Hangisine bindi?', clueNote: 'Yalnızca isim yeterli olmadı; o aracı diğerlerinden ayıracak özellikler gerekiyor!' },
          { speaker: 'dedektif', speakerName: 'Sahadaki Memur', text: 'Şüpheli [kırmızı] ve [lüks] bir arabaya bindi.', clueNote: '"Kırmızı" ve "lüks" özellikleri arabayı diğer tüm arabalardan ayırdı.' },
          { speaker: 'merkez', speakerName: 'Merkez Dedektifi', text: 'Tarif ettiğin arabayı durdurduk.', clueNote: '' },
          { speaker: 'dedektif', speakerName: 'Sahadaki Memur', text: 'Tamam, [şeyi şey etmeyi] unutmayın.', clueNote: 'Varlık ve eylem yerine yine "şey" deyince işler tekrar karıştı!' },
          { speaker: 'merkez', speakerName: 'Merkez Dedektifi', text: 'Neyi ne yapmayı???', clueNote: '' },
          { speaker: 'dedektif', speakerName: 'Sahadaki Memur', text: '[Soyguncuyu yakalamayı] unutmayın efendim.', clueNote: '' },
          { speaker: 'merkez', speakerName: 'Merkez Dedektifi', text: 'Arabadan dört kişi çıktı. Bana soyguncu olandan bahset.', clueNote: '' },
          { speaker: 'dedektif', speakerName: 'Sahadaki Memur', text: 'Soyguncu işte.', clueNote: '' },
          { speaker: 'merkez', speakerName: 'Merkez Dedektifi', text: 'Bunların hangisi soyguncu ben nereden bilebilirim? Tarif et şüpheliyi.', clueNote: '4 kişi arasından soyguncuyu bulmak için hem eşya adları hem de renk/durum özellikleri lazım!' },
          { speaker: 'dedektif', speakerName: 'Sahadaki Memur', text: 'Tamam. Soyguncumuzda [lacivert bir şey] var. Ayrıca [şeyleri] bembeyaz ve [yeşil bir şeye] sahip.', clueNote: 'Özellikler var ama varlıkların adı ("maske, saç, gömlek") söylenmeden eşkâl eksik kalıyor.' },
          { speaker: 'merkez', speakerName: 'Merkez Dedektifi', text: 'Neye sahip neye?', clueNote: '' },
          { speaker: 'dedektif', speakerName: 'Sahadaki Memur', text: '[Lacivert] bir [maskeye] sahip. [Saçları] da bembeyaz. Yeşil [gömleği] var.', clueNote: 'İsim + özellik belirten sözcükler birleşince eşkâl tamamen netleşti!' },
          { speaker: 'merkez', speakerName: 'Merkez Dedektifi', text: 'Teşekkürler dedektif! Şüpheliyi yakaladık!', clueNote: 'Harika! Şimdi aşağıdaki 4 şüpheli arasından eşkâle uymayanları eleyip gerçek soyguncuyu yakalayın!' }
        ],
        suspects: [
          { name: 'Şüpheli A', avatar: '🕶️', traits: 'Siyah maskeli, saçları bembeyaz, yeşil gömlekli', isCulprit: false },
          { name: 'Şüpheli B', avatar: '🎭', traits: 'Lacivert maskeli, saçları bembeyaz, yeşil gömlekli', isCulprit: true },
          { name: 'Şüpheli C', avatar: '🧢', traits: 'Lacivert maskeli, saçları simsiyah, yeşil gömlekli', isCulprit: false },
          { name: 'Şüpheli D', avatar: '🧥', traits: 'Lacivert maskeli, saçları bembeyaz, sarı gömlekli', isCulprit: false }
        ],
        question: 'İlk telsiz çağrısında memurun "şey" dediği yerlere hangi sözcükleri koyduğumuzda soyguncuyu yakalayabildik?',
        image: '',
        note: 'Mesajları tek tek tıklayarak sınıfça sesli okuyun. Öğrenciler "şey" kelimesi yüzünden komik ve anlamsız durumlar oluştuğunu güle oynaya fark edecektir. Bu aşamada henüz "isim" veya "sıfat" demeyin.'
      },
      {
        id: generateId(),
        type: 'karsilastir',
        title: 'İki Telsiz Kaydını Karşılaştıralım',
        instruction: 'İlk telsiz mesajları ile çözülen mesajları yan yana inceleyin. Neler değişti?',
        groupA: {
          title: '❌ Başarısız Telsiz Çağrısı',
          items: ['Soyguncu [şeye] bindi.', 'Soyguncuda [lacivert bir şey] var.', '[Şeyleri] bembeyaz.', 'Araba işte!']
        },
        groupB: {
          title: '✅ Başarılı Operasyon Çağrısı',
          items: ['Soyguncu [arabaya] bindi.', 'Soyguncuda [lacivert] bir [maske] var.', '[Saçları] bembeyaz.', '[Kırmızı] ve [lüks] araba!']
        },
        question: '"Araba, maske, saç" sözcükleriyle "kırmızı, lüks, lacivert, bembeyaz" sözcüklerinin cümledeki görevleri aynı mıdır?',
        note: 'Öğrencilerin iki ayrı sözcük grubunun varlığını fark etmesini sağlayın: 1) Varlığın kendisinin adı, 2) Varlığın özelliğini tarif eden sözcük.'
      },
      {
        id: generateId(),
        type: 'gozlem',
        title: 'Delil Cümlelerini İnceleyelim',
        instruction: 'Olay yerindeki cümleleri inceleyin. Varlıkları ve onları tarif eden özellikleri bulabilir misiniz?',
        examples: [
          'Polis [kırmızı] [arabanın] önünü kesti.',
          '[Manavgat] yolunda hızlı bir [takip] başladı.',
          'Şüphelinin yüzünde [lacivert] bir [maske] vardı.',
          'Tanıklar [uzun] boylu, [beyaz] [saçlı] birini gördü.',
          'Dedektif [gizli] [ipuçlarını] not defterine yazdı.'
        ],
        image: '',
        note: 'Önce vurguları açmadan öğrencilere sorun: "Hangi sözcük tek başına bir varlığı karşılıyor, hangi sözcük o varlığı diğerlerinden ayırıyor?"'
      },
      {
        id: generateId(),
        type: 'soru',
        title: 'Dedektif Sorgusu: Kurala Doğru',
        questions: [
          { q: 'Telsizde "araba, maske, saç, gömlek" olmasaydı "kırmızı, lacivert, bembeyaz" sözcükleri tek başına neye ait olduğunu anlatabilir miydi?', hint: '"Lacivert bir şey" dediğimizde ne anladık?', answer: 'Anlatamazdı! Önce varlıkların bir "adı" olması gerekir ki neyden söz ettiğimizi bilelim.' },
          { q: 'Peki sadece "Arabaya bindi" ve "Adam işte" dediğimizde neden otoparktaki onlarca araç ve 4 kişi arasından seçim yapamadık?', hint: 'Aynı türden birçok varlık varsa ne yapmamız gerekir?', answer: 'Varlıkları tek tek ayırt etmek için renk, biçim, durum bildiren niteleyici sözcüklere ihtiyacımız vardır.' },
          { q: '"Kırmızı araba" ve "lacivert maske" ifadelerinde hangi sözcük varlığın kendisi, hangisi o varlığın özelliğidir?', hint: 'Nasıl araba? Nasıl maske?', answer: '"Araba, maske" varlığın adı (isim); "kırmızı, lacivert" ise onların özelliğini bildiren sözcüktür (sıfat).' }
        ],
        note: 'Soruları tek tek açın ve öğrencilerin kendi kelimeleriyle yanıtlamasına izin verin.'
      },
      {
        id: generateId(),
        type: 'siniflandir',
        title: 'Delilleri İki Dosyaya Ayıralım',
        instruction: 'Telsiz kayıtlarından çıkan delilleri görevlerine göre iki dosyaya ayırın. Dosya adlarını sonra birlikte bulacağız!',
        hideNames: true,
        categories: ['Varlığın Adı (İsim)', 'Varlığı Niteleyen Özellik (Sıfat)'],
        items: [
          { text: 'araba', c: 0 },
          { text: 'kırmızı', c: 1 },
          { text: 'maske', c: 0 },
          { text: 'lacivert', c: 1 },
          { text: 'gömlek', c: 0 },
          { text: 'yeşil', c: 1 },
          { text: 'saç', c: 0 },
          { text: 'lüks', c: 1 }
        ],
        note: 'Tüm kartlar doğru yerleşince sınıfça grup adlarını açın.'
      },
      {
        id: generateId(),
        type: 'cikarim',
        title: 'Dedektif Raporunu Yaz!',
        prompt: 'Bu operasyondan yola çıkarak iletişimin net olması için gereken bu iki sözcük türünün görevini kendi cümlelerinle açıkla.',
        placeholder: 'Bence varlıkları karşılayan sözcükler ..., onları tarif eden sözcükler ise ...',
        note: 'Öğrencilerin ürettiği yaratıcı tanımları tahmin panosuna ekleyin.'
      },
      {
        id: generateId(),
        type: 'kural',
        title: 'Dosya Çözüldü: Birlikte Bulduğumuz Kural',
        rule: '1. İSİM (AD): Canlı veya cansız bütün varlıkları, yerleri ve kavramları karşılayan sözcüklerdir. İsimler kullanılmadan ("şey" denilerek) neyin anlatıldığı anlaşılmaz. (Örn: araba, Manavgat, maske, saç)\n\n2. NİTELEME SIFATI (ÖN AD): İsimlerin önüne gelerek onların rengini, biçimini ve durumunu belirtip diğerlerinden ayırt edilmesini sağlar; isme sorulan "Nasıl?" sorusuna yanıt verir. (Örn: kırmızı araba, lacivert maske, beyaz saç)',
        image: '',
        note: 'Kural perdesini sınıfın raporlarıyla karşılaştırın ve en yakın tahmini yıldızlayın.'
      },
      {
        id: generateId(),
        type: 'uygulama',
        title: 'Final Operasyonu: Pekiştirme',
        items: [
          { q: 'Telsizdeki "Şüpheli lüks ve kırmızı bir arabaya bindi." cümlesinde varlığı diğer araçlardan ayırt eden (sıfat) sözcükler hangileridir?', options: ['şüpheli - bindi', 'lüks - kırmızı', 'bir - arabaya', 'binen - kaçtı'], correct: 1, explanation: '"Nasıl araba?" sorusunun cevabı olan "lüks" ve "kırmızı" sözcükleri sıfattır.' },
          { q: 'Aşağıdaki telsiz mesajlarının hangisinde eşkâli netleştiren hiçbir sıfat kullanılmamıştır?', options: ['Mavi şapkalı kişi kapıdan çıktı.', 'Geniş caddede beyaz kamyon durdu.', 'Soyguncu masadaki çantayı alıp kaçtı.', 'Şüpheli eski ve kırık kapıdan girdi.'], correct: 2, explanation: '"Soyguncu masadaki çantayı alıp kaçtı." ifadesinde rengini/durumunu bildiren niteleme sıfatı yerine işaret/bulunma (-deki) ve yalın isimler vardır; diğer şıklarda mavi, geniş, beyaz, eski, kırık sıfatları bulunur.' },
          { q: '"Dedektif ... bir not defteri buldu." Boşluğa varlığı tarif eden bir sıfat getirirsek hangisi olur?', options: ['hemen', 'yıpranmış', 'burada', 'yazdı'], correct: 1, explanation: '"Nasıl not defteri?" → yıpranmış not defteri.' }
        ],
        note: ''
      }
    ];
  }

  // Her Türkçe konusuna uyarlanabilir Dedektiflik Tarzı Sezdirme Şablonu
  return [
    {
      id: generateId(),
      type: 'dedektif',
      title: 'Dedektiflik Vakası: Şifreli Telsiz Mesajı',
      caseBrief: 'Olay yerindeki iletişimi aksatan dil/yazım hatasını veya eksik dil unsurunu adım adım ortaya çıkaralım.',
      dialogues: [
        { speaker: 'dedektif', speakerName: 'Sahadaki Dedektif', text: 'Alo merkez! Şüpheli ilk ipucunu [buraya] bıraktı ama cümle biraz karışık görünüyor.', clueNote: 'Öğrencilerin dikkatini çekecek ilk sorunlu noktayı [köşeli parantez] içine yazın.' },
        { speaker: 'merkez', speakerName: 'Merkez Komiseri', text: 'Mesajın net değil dedektif! Tam olarak ne demek istiyorsun?', clueNote: '' },
        { speaker: 'dedektif', speakerName: 'Sahadaki Dedektif', text: 'Şimdi inceledim efendim: Asıl ipucu [çözümlenmiş ifade] içindeymiş!', clueNote: 'Doğru kullanım geldiğinde anlamın nasıl düzeldiğini fark ettirin.' },
        { speaker: 'merkez', speakerName: 'Merkez Komiseri', text: 'Harika! Eldeki ipuçlarıyla aşağıdan doğru şüpheliyi yakalayalım.', clueNote: '' }
      ],
      suspects: [
        { name: '1. Şüpheli', avatar: '🕵️', traits: 'Birinci ipucu özelliğini buraya yazın', isCulprit: false },
        { name: '2. Şüpheli', avatar: '🎭', traits: 'Doğru eşkâl özelliklerini buraya yazın', isCulprit: true },
        { name: '3. Şüpheli', avatar: '🎩', traits: 'Çeldirici eşkâl özelliğini buraya yazın', isCulprit: false },
        { name: '4. Şüpheli', avatar: '🕶️', traits: 'Çeldirici eşkâl özelliğini buraya yazın', isCulprit: false }
      ],
      question: 'İletişimdeki karışıklık neden kaynaklandı ve hangi değişiklik sorunu çözdü?',
      image: '',
      note: 'Telsiz satırlarını konunuza (noktalama işareti eksikliği, de/da karmaşası, fiilimsiler vb.) göre uyarlayın.'
    },
    createSezdirmeStep('karsilastir'),
    createSezdirmeStep('gozlem'),
    createSezdirmeStep('soru'),
    createSezdirmeStep('siniflandir'),
    createSezdirmeStep('cikarim'),
    createSezdirmeStep('kural'),
    createSezdirmeStep('uygulama')
  ];
}

// [köşeli parantez] içindeki bölümleri vurgulanabilir parçaya dönüştürür
function renderSezdirmeMarks(text, revealed) {
  return escHtml(text).replace(/\[([^\]]+)\]/g, (m, w) => `<span class="sz-mark${revealed ? ' revealed' : ''}">${w}</span>`);
}

// ---- BİLDİRİM (TOST) ----
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ---- AÇILIR PENCERE (MODAL) ----
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// ---- SEKMELİ YAPI ----
function initTabs(containerSelector) {
  document.querySelectorAll(containerSelector || '.tabs-container').forEach(container => {
    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        container.querySelector(`[data-tab-panel="${target}"]`)?.classList.add('active');
      });
    });
  });
}

// ---- KONFETİ ----
function launchConfetti() {
  const colors = ['#6C63FF', '#FF6584', '#43C6AC', '#FFB347', '#9B59B6'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.style.cssText = `
      position:fixed; top:-10px; left:${Math.random() * 100}vw;
      width:${6 + Math.random() * 8}px; height:${6 + Math.random() * 8}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      border-radius:${Math.random() > .5 ? '50%' : '2px'};
      z-index:9999; pointer-events:none;
      animation:confettiFall ${1.5 + Math.random() * 2}s ease-in forwards;
      animation-delay:${Math.random() * .5}s;
      transform:rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

// CSS animasyonu
if (!document.getElementById('confettiStyles')) {
  const style = document.createElement('style');
  style.id = 'confettiStyles';
  style.textContent = `
    @keyframes confettiFall {
      0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(105vh) rotate(720deg); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// ---- GÖRSEL OPTİMİZASYONU (Canvas ile sıkıştırma) ----
async function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---- BÜYÜK GÖRSEL GÖRÜNTÜLEYİCİ (LIGHTBOX) ----
function openLightbox(imgSrc) {
  let modal = document.getElementById('globalLightboxModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'globalLightboxModal';
    modal.className = 'lightbox-modal';
    modal.innerHTML = `
      <div style="position:relative; max-width:90vw; max-height:90vh;">
        <button style="position:absolute; top:-16px; right:-16px; width:36px; height:36px; border-radius:50%; background:#fff; border:none; font-weight:900; font-size:1.1rem; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.4);" onclick="closeLightbox()">✕</button>
        <img id="globalLightboxImg" class="lightbox-img" src="" alt="Büyük Görsel" />
      </div>
    `;
    modal.addEventListener('click', e => {
      if (e.target === modal) closeLightbox();
    });
    document.body.appendChild(modal);
  }
  document.getElementById('globalLightboxImg').src = ensureHttpsUrl(imgSrc);
  modal.classList.add('active');
}

function closeLightbox() {
  document.getElementById('globalLightboxModal')?.classList.remove('active');
}

// ---- TÜRKİYE YÜZYILI MAARİF MODELİ (2026) TÜRKÇE MÜFREDATI ÖRNEK VERİLERİ (5-8. SINIFLAR) ----
function getSeedActivities() {
  return [
    ...getSezdirmeSeeds(),
    // ==========================================
    // 5. SINIF ETKİNLİKLERİ (4 ADET)
    // ==========================================
    {
      id: 'demo_5_minideneme',
      type: 'minideneme',
      grade: '5',
      theme: 'Duygularımı Tanıyorum',
      outcome: 'DYS.DO.5.1 / T.O.5.1',
      title: '5. Sınıf Sözcükte Anlam ve Sıfatlar Denemesi',
      description: 'Gerçek-mecaz anlam ayrımı, niteleme ve belirtme sıfatları kazanım testi',
      code: '5DEN01',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      playCount: 24,
      settings: { timePerQuestion: 40, showFeedback: true },
      questions: [
        {
          id: 'q5_1',
          text: '"Tatlı" sözcüğü aşağıdaki cümlelerin hangisinde mecaz anlamda kullanılmıştır?',
          options: [
            'Piknikte yediğimiz karpuz çok tatlıydı.',
            'Bebek öyle tatlı gülümsüyordu ki herkes ona baktı.',
            'Çayına iki tatlı kaşığı şeker attı.',
            'Manavdan en tatlı elmalardan iki kilo aldık.'
          ],
          correct: 1,
          explanation: '"Tatlı gülümsüyordu" ifadesinde tatlı sözcüğü damakta tat bırakan değil, sevimli/hoş anlamında mecazdır.'
        },
        {
          id: 'q5_2',
          text: '"Kırmızı yanaklı, neşeli çocuk parkta koşuyordu." cümlesindeki niteleme sıfatları hangi sorunun cevabıdır?',
          options: [
            'Kaç çocuk?',
            'Hangi çocuk?',
            'Nasıl çocuk?',
            'Neredeki çocuk?'
          ],
          correct: 2,
          explanation: 'Varlıkların rengini, şeklini ve durumunu bildiren niteleme sıfatları isme sorulan "Nasıl?" sorusuyla bulunur.'
        },
        {
          id: 'q5_3',
          text: 'Aşağıdaki cümlelerin hangisinde bir işaret sıfatı kullanılmıştır?',
          options: [
            'Bu kitap bana dedemden armağandır.',
            'Üçüncü sıradaki öğrenci tahtaya kalktı.',
            'Birkaç arkadaş bahçede oyun oynuyor.',
            'Hangi soruda takıldın?'
          ],
          correct: 0,
          explanation: '"Bu kitap" tamlamasında "bu" sözcüğü ismi işaret yoluyla belirttiği için işaret sıfatıdır.'
        },
        {
          id: 'q5_4',
          text: '"Göz boyamak" deyiminin anlamı aşağıdakilerden hangisidir?',
          options: [
            'Güzel resimler yapmak',
            'Birini yanıltmak veya eksiklikleri gösterişle gizlemek',
            'Gözlerini bir noktaya dikip bakmak',
            'Çok dikkatli ve titiz davranmak'
          ],
          correct: 1,
          explanation: '"Göz boyamak", bir şeyi kusursuz veya olduğundan iyi göstererek kandırmak anlamında bir deyimdir.'
        },
        {
          id: 'q5_5',
          text: 'Aşağıdaki cümlelerin hangisinde bir karşılaştırma (benzerlik veya üstünlük) yapılmıştır?',
          options: [
            'Bugün hava dünkünden daha sıcaktı.',
            'Sabah erkenden kalkıp kahvaltısını yaptı.',
            'Ders zili çalınca sınıfa doğru yürüdüler.',
            'Kardeşim resim yapmayı çok sever.'
          ],
          correct: 0,
          explanation: '"dünkünden daha sıcak" ifadesinde iki günün hava sıcaklığı "daha" belirteciyle karşılaştırılmıştır.'
        }
      ]
    },
    {
      id: 'demo_5_blank',
      type: 'blank',
      grade: '5',
      theme: 'Oyun Dünyası',
      outcome: 'T.O.5.20',
      title: '5. Sınıf Oyun Dünyası: Cümlede Anlam İlişkileri',
      description: 'Amaç-sonuç, neden-sonuç ve koşul-sonuç cümlelerindeki kilit bağlaçları doldurun',
      code: '5BOS01',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 19,
      settings: { showHint: true },
      questions: [
        {
          id: 'b5_1',
          rawText: 'Geleneksel sokak oyunlarını öğrenmek [amacıyla] dedemle uzun bir söyleşi yaptım.',
          parts: [
            { type: 'text', value: 'Geleneksel sokak oyunlarını öğrenmek ' },
            { type: 'blank', answer: 'amacıyla', hint: 'a...' },
            { type: 'text', value: ' dedemle uzun bir söyleşi yaptım.' }
          ]
        },
        {
          id: 'b5_2',
          rawText: 'Mendil kapmaca oyununda hızlı koştuğu [için] takımına maçı kazandırdı.',
          parts: [
            { type: 'text', value: 'Mendil kapmaca oyununda hızlı koştuğu ' },
            { type: 'blank', answer: 'için', hint: 'i...' },
            { type: 'text', value: ' takımına maçı kazandırdı.' }
          ]
        },
        {
          id: 'b5_3',
          rawText: 'Oyunun kurallarına dikkatle [uyarsan] herkesle huzurla yarışabilirsin.',
          parts: [
            { type: 'text', value: 'Oyunun kurallarına dikkatle ' },
            { type: 'blank', answer: 'uyarsan', hint: 'u...' },
            { type: 'text', value: ' herkesle huzurla yarışabilirsin.' }
          ]
        },
        {
          id: 'b5_4',
          rawText: 'Grupça hareket [etmek] üzere oyun alanında toplandık.',
          parts: [
            { type: 'text', value: 'Grupça hareket ' },
            { type: 'blank', answer: 'etmek', hint: 'e...' },
            { type: 'text', value: ' üzere oyun alanında toplandık.' }
          ]
        }
      ]
    },
    {
      id: 'demo_5_wheel',
      type: 'wheel',
      grade: '5',
      theme: 'Geleneklerimiz',
      outcome: 'DYS.DO.5.1',
      title: '5. Sınıf İsim ve Fiil Kökleri Çarkıfeleği',
      description: 'Çarkı çevirip gelen sözcüğün isim mi yoksa fiil kökü mü olduğunu söyleyin!',
      code: '5CAR01',
      createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 31,
      settings: { removeOnSpin: false },
      items: [
        'Sevgi (Fiil Kökü: Sev-)',
        'Kitaplık (İsim Kökü: Kitap)',
        'Koşucu (Fiil Kökü: Koş-)',
        'Gözlükçü (İsim Kökü: Göz)',
        'Yazarlık (Fiil Kökü: Yaz-)',
        'Suluk (İsim Kökü: Su)',
        'Bilgin (Fiil Kökü: Bil-)',
        'Evcil (İsim Kökü: Ev)'
      ]
    },
    {
      id: 'demo_5_matching',
      type: 'matching',
      grade: '5',
      theme: 'Atatürk\'ü Tanımak',
      outcome: 'T.O.5.3',
      title: '5. Sınıf Atatürk\'ü Anlamak: Eş Anlamlı Kelimeler',
      description: 'Millî Mücadele ve Atatürk metinlerinde geçen kelimeleri eş anlamlılarıyla eşleştirin',
      code: '5ESL01',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 22,
      settings: { showTimer: true },
      pairs: [
        { id: 'm5_1', left: 'Muallim', right: 'Öğretmen' },
        { id: 'm5_2', left: 'İstikbal', right: 'Gelecek' },
        { id: 'm5_3', left: 'Hürriyet', right: 'Özgürlük' },
        { id: 'm5_4', left: 'Vazife', right: 'Görev' },
        { id: 'm5_5', left: 'Millet', right: 'Ulus' },
        { id: 'm5_6', left: 'Fikir', right: 'Düşünce' }
      ]
    },

    // ==========================================
    // 6. SINIF ETKİNLİKLERİ (4 ADET)
    // ==========================================
    {
      id: 'demo_6_minideneme',
      type: 'minideneme',
      grade: '6',
      theme: 'Dilimizin Zenginliği',
      outcome: 'DYS.DO.6.1 / DYS.DO.6.2',
      title: '6. Sınıf Ses Olayları ve Ekler Denemesi',
      description: 'Ünlü düşmesi, ünsüz benzeşmesi, yumuşama ve yapım ekleri kazanım testi',
      code: '6DEN01',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 28,
      settings: { timePerQuestion: 40, showFeedback: true },
      questions: [
        {
          id: 'q6_1',
          text: '"Burnu", "aklı", "karnı" sözcüklerinde görülen ses olayı aşağıdakilerden hangisidir?',
          options: [
            'Ünsüz benzeşmesi (sertleşme)',
            'Ünlü düşmesi',
            'Ünsüz yumuşaması',
            'Ünlü daralması'
          ],
          correct: 1,
          explanation: 'Burun-u > burnu, akıl-ı > aklı; iki heceli sözcükler ünlüyle başlayan ek aldığında ikinci hecedeki dar ünlü düşer.'
        },
        {
          id: 'q6_2',
          text: '"Kitap-çı", "ağaç-ta", "sınıf-ta" sözcüklerinde hangi ses kuralı gerçekleşmiştir?',
          options: [
            'Ünsüz yumuşaması',
            'Ünlü daralması',
            'Ünsüz benzeşmesi (sertleşme)',
            'Ulama'
          ],
          correct: 2,
          explanation: 'F, s, t, k, ç, ş, h, p sert ünsüzlerinden biriyle biten sözcük c, d, g ile başlayan ek alınca ek ç, t, k seslerine dönüşerek benzeşir.'
        },
        {
          id: 'q6_3',
          text: 'Aşağıdaki altı çizili sözcüklerin hangisinde yapım eki kullanılmıştır?',
          options: [
            'Evler mahallede yan yana dizilmişti.',
            'Kitapçıdan yeni bir Türkçe sözlük aldım.',
            'Gözüm ağrıyınca doktora gittim.',
            'Masada iki tane kalem vardı.'
          ],
          correct: 1,
          explanation: '"Kitap-çı" sözcüğündeki "-çı" eki, kitap satan kişi anlamında yeni bir sözcük türettiği için yapım ekidir.'
        },
        {
          id: 'q6_4',
          text: '"Ağacın dalına konan kuş şarkı söylüyordu." cümlesindeki "ağacın" sözcüğünde hangi ses olayı vardır?',
          options: [
            'Ünsüz yumuşaması (ağaç > ağac-)',
            'Ünsüz türemesi',
            'Ünlü düşmesi',
            'Ünlü türemesi'
          ],
          correct: 0,
          explanation: '"Ağaç" sözcüğü ünlüyle başlayan "-ın" eki alınca sert "ç" sesi yumuşak "c" sesine dönüşmüştür.'
        },
        {
          id: 'q6_5',
          text: '"Ödevimi bitirmek istedim ... zamanım yetmedi." cümlesindeki boşluğa hangi zıtlık bağlacı getirilemez?',
          options: [
            'ama',
            'fakat',
            'lakin',
            'çünkü'
          ],
          correct: 3,
          explanation: '"Çünkü" sebep-sonuç bağlacıdır; zıt düşünceleri birbirine bağlamak için ama, fakat, lakin kullanılır.'
        }
      ]
    },
    {
      id: 'demo_6_presentation',
      type: 'presentation',
      grade: '6',
      theme: 'Bağımsızlık Yolu',
      outcome: 'T.O.6.14 / T.K.6.4',
      title: '6. Sınıf Bağımsızlık Yolu: İstiklal Marşı ve Şiir Analizi',
      description: 'Milli Mücadele ruhu, ahenk unsurları ve tıkla-keşfet etkileşimli sunumu',
      code: '6SUN01',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 17,
      settings: { autoPlay: false, autoPlayDelay: 6 },
      slides: [
        {
          id: 's6_1',
          type: 'title',
          title: 'İstiklal Marşı ve Bağımsızlık Ruhu',
          subtitle: '6. Sınıf Türkçe Dersi — Ahenk ve Anlam Dünyası',
          image: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=800&auto=format&fit=crop&q=80'
        },
        {
          id: 's6_2',
          type: 'poem',
          title: 'İlk Kıta İncelemesi',
          poemText: 'Korkma, sönmez bu şafaklarda yüzen al sancak;\nSönmeden yurdumun üstünde tüten en son ocak.\nO benim milletimin yıldızıdır, parlayacak;\nO benimdir, o benim milletimindir ancak.',
          poemAuthor: '— Mehmet Âkif Ersoy'
        },
        {
          id: 's6_3',
          type: 'interactive',
          title: 'Kıtadaki Sembolleri Keşfet',
          subtitle: 'Aşağıdaki kavramlara tıklayarak Mehmet Âkif\'in edebi inceliklerini öğrenin:',
          hotspots: [
            {
              id: 'h6_1',
              label: 'Korkma!',
              title: 'Hitap ve Cesaret',
              desc: 'Şiirin ilk sözcüğü Türk milletine ve kahraman ordumuza sarsılmaz bir inanç ve moral aşılar.'
            },
            {
              id: 'h6_2',
              label: 'Al Sancak & Ocak',
              title: 'Metonimi ve Aile Ocağı',
              desc: '"Tüten en son ocak", Türk yurdundaki son bağımsız aileyi ve vatan sevgisini simgeler.'
            },
            {
              id: 'h6_3',
              label: 'Uyak ve Redif',
              title: 'Ahenk Düzeni',
              desc: '"-acak" sesleri zengin kafiye oluşturarak şiirin marş ritmini ve coşkusunu yükseltir.'
            }
          ]
        },
        {
          id: 's6_4',
          type: 'accordion',
          title: 'Düşünelim ve Yorumlayalım',
          question: 'Mehmet Âkif Ersoy, "İstiklal Marşı benim değil, milletimindir" sözüyle ne anlatmak istemiştir?',
          answer: 'Kurtuluş Savaşı\'nın topyekûn millet fedakârlığı ile kazanıldığını, marşın da milletin ortak destanı olduğunu vurgulamıştır.'
        }
      ]
    },
    {
      id: 'demo_6_flashcard',
      type: 'flashcard',
      grade: '6',
      theme: 'Dilimizin Zenginliği',
      outcome: 'DYS.DO.6.1',
      title: '6. Sınıf Kök ve Ekler: Yapım Eki Hafıza Kartları',
      description: 'İsimden isim, isimden fiil, fiilden isim ve fiilden fiil yapan ekleri öğrenin',
      code: '6KRT01',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 25,
      settings: { shuffle: true },
      cards: [
        { id: 'fc6_1', front: 'İsimden İsim Yapan Ekler', back: '-lık (tuzluk), -cı (yolcu), -lı (köylü), -sız (susuz)\nKelimenin kökü de türü de isimdir.' },
        { id: 'fc6_2', front: 'İsimden Fiil Yapan Ekler', back: '-la/-le (başla-, sula-), -al/-el (azal-, çoğal-)\nİsim kökünden eylem türetir.' },
        { id: 'fc6_3', front: 'Fiilden İsim Yapan Ekler', back: '-gı/-gi (sevgi, vergi), -ıcı/-ici (yazıcı), -ak (durak)\nEylemi kavram veya alete dönüştürür.' },
        { id: 'fc6_4', front: 'Fiilden Fiil Yapan Ekler', back: '-dır/-dir (yazdır-), -t (anlat-), -ış (kaçış-)\nFiilin çatısını ve hareket tarzını değiştirir.' },
        { id: 'fc6_5', front: 'Kök ve Gövde Nedir?', back: 'Kök: Sözcüğün anlamlı en küçük parçasıdır.\nGövde: Kökün en az bir yapım eki almış halidir.' },
        { id: 'fc6_6', front: 'Çekim Eki ile Yapım Ekinin Farkı', back: 'Yapım eki kelimenin anlamını ve bazen türünü değiştirir.\nÇekim eki ise kelimenin cümledeki görevini belirler, yeni kelime türetmez.' }
      ]
    },
    {
      id: 'demo_6_matching',
      type: 'matching',
      grade: '6',
      theme: 'Bilim ve Teknoloji',
      outcome: 'T.Y.6.18',
      title: '6. Sınıf Bilim ve Teknoloji: Deyimler ve Anlamları',
      description: 'Akıl, düşünce ve bilimsel merakla ilgili deyimleri doğru anlamlarıyla eşleştirin',
      code: '6ESL01',
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 16,
      settings: { showTimer: true },
      pairs: [
        { id: 'm6_1', left: 'Kafa yormak', right: 'Bir konu üzerinde derinlemesine düşünmek' },
        { id: 'm6_2', left: 'Çığır açmak', right: 'Yeni bir yöntem, buluş veya çağ başlatmak' },
        { id: 'm6_3', left: 'İnce eleyip sık dokumak', right: 'Bir işi çok titiz ve ayrıntılı incelemek' },
        { id: 'm6_4', left: 'Akıl sır erdirmemek', right: 'Bir durumun gizli veya karmaşık yönünü çözememek' },
        { id: 'm6_5', left: 'Işık tutmak', right: 'Bir konuyu açıklayıcı ve aydınlatıcı bilgiler sunmak' }
      ]
    },

    // ==========================================
    // 7. SINIF ETKİNLİKLERİ (4 ADET)
    // ==========================================
    {
      id: 'demo_7_minideneme',
      type: 'minideneme',
      grade: '7',
      theme: 'Hayat Boyu Gelişim',
      outcome: 'DYS.DO.7.1 / DYS.DO.7.2',
      title: '7. Sınıf Fiil Kipleri ve Anlam Özellikleri Denemesi',
      description: 'Haber ve dilek kipleri, iş-oluş-durum fiilleri çoktan seçmeli testi',
      code: '7DEN01',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 30,
      settings: { timePerQuestion: 40, showFeedback: true },
      questions: [
        {
          id: 'q7_1',
          text: 'Öznenin kendi iradesi dışında kendiliğinden gerçekleşen fiillere "oluş fiili" denir. Hangisi oluş fiilidir?',
          options: [
            'Kitap okumak',
            'Yaprakların sararması',
            'Masada oturmak',
            'Mektup yazmak'
          ],
          correct: 1,
          explanation: 'Sararmak, paslanmak, büyümek, bayatlamak gibi fiiller zaman içinde kendiliğinden gerçekleştiği için oluş fiilidir.'
        },
        {
          id: 'q7_2',
          text: '"Yarın akşam teyzemler bize gelecek." cümlesindeki fiilin kipi ve şahsı hangisidir?',
          options: [
            'Şimdiki zaman - 3. tekil şahıs',
            'Gelecek zaman - 3. çoğul şahıs',
            'Geniş zaman - 1. çoğul şahıs',
            'Gereklilik kipi - 3. tekil şahıs'
          ],
          correct: 1,
          explanation: '"Gel-ecek-ler" fiili gelecek zaman eki (-ecek) ve 3. çoğul şahıs eki (-ler) almıştır.'
        },
        {
          id: 'q7_3',
          text: 'Aşağıdaki cümlelerin hangisinde dilek (tasarlama) kiplerinden biri kullanılmıştır?',
          options: [
            'Her sabah bir saat yürüyüş yaparım.',
            'Derslerine düzenli çalışmalısın.',
            'Dün akşam güzel bir belgesel izledik.',
            'Kardeşim odasında uyuyor.'
          ],
          correct: 1,
          explanation: '"Çalış-malı-sın" fiili gereklilik kipi eki (-malı) almıştır; gereklilik kipi dilek kipleri grubundadır.'
        },
        {
          id: 'q7_4',
          text: '"Fatih Sultan Mehmet 1453\'te İstanbul\'u fetheder." cümlesinde görülen anlam (zaman) kayması hangisidir?',
          options: [
            'Geniş zaman kipi, geçmiş zaman yerine kullanılmıştır.',
            'Şimdiki zaman kipi, gelecek zaman yerine kullanılmıştır.',
            'Gelecek zaman kipi, emir kipi yerine kullanılmıştır.',
            'İstek kipi, gereklilik kipi yerine kullanılmıştır.'
          ],
          correct: 0,
          explanation: 'Geçmişte yaşanmış bir olay "fetheder" geniş zaman ekiyle anlatılmış, kip kayması oluşmuştur.'
        },
        {
          id: 'q7_5',
          text: '"Onu dün çarşıda gördüm fakat konuşamadım." cümlesinde hangi fiil iş (kılış) bildirmektedir?',
          options: [
            'Gördüm (Onu gördüm)',
            'Dün',
            'Fakat',
            'Çarşıda'
          ],
          correct: 0,
          explanation: 'Başına "onu" sözcüğü getirilebilen ve nesne alabilen fiillere iş (kılış) fiili denir ("onu gördüm").'
        }
      ]
    },
    {
      id: 'demo_7_blank',
      type: 'blank',
      grade: '7',
      theme: 'Okuma Kültürü',
      outcome: 'T.O.7.16 / DYS.DO.7.3',
      title: '7. Sınıf Okuma Kültürü: Cümlede Zarflar (Belirteçler)',
      description: 'Zaman, durum, miktar ve yer-yön zarflarını doğru boşluklara yerleştirin',
      code: '7BOS01',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 21,
      settings: { showHint: true },
      questions: [
        {
          id: 'b7_1',
          rawText: 'Yazar, kütüphanedeki koltuğa oturup [sessizce] kitabını okumaya başladı.',
          parts: [
            { type: 'text', value: 'Yazar, kütüphanedeki koltuğa oturup ' },
            { type: 'blank', answer: 'sessizce', hint: 's...' },
            { type: 'text', value: ' kitabını okumaya başladı. (Durum Zarfı)' }
          ]
        },
        {
          id: 'b7_2',
          rawText: 'Edebiyat kulübü toplantısı [yarın] saat on beşte başlayacak.',
          parts: [
            { type: 'text', value: 'Edebiyat kulübü toplantısı ' },
            { type: 'blank', answer: 'yarın', hint: 'y...' },
            { type: 'text', value: ' saat on beşte başlayacak. (Zaman Zarfı)' }
          ]
        },
        {
          id: 'b7_3',
          rawText: 'Sınava hazırlanan öğrenci bu hafta [çok] soru çözdü.',
          parts: [
            { type: 'text', value: 'Sınava hazırlanan öğrenci bu hafta ' },
            { type: 'blank', answer: 'çok', hint: 'ç...' },
            { type: 'text', value: ' soru çözdü. (Miktar Zarfı)' }
          ]
        },
        {
          id: 'b7_4',
          rawText: 'Hava serinleyince üşüyen çocuk [içeri] girdi.',
          parts: [
            { type: 'text', value: 'Hava serinleyince üşüyen çocuk ' },
            { type: 'blank', answer: 'içeri', hint: 'i...' },
            { type: 'text', value: ' girdi. (Yer-Yön Zarfı, ek almaz)' }
          ]
        }
      ]
    },
    {
      id: 'demo_7_presentation',
      type: 'presentation',
      grade: '7',
      theme: 'Türk Sanatı',
      outcome: 'T.K.7.8',
      title: '7. Sınıf Geleneksel Türk Sanatları: Ebru ve Hat Sanatı',
      description: 'Kültürel mirasımız, sanat terimleri ve Genially tarzı tıkla-keşfet sunumu',
      code: '7SUN01',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 15,
      settings: { autoPlay: false, autoPlayDelay: 6 },
      slides: [
        {
          id: 's7_1',
          type: 'title',
          title: 'Suyun ve Rengin Dansı: Ebru Sanatı',
          subtitle: 'Geleneksel Türk Süsleme Sanatları — 7. Sınıf Türkçe Dersi',
          image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop&q=80'
        },
        {
          id: 's7_2',
          type: 'content',
          title: 'Ebru Sanatının Doğuşu ve Önemi',
          content: 'Ebru; kıvamı artırılmış suyun üzerine doğal boyalar damlatılarak oluşturulan desenlerin kağıda aktarılmasıyla yapılan köklü bir Türk sanatıdır. UNESCO Somut Olmayan Kültürel Miras Listesi\'nde yer alır.',
          image: ''
        },
        {
          id: 's7_3',
          type: 'interactive',
          title: 'Ebru Malzemelerini Tıkla-Keşfet',
          subtitle: 'Geleneksel ebru teknesindeki temel unsurları öğrenin:',
          hotspots: [
            {
              id: 'h7_1',
              label: 'Kitre',
              title: 'Suyun Kıvam Vericisi',
              desc: 'Geven dikeninden elde edilen doğal reçinedir; suyun yoğunluğunu artırarak boyaların batmasını engeller.'
            },
            {
              id: 'h7_2',
              label: 'Öd',
              title: 'Yüzey Gerilimi Sağlayıcı',
              desc: 'Büyükbaş hayvan ödüdür; boyaların su yüzeyinde dağılmasını ve birbirine karışmamasını sağlar.'
            },
            {
              id: 'h7_3',
              label: 'At Kılı Fırça',
              title: 'Gül Dalı & At Kılı',
              desc: 'Fırçanın sapı esnek gül dalından, kılları ise boyayı damlatmadan tutan at kılından ustalıkla örülür.'
            }
          ]
        },
        {
          id: 's7_4',
          type: 'accordion',
          title: 'Ders İçi Soru',
          question: 'Ebru sanatı insan ruhuna ve sabrına nasıl katkı sağlar?',
          answer: 'Ebru sanatında suyun üzerindeki her desen tektir ve asla tekrarlanamaz. Bu sanat insana tevekkül, sabır, dikkat ve estetik incelik kazandırır.'
        }
      ]
    },
    {
      id: 'demo_7_parolla',
      type: 'parolla',
      grade: '7',
      theme: 'Bir Hilal Uğruna',
      outcome: 'T.O.7.4',
      title: '7. Sınıf Bir Hilal Uğruna: Tarih ve Edebiyat Parollası',
      description: 'A\'dan Z\'ye Çanakkale, Millî Mücadele ve Türkçe edebi terimler çarkı',
      code: '7PAR01',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 26,
      settings: { timeLimit: 180, allowPass: true },
      questions: JSON.parse(JSON.stringify(DEFAULT_PAROLLA_QUESTIONS))
    },

    // ==========================================
    // 8. SINIF ETKİNLİKLERİ (4 ADET - LGS ODAKLI)
    // ==========================================
    {
      id: 'demo_8_minideneme',
      type: 'minideneme',
      grade: '8',
      theme: 'Akademik Düşünme Dünyası',
      outcome: 'DYS.DO.8.1 / T.O.8.22',
      title: '8. Sınıf LGS Fiilimsiler ve Cümlenin Ögeleri Denemesi',
      description: 'İsim-fiil, sıfat-fiil, zarf-fiil ve cümlenin temel/yardımcı ögeleri LGS tarzı sorular',
      code: '8LGS01',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 42,
      settings: { timePerQuestion: 50, showFeedback: true },
      questions: [
        {
          id: 'q8_1',
          text: 'Fiilimsiler fiil kök veya gövdelerinden türetilir ancak fiil gibi çekimlenemez. Hangisinde fiilimsi kullanılmıştır?',
          options: [
            'Akşam olunca köyün üzerine tatlı bir sessizlik çöktü.',
            'Kuşlar gökyüzünde neşeyle uçuyordu.',
            'Dün gece sabaha kadar yağmur yağdı.',
            'Çocuklar bahçede top oynuyor.'
          ],
          correct: 0,
          explanation: '"Akşam olunca" sözcüğündeki "-ınca" eki zarf-fiil ekidir ve cümleye zaman anlamı katmıştır.'
        },
        {
          id: 'q8_2',
          text: 'Aşağıdaki altı çizili sözcüklerden hangisi fiilimsi özelliğini kaybederek kalıcı isim olmuştur?',
          options: [
            'Annem akşam yemeğinde çok lezzetli bir sarma yapmıştı.',
            'Yarışmada birinci olan öğrenciyi tebrik ettiler.',
            'Koşarak yanımıza gelen çocuk nefes nefeseydi.',
            'Kitap okumak insanın ufkunu genişletir.'
          ],
          correct: 0,
          explanation: '"Sarma" sözcüğü fiilimsi ekini alıp somut bir yemek adı haline geldiği için kalıplaşmış isimdir.'
        },
        {
          id: 'q8_3',
          text: '"Güneşli günleri sabırsızlıkla bekleyen çiftçiler tarlalarını erkenden sürdüler." cümlesinin öznesi hangisidir?',
          options: [
            'Güneşli günleri',
            'Güneşli günleri sabırsızlıkla bekleyen çiftçiler',
            'Tarlalarını',
            'Erkenden'
          ],
          correct: 1,
          explanation: 'Süren kim? "Güneşli günleri sabırsızlıkla bekleyen çiftçiler" sıfat tamlaması grubudur ve bölünemez, cümlenin öznesidir.'
        },
        {
          id: 'q8_4',
          text: 'Aşağıdaki cümlelerin hangisinde vurgulanan öge nesnedir? (Fiil cümlelerinde vurgu yüklemden hemen önceki ögededir.)',
          options: [
            'Ahmet dün kütüphanede Türkçe kitabını unuttu.',
            'Ahmet Türkçe kitabını dün kütüphanede unuttu.',
            'Dün kütüphanede Türkçe kitabını Ahmet unuttu.',
            'Türkçe kitabını kütüphanede Ahmet dün unuttu.'
          ],
          correct: 0,
          explanation: 'Yüklem "unuttu", yüklemin hemen önündeki öge "Türkçe kitabını" belirtili nesnedir; dolayısıyla vurgu nesnededir.'
        },
        {
          id: 'q8_5',
          text: '"Konuşurken gözlerimin içine bakıyordu." cümlesindeki zarf-fiil cümleye hangi anlamı katmıştır?',
          options: [
            'Sebep',
            'Zaman',
            'Durum',
            'Miktar'
          ],
          correct: 1,
          explanation: '"Ne zaman bakıyordu?" sorusuna cevap veren "konuşurken" zarf-fiili cümleye zaman anlamı katmıştır.'
        }
      ]
    },
    {
      id: 'demo_8_matching',
      type: 'matching',
      grade: '8',
      theme: 'Doğa ve İnsan (Biyotaklit)',
      outcome: 'T.O.8.13',
      title: '8. Sınıf Metin Türleri ve Düşünceyi Geliştirme Yolları',
      description: 'Tanımlama, örneklendirme, tanık gösterme, karşılaştırma ve sayısal verilerden yararlanma',
      code: '8ESL01',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 35,
      settings: { showTimer: true },
      pairs: [
        { id: 'm8_1', left: 'Tanımlama', right: '"Bu nedir?" sorusuna verilen eksiksiz cevaptır' },
        { id: 'm8_2', left: 'Tanık Gösterme', right: 'Görüşü ispatlamak için yetkin bir kişinin sözünü aynen aktarmaktır' },
        { id: 'm8_3', left: 'Örneklendirme', right: 'Soyut düşünceyi somutlaştırarak anlaşılır kılmaktır' },
        { id: 'm8_4', left: 'Karşılaştırma', right: 'İki kavram arasındaki benzerlik ve farkları ortaya koymaktır' },
        { id: 'm8_5', left: 'Sayısal Veriler', right: 'İstatistiki bilgi ve rakamlarla anlatıma güvenilirlik kazandırmaktır' }
      ]
    },
    {
      id: 'demo_8_flashcard',
      type: 'flashcard',
      grade: '8',
      theme: 'İletişim ve Sosyal İlişkiler',
      outcome: 'T.Y.8.18',
      title: '8. Sınıf Medya Okuryazarlığı ve İkna Teknikleri',
      description: 'Siber zorbalık, mantık safsatası, algı yönetimi ve dijital ayak izi kavramları',
      code: '8KRT01',
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 29,
      settings: { shuffle: true },
      cards: [
        { id: 'fc8_1', front: 'Siber Zorbalık Nedir?', back: 'Dijital teknolojiler, sosyal medya veya mesajlaşma platformları kullanılarak birini kasten incitme, tehdit etme veya dışlama eylemidir.' },
        { id: 'fc8_2', front: 'Dijital Ayak İzi Nedir?', back: 'İnternet kullanırken arkamızda bıraktığımız tüm veri izleridir (ziyaret edilen siteler, paylaşımlar, beğeniler).' },
        { id: 'fc8_3', front: 'Filtre Balonu (Yankı Odası)', back: 'Arama motorlarının ve algoritmaların kullanıcının sadece kendi görüşlerine uyan içerikleri önüne çıkarması, zıt fikirlere kapatmasıdır.' },
        { id: 'fc8_4', front: 'Mantık Safsatası (Kısır Döngü)', back: 'Bir iddiayı sağlam kanıtlarla değil, kulağa hoş gelen yanıltıcı veya çelişkili ifadelerle savunma hatasıdır.' },
        { id: 'fc8_5', front: 'Tık Tuzağı (Clickbait)', back: 'Kullanıcıyı yanıltıcı, abartılı ve merak uyandıran başlıklarla bağlantıya tıklamaya zorlayan manipülasyon tekniğidir.' },
        { id: 'fc8_6', front: 'Medya Metinlerini Doğrulama (Fact-Checking)', back: 'İnternetteki bir haberin doğruluğunu resmî kaynaklar, teyit platformları ve güvenilir uzmanlarla çapraz kontrol etme sürecidir.' }
      ]
    },
    {
      id: 'demo_8_parolla',
      type: 'parolla',
      grade: '8',
      theme: 'Türk Hikâye Geleneği ve Destanlar',
      outcome: 'T.O.8.10 / DYS.DO.8.1',
      title: '8. Sınıf Destanlar ve Edebiyat LGS Parolla Çarkı',
      description: 'A\'dan Z\'ye 29 harfte LGS Türkçe kavramları ve destan kahramanları maratonu',
      code: '8PAR01',
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      playCount: 38,
      settings: { timeLimit: 180, allowPass: true },
      questions: JSON.parse(JSON.stringify(DEFAULT_PAROLLA_QUESTIONS))
    }
  ];
}

// ---- SEZDİRME YÖNTEMİ HAZIR DERS AKIŞLARI (5-8. SINIFLAR) ----
function getSezdirmeSeeds() {
  const now = Date.now();
  const mk = (o) => ({
    type: 'sezdirme',
    createdAt: new Date(now - 3600000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    playCount: 0,
    settings: { showTeacherNotes: false },
    ...o
  });

  return [
    // ---------- 5. SINIF: DEDEKTİFLİK TARZI SEZDİRME (İSİM VE SIFATLAR) ----------
    mk({
      id: 'sez_5_dedektif_isim_sifat',
      grade: '5', theme: 'İletişim ve Dilimizin Zenginliği', outcome: 'DYS.DO.5.1',
      code: 'SZ5DED',
      title: '🕵️ Dedektiflik Vakası: Soyguncu Neye Bindi? (İsim ve Sıfat Keşfi)',
      description: 'Telsiz konuşmaları ve şüpheli eşkâlinden yola çıkarak isimlerin ve sıfatların görevini sezdiren vaka kurgusu',
      objective: 'Öğrenciler, telsiz diyaloğunda "şey" yerine somut varlık adları (isim) ve ayırt edici niteliklerin (sıfat) kullanılmaması hâlinde iletişimin koptuğunu görerek isim ve sıfatın işlevini kendileri keşfeder.',
      steps: createDetectiveSezdirmeSteps('soyguncu')
    }),

    // ---------- 5. SINIF: NİTELEME SIFATLARI ----------
    mk({
      id: 'sez_5_sifat',
      grade: '5', theme: 'Oyun Dünyası', outcome: 'DYS.DO.5.1',
      code: 'SZ5SIF',
      title: 'Varlıkları Anlatan Sözcükler (Niteleme Sıfatları)',
      description: 'Sıfat terimini hiç söylemeden, örnek cümlelerden niteleme sıfatını keşfettiren ders akışı',
      objective: 'Öğrenciler, isimlerin önüne gelip onların nasıl olduğunu bildiren sözcükleri kendileri fark eder ve "niteleme sıfatı" kuralına ulaşır.',
      steps: [
        { id: 's5a1', type: 'hazirlik', title: 'Merak Kapısı',
          content: 'Teneffüste bahçede iki top var: biri küçük ve kırmızı, diğeri büyük ve mavi. Arkadaşınız uzaktan bağırıyor: "Topu bana at!"',
          question: 'Arkadaşınızın hangi topu istediğini anlamanız için cümlesine ne eklemesi gerekirdi?',
          image: '', note: 'Öğrencilerin "kırmızı topu, büyük topu" gibi cevaplar vermesini bekleyin. Bu aşamada "sıfat" terimini kesinlikle kullanmayın.' },
        { id: 's5a2', type: 'gozlem', title: 'Cümleleri İnceleyelim',
          instruction: 'Cümleleri sesli okuyun. Her cümlede bir varlık hakkında bize fazladan bilgi veren bir sözcük var. Bulabilir misiniz?',
          examples: ['[Kırmızı] uçurtma gökyüzünde süzülüyordu.', '[Yaşlı] adam bankta kitap okuyordu.', '[Sıcak] çorbayı yavaş yavaş içtik.', '[Yuvarlak] masanın etrafına oturduk.', '[Çalışkan] öğrenciler ödevlerini erkenden bitirdi.'],
          image: '', note: 'Önce vurguları açmadan öğrencilerin sözcükleri bulmasını isteyin. Bir cümleye tıklarsanız yalnızca o cümlenin vurgusu açılır.' },
        { id: 's5a3', type: 'karsilastir', title: 'İki Grubu Karşılaştıralım',
          instruction: 'Soldaki ve sağdaki cümleleri karşılaştırın. Hangi grup bize daha çok bilgi veriyor?',
          groupA: { title: '1. Grup', items: ['Kalem aldım.', 'Çiçek kokuyor.', 'Kedi uyuyor.'] },
          groupB: { title: '2. Grup', items: ['[Mavi] kalem aldım.', '[Güzel] çiçek kokuyor.', '[Tembel] kedi uyuyor.'] },
          question: '2. gruptaki vurgulu sözcükleri çıkarırsak cümlede ne eksilir?',
          note: 'Cevap: Varlığın nasıl olduğu bilgisi kaybolur; cümle yine kurulur ama varlık belirsizleşir.' },
        { id: 's5a4', type: 'soru', title: 'Düşünelim, Bulalım',
          questions: [
            { q: 'Vurgulu sözcükler cümlede hep hangi tür sözcüğün hemen önünde duruyor?', hint: 'Uçurtma, adam, çorba, masa... Bunlar neyin adı?', answer: 'Varlık adlarının, yani isimlerin önünde duruyor.' },
            { q: 'Bu sözcükleri bulmak için varlığa hangi soruyu sorabiliriz?', hint: '"... uçurtma?" diye sorun.', answer: '"Nasıl uçurtma?" sorusu.' },
            { q: 'Bu sözcükler varlığın hangi özelliklerini anlatıyor?', hint: 'Renk mi? Yaş mı? Biçim mi?', answer: 'Rengini, biçimini, durumunu, niteliğini anlatıyor.' }
          ], note: 'Soruları tek tek açın; her soruda öğrencilere düşünme süresi verin.' },
        { id: 's5a5', type: 'siniflandir', title: 'Gruplara Ayıralım',
          instruction: 'Sözcükleri iki gruba ayırın. Grupların adını sonra birlikte bulacağız!',
          hideNames: true, categories: ['Varlığın nasıl olduğunu anlatan', 'Varlığın kendisinin adı'],
          items: [{ text: 'uzun', c: 0 }, { text: 'ağaç', c: 1 }, { text: 'tatlı', c: 0 }, { text: 'elma', c: 1 }, { text: 'cesur', c: 0 }, { text: 'asker', c: 1 }, { text: 'kocaman', c: 0 }, { text: 'balina', c: 1 }],
          note: 'Gruplama bittikten sonra "Grup adı ne olabilir?" diye sorun, ardından adları açın.' },
        { id: 's5a6', type: 'cikarim', title: 'Kuralı Siz Bulun!',
          prompt: 'Gördüğünüz örneklerden yola çıkarak bu sözcükler hakkında bir kural yazın. "Bu sözcükler ..." diye başlayabilirsiniz.',
          placeholder: 'Bu sözcükler...', note: 'Gönüllü öğrencilerin tahminlerini panoya ekleyin. Yanlış tahminleri düzeltmeyin; kural açılınca birlikte karşılaştıracaksınız.' },
        { id: 's5a7', type: 'kural', title: 'Birlikte Bulduğumuz Kural',
          rule: 'Varlıkların rengini, biçimini, durumunu ve özelliğini bildiren; isimlerin önüne gelerek onları niteleyen sözcüklere NİTELEME SIFATI denir.\nNiteleme sıfatları isme sorulan "Nasıl?" sorusuyla bulunur.\nÖrnek: kırmızı uçurtma, yaşlı adam, sıcak çorba',
          image: '', note: 'Kuralı sınıfın tahminleriyle karşılaştırın; en yakın tahmini yıldızla işaretleyip takdir edin.' },
        { id: 's5a8', type: 'uygulama', title: 'Kuralı Uygulayalım',
          items: [
            { q: 'Hangisinde niteleme sıfatı yoktur?', options: ['Tatlı bir rüya gördüm.', 'Bahçede koşuyoruz.', 'Dar sokaktan geçtik.', 'Yeşil çantamı unuttum.'], correct: 1, explanation: '"Bahçede koşuyoruz." cümlesinde hiçbir ismi niteleyen sözcük yoktur.' },
            { q: '"... bir çocuk sınıfa girdi." Boşluğa hangisi niteleme sıfatı olarak gelir?', options: ['neşeli', 'hızla', 'dün', 'orada'], correct: 0, explanation: '"Nasıl çocuk?" → neşeli çocuk.' },
            { q: '"Eski evin bahçesinde ulu bir çınar vardı." cümlesinde kaç niteleme sıfatı vardır?', options: ['1', '2', '3', '4'], correct: 1, explanation: '"eski" (ev) ve "ulu" (çınar) niteleme sıfatıdır.' }
          ], note: '' }
      ]
    }),

    // ---------- 5. SINIF: de/da YAZIMI ----------
    mk({
      id: 'sez_5_deda',
      grade: '5', theme: 'İletişim ve Sosyal İlişkiler', outcome: 'Yazım Kuralları',
      code: 'SZ5DDA',
      title: 'Ayrı mı, Bitişik mi? (de/da Bağlacı ve -de/-da Eki)',
      description: 'Mesajlaşma örneğinden yola çıkarak "de/da"nın yazımını öğrencilere buldurun',
      objective: 'Öğrenciler, cümleden çıkarıldığında anlamı bozmayan "de/da"nın ayrı, yer bildiren "-de/-da"nın bitişik yazıldığını keşfeder.',
      steps: [
        { id: 's5b1', type: 'hazirlik', title: 'Karışık Bir Mesaj',
          content: 'Ayşe arkadaşına mesaj gönderdi: "Sende gel, bizde oyun var."\nArkadaşı cevap yazdı: "Bende mi? Ben de gelirim!"',
          question: '"Sende" ile "Sen de" aynı anlama mı geliyor? Mesajı okuyan biri ne anlar?', image: '',
          note: 'Öğrencilerin yazım farkının anlam farkı yarattığını sezmesi hedeflenir.' },
        { id: 's5b2', type: 'gozlem', title: 'Cümleleri İnceleyelim',
          instruction: 'Vurgulanacak sözcüklere dikkat edin. Bazıları bitişik, bazıları ayrı yazılmış.',
          examples: ['Kitabım [sende] kaldı.', '[Sen de] bizimle gel.', 'Anahtar [çantada] duruyor.', 'Ali [de] çok güldü.', 'Akşam [evde] film izledik.', 'Kardeşim [de] okula başladı.'], image: '', note: '' },
        { id: 's5b3', type: 'karsilastir', title: 'Bitişik ve Ayrı',
          instruction: 'İki gruptaki "de/da"ları karşılaştırın.',
          groupA: { title: 'A Grubu', items: ['Kalemim [sende].', 'Toplantı [okulda].', 'Kedi [bahçede].'] },
          groupB: { title: 'B Grubu', items: ['[Sen de] gel.', '[Okul da] tatil oldu.', '[Bahçe de] çiçek açtı.'] },
          question: 'Her iki gruptan "de/da"yı çıkarıp cümleleri yeniden okuyun. Ne oluyor?', note: '' },
        { id: 's5b4', type: 'soru', title: 'Düşünelim, Bulalım',
          questions: [
            { q: 'A grubundaki "-de/-da"yı atarsak cümle ne olur?', hint: '"Kalemim sen." "Toplantı okul."', answer: 'Anlam bozulur; çünkü bu bir ektir ve yer bildirir.' },
            { q: 'B grubundaki "de/da"yı atarsak ne olur?', hint: '"Sen gel." "Okul tatil oldu."', answer: 'Anlam bozulmaz; yalnızca "dahi, ayrıca" anlamı kaybolur.' },
            { q: 'A grubundaki sözcüklere hangi soruyu sorabiliriz?', hint: 'Kalem ...?', answer: '"Nerede?" sorusu; yer bildirir.' },
            { q: '"Kitapta" doğru yazılıyor. Peki "Kitap ta okudum" yazabilir miyiz?', hint: 'Ayrı yazılan de/da hiç değişir mi?', answer: 'Hayır. Ayrı yazılan de/da asla te/ta olmaz: "Kitap da okudum."' }
          ], note: '' },
        { id: 's5b5', type: 'siniflandir', title: 'Gruplara Ayıralım',
          instruction: 'Cümleleri "de/da"nın görevine göre iki gruba ayırın.',
          hideNames: true, categories: ['Bitişik yazılan ek (-de/-da)', 'Ayrı yazılan bağlaç (de/da)'],
          items: [{ text: 'Evde kimse yok.', c: 0 }, { text: 'Ben de geleceğim.', c: 1 }, { text: 'Masada kitap var.', c: 0 }, { text: 'Bu da güzelmiş.', c: 1 }, { text: 'Parkta oynadık.', c: 0 }, { text: 'Sınıf da temizlendi.', c: 1 }], note: '' },
        { id: 's5b6', type: 'cikarim', title: 'Kuralı Siz Bulun!',
          prompt: '"de/da" ne zaman ayrı, ne zaman bitişik yazılır? Bir arkadaşınıza anlatır gibi kuralı yazın.', placeholder: 'Eğer ... ise ayrı yazılır, ... ise bitişik yazılır.', note: '' },
        { id: 's5b7', type: 'kural', title: 'Birlikte Bulduğumuz Kural',
          rule: '-de/-da HÂL EKİ: Sözcüğe bitişik yazılır, "Nerede?" sorusunun cevabıdır, yer bildirir. Sert ünsüzden sonra -te/-ta olur. (evde, okulda, kitapta)\nde/da BAĞLACI: Her zaman ayrı yazılır, "dahi, bile, ayrıca" anlamı katar. Cümleden çıkarılınca anlam bozulmaz. Asla te/ta olmaz. (Sen de gel. Ali de güldü.)',
          image: '', note: '' },
        { id: 's5b8', type: 'uygulama', title: 'Kuralı Uygulayalım',
          items: [
            { q: 'Hangisinde "de/da"nın yazımı yanlıştır?', options: ['Sen de bize katıl.', 'Kalemim evde kaldı.', 'Bende seni çok özledim.', 'Okulda tören var.'], correct: 2, explanation: '"Ben de seni çok özledim." olmalı; çıkarılınca anlam bozulmuyor.' },
            { q: '"Ahmet ___ yarışmaya katıldı." Boşluğa hangisi gelir?', options: ['de (ayrı)', '-de (bitişik)', 'te (ayrı)', '-te (bitişik)'], correct: 0, explanation: '"Ahmet de" — katılma anlamı, ayrı yazılır.' },
            { q: 'Hangisinde "de" ek olarak kullanılmıştır?', options: ['O da geldi.', 'Ben de biliyorum.', 'Bahçede kuşlar ötüyor.', 'Bu da olur.'], correct: 2, explanation: '"Bahçede" → Nerede? sorusunun cevabı, yer bildiren ek.' }
          ], note: '' }
      ]
    }),

    // ---------- 6. SINIF: ÜNSÜZ BENZEŞMESİ ----------
    mk({
      id: 'sez_6_sertlesme',
      grade: '6', theme: 'Dilimizin Zenginliği', outcome: 'DYS.DO.6.2',
      code: 'SZ6SRT',
      title: 'Seslerin Birbirine Benzemesi (Ünsüz Benzeşmesi)',
      description: 'Sesli okuma ve gözlemle "FıSTıKÇı ŞaHaP" kuralını öğrencilere keşfettiren ders',
      objective: 'Öğrenciler, sert ünsüzle biten sözcüklere gelen c, d, g ile başlayan eklerin ç, t, k\'ye dönüştüğünü kendileri fark eder.',
      steps: [
        { id: 's6a1', type: 'hazirlik', title: 'Kulağı Tırmalayan Mesaj',
          content: 'Bir arkadaşınız mesajında şöyle yazmış:\n"Kitapcıda buluşalım, ağaçda seni bekliyorum."',
          question: 'Bu sözcükleri sesli söylediğinizde ağzınızdan nasıl çıkıyor? Yazıldığı gibi mi?', image: '',
          note: 'Öğrencilerin sesli okumasını sağlayın. Yazılışla söyleyişin uyuşmadığını fark etmeleri yeterli.' },
        { id: 's6a2', type: 'gozlem', title: 'Eklere Dikkat',
          instruction: 'Cümleleri sesli okuyun. Sözcüklere eklenen parçalara dikkat edin.',
          examples: ['Kitap[çı]dan yeni bir defter aldım.', 'Sınıf[ta] kimse kalmamıştı.', 'Ağaç[tan] düşen elmaları topladık.', 'Sepet[te] taze ekmekler vardı.', 'Yavaş[ça] kapıyı açtı.'], image: '', note: '' },
        { id: 's6a3', type: 'karsilastir', title: 'Aynı Ek, Farklı Yazım',
          instruction: 'Aynı ekler iki grupta farklı yazılmış. Neden olabilir?',
          groupA: { title: 'A Grubu', items: ['Okul[da] toplandık.', 'Ev[den] çıktık.', 'Köy[de] yaşıyor.', 'Göz[cü] nöbete başladı.'] },
          groupB: { title: 'B Grubu', items: ['Sınıf[ta] toplandık.', 'Sokak[tan] geçtik.', 'Kitap[ta] okudum.', 'Süt[çü] erkenden geldi.'] },
          question: 'Sözcüklerin son harflerine bakın. B grubundakilerin ortak özelliği ne?', note: '' },
        { id: 's6a4', type: 'soru', title: 'Sesleri Dinleyelim',
          questions: [
            { q: 'B grubundaki sözcüklerin son harfleri nelerdir?', hint: 'sınıF, sokaK, kitaP, süT', answer: 'f, k, p, t' },
            { q: 'Elinizi boğazınıza koyup bu sesleri söyleyin. Ses telleriniz titriyor mu?', hint: 'Fısıldar gibi çıkan sesler...', answer: 'Titremiyor; bu seslere sert (ötümsüz) ünsüz denir.' },
            { q: 'Sert ünsüzden sonra gelen c, d, g sesleri hangi seslere dönüşüyor?', hint: '-da → ?, -cı → ?', answer: 'c → ç, d → t, g → k' },
            { q: 'Sert ünsüzleri kolayca hatırlamak için onları bir sözcükte toplayabilir miyiz?', hint: 'F, S, T, K, Ç, Ş, H, P harflerini sırayla dizin.', answer: '"FıSTıKÇı ŞaHaP"' }
          ], note: 'Dördüncü soruda öğrencilerin kendi akılda tutma cümlelerini de dinleyin.' },
        { id: 's6a5', type: 'siniflandir', title: 'Ek Değişti mi?',
          instruction: 'Sözcükleri iki gruba ayırın.',
          hideNames: true, categories: ['Ekin ilk sesi sertleşti', 'Ekin ilk sesi değişmedi'],
          items: [{ text: 'kitapçı', c: 0 }, { text: 'evde', c: 1 }, { text: 'ağaçta', c: 0 }, { text: 'okulda', c: 1 }, { text: 'yurtta', c: 0 }, { text: 'denizden', c: 1 }, { text: 'balıkçı', c: 0 }, { text: 'yolcu', c: 1 }], note: '' },
        { id: 's6a6', type: 'cikarim', title: 'Kuralı Siz Bulun!',
          prompt: 'Ekin baştaki sesi hangi durumda değişiyor? Kendi kuralınızı yazın.', placeholder: 'Sözcük ... ile bitiyorsa ...', note: '' },
        { id: 's6a7', type: 'kural', title: 'Birlikte Bulduğumuz Kural',
          rule: 'Sert ünsüzlerle (f, s, t, k, ç, ş, h, p — "FıSTıKÇı ŞaHaP") biten sözcüklere c, d, g ile başlayan bir ek geldiğinde bu sesler sertleşerek ç, t, k olur. Bu ses olayına ÜNSÜZ BENZEŞMESİ (sertleşme) denir.\nÖrnek: kitap + cı → kitapçı, sınıf + da → sınıfta, ağaç + dan → ağaçtan',
          image: '', note: 'Özel isimlerde de geçerli olduğunu hatırlatın: Sinop\'ta, Zonguldak\'tan.' },
        { id: 's6a8', type: 'uygulama', title: 'Kuralı Uygulayalım',
          items: [
            { q: 'Hangisinde ünsüz benzeşmesi vardır?', options: ['bahçede', 'sepette', 'evden', 'yolda'], correct: 1, explanation: 'sepet + de → sepette (t sert ünsüzü)' },
            { q: 'Hangisinin yazımı yanlıştır?', options: ['dolapta', 'kitaptan', 'ağaçda', 'sokakta'], correct: 2, explanation: '"ağaçta" olmalı: ç sert ünsüzdür.' },
            { q: '"Sinop\'...an gelen arkadaşımızla tanıştık." Boşluğa hangi harf gelir?', options: ['t', 'd', 'c', 'g'], correct: 0, explanation: 'Sinop\'tan — p sert ünsüzdür.' }
          ], note: '' }
      ]
    }),

    // ---------- 7. SINIF: İŞ-OLUŞ-DURUM FİİLLERİ ----------
    mk({
      id: 'sez_7_fiilanlam',
      grade: '7', theme: 'Hayat Boyu Gelişim', outcome: 'DYS.DO.7.2',
      code: 'SZ7FIL',
      title: 'Bahçıvanın Bir Yılı (İş, Oluş ve Durum Fiilleri)',
      description: 'Bir bahçe hikâyesinden yola çıkarak fiilleri anlam özelliklerine göre keşfettiren ders',
      objective: 'Öğrenciler, fiillerin nesne alıp almadığına ve değişim bildirip bildirmediğine bakarak iş, oluş ve durum fiillerini ayırt eder.',
      steps: [
        { id: 's7a1', type: 'hazirlik', title: 'Bahçıvanın Bir Yılı',
          content: 'Bahçıvan baharda toprağı kazıyor, fidanları dikiyor. Yaz boyunca fidanlar büyüyor. Sonbaharda yapraklar sararıyor. Yorulan bahçıvan ağacın gölgesinde oturuyor.',
          question: 'Bu olaylardan hangilerini bahçıvan kendi isteğiyle yapıyor, hangileri kendiliğinden oluyor?', image: '', note: '' },
        { id: 's7a2', type: 'gozlem', title: 'Fiillere Bakalım',
          instruction: 'Vurgulanan fiillerin her biri farklı bir şey anlatıyor. Ne fark ediyorsunuz?',
          examples: ['Bahçıvan toprağı [kazdı].', 'Ağacın yaprakları [sarardı].', 'Yorgun bahçıvan gölgede [oturdu].', 'Annem kekleri fırına [koydu].', 'Ekmek iki günde [bayatladı].', 'Bebek beşiğinde [uyuyor].'], image: '', note: '' },
        { id: 's7a3', type: 'karsilastir', title: '"Onu" Testi',
          instruction: 'Her fiilin başına "onu" sözcüğünü getirmeyi deneyin.',
          groupA: { title: 'A Grubu', items: ['Mektubu [yazdı].', 'Kapıyı [açtı].', 'Elmayı [kesti].'] },
          groupB: { title: 'B Grubu', items: ['Saçları [ağardı].', 'Çocuk [büyüdü].', 'Demir [paslandı].'] },
          question: '"Onu yazdı" diyebiliyoruz. "Onu ağardı" diyebilir miyiz? Bu bize ne anlatıyor?', note: '' },
        { id: 's7a4', type: 'soru', title: 'Düşünelim, Bulalım',
          questions: [
            { q: '"Onu kazdı, onu koydu" diyebiliyoruz. "Onu sarardı" diyebilir miyiz?', hint: 'Fiil bir nesneyi etkiliyor mu?', answer: 'Hayır. Bazı fiiller bir nesneyi etkiler ve "onu" sorusuna uyar, bazıları uymaz.' },
            { q: 'Sararmak, büyümek, bayatlamak... Bu değişimler bir anda mı olur, zamanla mı?', hint: 'Ekmeğin bayatlamasını gözünüzle izleyebilir misiniz?', answer: 'Zamanla ve kendiliğinden olur; bir değişim bildirir.' },
            { q: '"Oturmak, uyumak, durmak" fiillerinde bir nesne ya da değişim var mı?', hint: 'Oturan kişi bir şeyi etkiliyor ya da dönüşüyor mu?', answer: 'Hayır; özne yalnızca bir hâlde bulunur.' }
          ], note: '' },
        { id: 's7a5', type: 'siniflandir', title: 'Üç Gruba Ayıralım',
          instruction: 'Fiilleri üç gruba ayırın. "Onu" testini ve "değişim var mı?" sorusunu kullanın.',
          hideNames: true, categories: ['Nesne alır, bir şeyi etkiler', 'Zamanla, kendiliğinden değişim', 'Öznenin içinde bulunduğu hâl'],
          items: [{ text: 'okumak', c: 0 }, { text: 'kırmak', c: 0 }, { text: 'yazmak', c: 0 }, { text: 'solmak', c: 1 }, { text: 'acıkmak', c: 1 }, { text: 'kızarmak', c: 1 }, { text: 'uyumak', c: 2 }, { text: 'gülmek', c: 2 }, { text: 'yatmak', c: 2 }], note: '' },
        { id: 's7a6', type: 'cikarim', title: 'Gruplara Ad Verin',
          prompt: 'Her grubun özelliğini kendi cümlelerinizle yazın ve gruplara birer ad verin.', placeholder: '1. grup: ... 2. grup: ... 3. grup: ...', note: '' },
        { id: 's7a7', type: 'kural', title: 'Birlikte Bulduğumuz Kural',
          rule: 'İŞ (KILIŞ) FİİLLERİ: Öznenin bir nesneyi etkilediği, nesne alabilen fiillerdir. Başına "onu" getirilebilir. (okumak, yazmak, kesmek)\nOLUŞ FİİLLERİ: Zamanla, kendiliğinden gerçekleşen ve bir değişim bildiren fiillerdir. (sararmak, büyümek, bayatlamak)\nDURUM FİİLLERİ: Öznenin içinde bulunduğu hâli bildiren, nesne almayan ve değişim içermeyen fiillerdir. (oturmak, uyumak, gülmek)',
          image: '', note: '' },
        { id: 's7a8', type: 'uygulama', title: 'Kuralı Uygulayalım',
          items: [
            { q: 'Hangisi oluş fiilidir?', options: ['koşmak', 'paslanmak', 'yazmak', 'yatmak'], correct: 1, explanation: 'Paslanmak zamanla, kendiliğinden gerçekleşen bir değişimdir.' },
            { q: '"Onu" sözcüğü hangisinin başına getirilebilir?', options: ['uyumak', 'acıkmak', 'okumak', 'solmak'], correct: 2, explanation: '"Onu okumak" → iş fiili.' },
            { q: '"Çocuk, parkta saatlerce uyudu." cümlesindeki fiil anlamca nedir?', options: ['İş', 'Oluş', 'Durum', 'Hiçbiri'], correct: 2, explanation: 'Uyumak öznenin içinde bulunduğu hâli bildirir.' }
          ], note: '' }
      ]
    }),

    // ---------- 8. SINIF: SIFAT-FİİL ----------
    mk({
      id: 'sez_8_sifatfiil',
      grade: '8', theme: 'Akademik Düşünme Dünyası', outcome: 'DYS.DO.8.1',
      code: 'SZ8SFF',
      title: 'Hem Fiil Hem Sıfat (Sıfat-Fiiller)',
      description: 'Koridordaki bir konuşmadan yola çıkarak sıfat-fiilleri ve eklerini keşfettiren ders',
      objective: 'Öğrenciler, fiilden türeyip ismi niteleyen sözcükleri ve bu sözcüklerin eklerini kendileri bularak sıfat-fiil kavramına ulaşır.',
      steps: [
        { id: 's8a1', type: 'hazirlik', title: 'Koridorda Bir Konuşma',
          content: 'İki arkadaş koridorda konuşuyor:\n— Hangi öğretmen?\n— Hani şu bize her sabah şiir okuyan öğretmen!',
          question: '"Şiir okuyan" sözleri öğretmen hakkında ne söylüyor? "Okuyan" sözcüğü sizce hangi sözcükten türemiş?', image: '', note: '' },
        { id: 's8a2', type: 'gozlem', title: 'Cümleleri İnceleyelim',
          instruction: 'Vurgulanan sözcüklerin hepsi bir fiilden türemiş. Ama cümlede ne iş görüyorlar?',
          examples: ['[Koşan] çocuk yere düştü.', '[Okunmuş] kitapları rafa dizdik.', '[Gelecek] hafta sınavımız var.', '[Kırılmaz] bir bardak aldık.', '[Bildik] yüzler arasında rahatladı.', 'Bize [yazacağımız] konuyu söyledi.'], image: '', note: '' },
        { id: 's8a3', type: 'karsilastir', title: 'Aynı Kök, Farklı Görev',
          instruction: 'Aynı kökten gelen sözcükler iki grupta farklı görevde.',
          groupA: { title: 'A Grubu', items: ['Çocuk [koşuyor].', 'Kitapları [okumuş].', 'Bu bardak [kırılmaz].'] },
          groupB: { title: 'B Grubu', items: ['[Koşan] çocuk düştü.', '[Okunmuş] kitapları verdi.', '[Kırılmaz] bardak aldık.'] },
          question: 'A grubunda vurgulu sözcükler cümlenin neresinde, ne iş görüyor? B grubunda neyi anlatıyorlar?', note: '' },
        { id: 's8a4', type: 'soru', title: 'Düşünelim, Bulalım',
          questions: [
            { q: 'A grubundaki vurgulu sözcükler cümlede hangi görevde?', hint: 'Cümlenin sonunda, işi bildiriyorlar...', answer: 'Çekimli fiil; cümlenin yüklemi.' },
            { q: 'B grubunda aynı sözcükler hangi sözcüğün önünde duruyor ve ona ne yapıyor?', hint: 'Hangi çocuk? → ... çocuk', answer: 'İsmin önünde duruyor ve ismi niteliyor; sıfat gibi davranıyor.' },
            { q: 'Bu sözcüklerin sonundaki eklere bakın. Hangi ekler var?', hint: 'koş-an, okun-muş, gel-ecek, kırıl-maz, bil-dik, yaz-acağımız', answer: '-an/-en, -miş, -ecek/-acak, -maz/-mez, -dik/-dık (ve -ası/-esi, -ar/-er)' },
            { q: 'Hem fiilden türeyen hem de sıfat görevi gören bu sözcüklere nasıl bir ad verebiliriz?', hint: 'İki görevi birleştiren bir ad...', answer: 'Sıfat-fiil (ortaç).' }
          ], note: '' },
        { id: 's8a5', type: 'siniflandir', title: 'Görevine Göre Ayıralım',
          instruction: 'Vurgulu sözcükleri cümledeki görevine göre iki gruba ayırın.',
          hideNames: true, categories: ['İsmi niteleyen fiilimsi', 'Çekimli fiil (yüklem)'],
          items: [{ text: 'gülen (gülen yüz)', c: 0 }, { text: 'güldü (Bebek güldü.)', c: 1 }, { text: 'akar (akar su)', c: 0 }, { text: 'akar (Su akar.)', c: 1 }, { text: 'bilinmedik (bilinmedik yol)', c: 0 }, { text: 'bilmiyor (O bilmiyor.)', c: 1 }], note: '"akar" örneği çok öğreticidir: aynı sözcük görevine göre farklı gruba girer.' },
        { id: 's8a6', type: 'cikarim', title: 'Kuralı Siz Bulun!',
          prompt: 'Fiilden türeyip ismi niteleyen bu sözcüklerin özelliklerini ve eklerini bir kural olarak yazın.', placeholder: 'Fiillere ... ekleri getirilince ...', note: '' },
        { id: 's8a7', type: 'kural', title: 'Birlikte Bulduğumuz Kural',
          rule: 'Fiil kök veya gövdelerine -an/-en, -ası/-esi, -maz/-mez, -ar/-er/-r, -dık/-dik, -acak/-ecek, -mış/-miş ekleri getirilerek türetilen ve isimleri niteleyen sözcüklere SIFAT-FİİL (ortaç) denir.\nÖrnek: koşan çocuk, okunmuş kitap, gelecek hafta, kırılmaz bardak\nDikkat: Nitelediği isim düşerse sıfat-fiil adlaşır: "Gelenler (gelen kişiler) içeri girsin."',
          image: '', note: '' },
        { id: 's8a8', type: 'uygulama', title: 'Kuralı Uygulayalım',
          items: [
            { q: 'Hangisinde sıfat-fiil kullanılmıştır?', options: ['Kuşlar uçuyor.', 'Uçan kuşları izledik.', 'Kuşlar hızla uçtu.', 'Kuş uçmak ister.'], correct: 1, explanation: '"Uçan kuşlar" → ismi niteleyen sıfat-fiil.' },
            { q: '"Okunacak kitapları masaya bıraktım." cümlesindeki sıfat-fiilin eki hangisidir?', options: ['-acak', '-ları', '-ı', '-a'], correct: 0, explanation: 'okun-acak kitaplar' },
            { q: 'Hangisinde sıfat-fiil adlaşmıştır?', options: ['Gelen misafirler oturdu.', 'Çalışanlar mutlaka başarır.', 'Yanan ev söndürüldü.', 'Akan su yosun tutmaz.'], correct: 1, explanation: '"Çalışanlar" → çalışan kişiler; nitelediği isim düşmüştür.' }
          ], note: '' }
      ]
    })
  ];
}

function getSeedStudents() {
  return [
    {
      id: 'st_1',
      number: '104',
      name: 'Zeynep Kaya',
      className: '8-A',
      points: 85,
      avatar: '👧',
      badges: [
        { id: 'b1', name: 'Kitap Kurdu', icon: '📖', date: new Date(Date.now() - 86400000 * 5).toISOString() },
        { id: 'b2', name: 'İmla Ustası', icon: '✍️', date: new Date(Date.now() - 86400000 * 2).toISOString() }
      ],
      notes: [
        { id: 'n1', text: 'Yazım kuralları denemesinde sınıf birincisi oldu. Kitap okuma saatinde çok istekli.', date: new Date(Date.now() - 86400000 * 3).toISOString() }
      ],
      history: [
        { id: 'h1', type: 'plus', amount: 10, reason: 'Derste koşma şiirini ezbere okudu', date: new Date(Date.now() - 86400000 * 1).toISOString() }
      ]
    },
    {
      id: 'st_2',
      number: '218',
      name: 'Ahmet Demir',
      className: '8-A',
      points: 60,
      avatar: '👦',
      badges: [
        { id: 'b3', name: 'Aktif Katılım', icon: '🎯', date: new Date(Date.now() - 86400000 * 4).toISOString() }
      ],
      notes: [
        { id: 'n2', text: 'Noktalama işaretlerinde biraz eksiği var, ek alıştırma verildi.', date: new Date(Date.now() - 86400000 * 6).toISOString() }
      ],
      history: [
        { id: 'h2', type: 'plus', amount: 10, reason: 'Sözcük türleri çarkında doğru cevap verdi', date: new Date(Date.now() - 86400000 * 2).toISOString() }
      ]
    },
    {
      id: 'st_3',
      number: '305',
      name: 'Elif Şahin',
      className: '8-A',
      points: 95,
      avatar: '👧',
      badges: [
        { id: 'b4', name: 'Kitap Kurdu', icon: '📖', date: new Date(Date.now() - 86400000 * 8).toISOString() },
        { id: 'b5', name: 'Yaratıcı Fikir', icon: '💡', date: new Date(Date.now() - 86400000 * 3).toISOString() }
      ],
      notes: [
        { id: 'n3', text: 'Kompozisyon ödevinde deyimleri çok yerinde ve zengin kullandı.', date: new Date(Date.now() - 86400000 * 4).toISOString() }
      ],
      history: [
        { id: 'h3', type: 'plus', amount: 15, reason: 'Haftalık kitap özetini kusursuz teslim etti', date: new Date(Date.now() - 86400000 * 1).toISOString() }
      ]
    },
    {
      id: 'st_4',
      number: '412',
      name: 'Mehmet Can',
      className: '7-A',
      points: 50,
      avatar: '👦',
      badges: [
        { id: 'b6', name: 'Örnek Davranış', icon: '🤝', date: new Date(Date.now() - 86400000 * 2).toISOString() }
      ],
      notes: [
        { id: 'n4', text: 'Arkadaşlarına ders içi grup çalışmasında çok yardımcı oldu.', date: new Date(Date.now() - 86400000 * 5).toISOString() }
      ],
      history: []
    }
  ];
}

// ---- MERKEZİ SES EFEKTLERİ MOTORU (Web Audio API - Çevrimdışı & Sıfır Bağımlılık) ----
const SoundEffects = {
  _ctx: null,

  getContext() {
    if (!this._ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this._ctx = new AudioCtx();
    }
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  },

  isMuted() {
    return localStorage.getItem('duzgunogretmenlik_muted') === 'true';
  },

  setMuted(muted) {
    localStorage.setItem('duzgunogretmenlik_muted', muted ? 'true' : 'false');
    this.updateToggleButtons();
  },

  toggleMute() {
    const next = !this.isMuted();
    this.setMuted(next);
    showToast(next ? '🔇 Sesler Kapatıldı' : '🔊 Sesler Açıldı', 'info', 1500);
    return next;
  },

  updateToggleButtons() {
    const muted = this.isMuted();
    document.querySelectorAll('.sound-toggle-btn').forEach(btn => {
      btn.innerHTML = muted ? '🔇 Ses Kapalı' : '🔊 Ses Açık';
      btn.classList.toggle('muted', muted);
    });
  },

  playTone(freq, type = 'sine', duration = 0.15, delay = 0, gainVal = 0.15) {
    if (this.isMuted()) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(gainVal, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      }, delay * 1000);
    } catch (e) {}
  },

  correct() {
    this.playTone(523.25, 'triangle', 0.12, 0);     // C5
    this.playTone(659.25, 'triangle', 0.12, 0.08);  // E5
    this.playTone(783.99, 'triangle', 0.25, 0.16);  // G5
  },

  wrong() {
    this.playTone(260, 'sawtooth', 0.18, 0, 0.12);
    this.playTone(220, 'sawtooth', 0.25, 0.12, 0.12);
  },

  click() {
    this.playTone(700, 'sine', 0.04, 0, 0.08);
  },

  flip() {
    this.playTone(400, 'sine', 0.05, 0, 0.08);
    this.playTone(600, 'sine', 0.05, 0.03, 0.06);
  },

  spin() {
    this.playTone(850, 'triangle', 0.03, 0, 0.06);
  },

  pass() {
    this.playTone(440, 'sine', 0.12, 0);
    this.playTone(330, 'sine', 0.15, 0.06);
  },

  win() {
    this.playTone(523.25, 'triangle', 0.12, 0);
    this.playTone(659.25, 'triangle', 0.12, 0.1);
    this.playTone(783.99, 'triangle', 0.12, 0.2);
    this.playTone(1046.50, 'triangle', 0.4, 0.3);
  }
};

// ---- YABANCI SÖZCÜKLERE TÜRKÇE ÖNERİLER MODÜLÜ (Sözlük & Öneri Veritabanı) ----
const WordStore = {
  STORAGE_KEY: 'word_suggestions',

  getAll() {
    let list = DB.get(this.STORAGE_KEY);
    if (!list || !Array.isArray(list) || list.length === 0) {
      list = this.resetToDefaults();
    }
    return list;
  },

  getById(id) {
    return this.getAll().find(w => w.id === id) || null;
  },

  addWord(wordObj) {
    let list = this.getAll();
    const newWord = {
      id: generateId(),
      foreign: (wordObj.foreign || '').trim(),
      origin: (wordObj.origin || 'Yabancı Kökenli').trim(),
      turkish: (wordObj.turkish || '').trim(),
      example: (wordObj.example || '').trim(),
      proposedBy: (wordObj.proposedBy || 'Öğrenci Önerisi').trim(),
      isOfficial: !!wordObj.isOfficial,
      likes: 0,
      createdAt: new Date().toISOString()
    };
    list.unshift(newWord);
    DB.set(this.STORAGE_KEY, list);
    return newWord;
  },

  upvote(id) {
    let list = this.getAll();
    const w = list.find(item => item.id === id);
    if (w) {
      w.likes = (w.likes || 0) + 1;
      DB.set(this.STORAGE_KEY, list);
      return w.likes;
    }
    return 0;
  },

  delete(id) {
    let list = this.getAll().filter(w => w.id !== id);
    DB.set(this.STORAGE_KEY, list);
    return list;
  },

  resetToDefaults() {
    const list = getSeedWords();
    DB.set(this.STORAGE_KEY, list);
    return list;
  }
};

function getSeedWords() {
  return [
    {
      id: 'w1',
      foreign: 'Selfie',
      origin: 'İngilizce',
      turkish: 'Özçekim',
      example: 'Tarihi köprü önünde sınıfça güzel bir özçekim yaptık.',
      proposedBy: 'TDK Resmi Karşılığı',
      isOfficial: true,
      likes: 42,
      createdAt: '2026-11-01T10:00:00Z'
    },
    {
      id: 'w2',
      foreign: 'Online',
      origin: 'İngilizce',
      turkish: 'Çevrim içi',
      example: 'Ders materyallerini çevrim içi sistem üzerinden inceleyebilirsiniz.',
      proposedBy: 'TDK Resmi Karşılığı',
      isOfficial: true,
      likes: 38,
      createdAt: '2026-11-02T10:00:00Z'
    },
    {
      id: 'w3',
      foreign: 'Link',
      origin: 'İngilizce',
      turkish: 'Bağlantı',
      example: 'Ödevinizi göndermek için paylaşılan bağlantıya tıklayınız.',
      proposedBy: 'TDK Resmi Karşılığı',
      isOfficial: true,
      likes: 35,
      createdAt: '2026-11-03T10:00:00Z'
    },
    {
      id: 'w4',
      foreign: 'Spoiler',
      origin: 'İngilizce',
      turkish: 'Olaybozan / İpucu Kaçıran',
      example: 'Kitabın sonunu söyleyerek olaybozanlık yapma lütfen!',
      proposedBy: 'Zeynep Kaya (8-A)',
      isOfficial: false,
      likes: 56,
      createdAt: '2026-11-04T12:30:00Z'
    },
    {
      id: 'w5',
      foreign: 'Random',
      origin: 'İngilizce',
      turkish: 'Gelişigüzel / Rastlantısal',
      example: 'Öğretmenimiz çarkıfelekle gelişigüzel bir kavram seçti.',
      proposedBy: 'Ahmet Demir (8-A)',
      isOfficial: false,
      likes: 29,
      createdAt: '2026-11-05T14:15:00Z'
    },
    {
      id: 'w6',
      foreign: 'Feedback',
      origin: 'İngilizce',
      turkish: 'Geri bildirim / Dönüt',
      example: 'Kompozisyon ödevleriniz hakkındaki geri bildirimleri panoya astım.',
      proposedBy: 'TDK Resmi Karşılığı',
      isOfficial: true,
      likes: 31,
      createdAt: '2026-11-06T09:00:00Z'
    },
    {
      id: 'w7',
      foreign: 'Plaza',
      origin: 'İspanyolca',
      turkish: 'İş merkezi',
      example: 'Büyük şehirlerdeki iş merkezlerinde Türkçe tabelalar tercih edilmelidir.',
      proposedBy: 'TDK Resmi Karşılığı',
      isOfficial: true,
      likes: 24,
      createdAt: '2026-11-06T11:00:00Z'
    },
    {
      id: 'w8',
      foreign: 'Trend',
      origin: 'İngilizce',
      turkish: 'Eğilim / Akım',
      example: 'Gençler arasında kitap okuma kulüpleri yeni bir eğilim haline geldi.',
      proposedBy: 'Elif Şahin (8-A)',
      isOfficial: false,
      likes: 47,
      createdAt: '2026-11-07T16:20:00Z'
    },
    {
      id: 'w9',
      foreign: 'Lansman',
      origin: 'Fransızca',
      turkish: 'Tanıtım',
      example: 'Yeni çıkan şiir kitabının tanıtımı kütüphanede yapıldı.',
      proposedBy: 'TDK Resmi Karşılığı',
      isOfficial: true,
      likes: 19,
      createdAt: '2026-11-07T17:00:00Z'
    },
    {
      id: 'w10',
      foreign: 'Download / Upload',
      origin: 'İngilizce',
      turkish: 'İndirme / Yükleme',
      example: 'Türkçe sunum dosyasını indirdikten sonra ödevinizi yükleyin.',
      proposedBy: 'Mehmet Can (7-A)',
      isOfficial: false,
      likes: 33,
      createdAt: '2026-11-08T10:00:00Z'
    }
  ];
}

// ============================================================
// SUPABASE İSTEMCİ, KİMLİK DOĞRULAMA VE ETKİNLİKLER PAYLAŞIM SERVİSİ
// ============================================================
const SupabaseService = {
  SESSION_STORAGE_KEY: 'duzgun_sb_session',
  CACHE_KEY: 'supabase_etkinlikler_cache',
  _client: null,
  _tableProps: null,
  _pendingEtkinlikLoad: false,
  _lastSavedActivity: null,

  getClient() {
    if (this._client) return this._client;
    try {
      if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
        this._client = window.supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.KEY);
        if (typeof window !== 'undefined') window.supabaseClient = this._client;
        return this._client;
      }
    } catch (e) {
      console.warn('Supabase istemcisi başlatılamadı:', e);
    }
    return null;
  },

  async ensureClient() {
    const existing = this.getClient();
    if (existing) return existing;
    if (typeof document === 'undefined') return null;

    const alreadyLoading = document.querySelector('script[data-supabase-cdn="1"]');
    if (!alreadyLoading) {
      await new Promise(resolve => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        s.setAttribute('data-supabase-cdn', '1');
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        s.onload = done;
        s.onerror = done;
        setTimeout(done, 4000);
        document.head.appendChild(s);
      });
    } else {
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    return this.getClient();
  },

  _isValidJwt(token) {
    return typeof token === 'string' && token.split('.').length === 3 && token.startsWith('eyJ');
  },

  saveAuthSession(session, user, remember = true) {
    try {
      const payload = JSON.stringify({
        access_token: session?.access_token || '',
        refresh_token: session?.refresh_token || '',
        user: user || null
      });
      sessionStorage.setItem(this.SESSION_STORAGE_KEY, payload);
      if (remember) localStorage.setItem(this.SESSION_STORAGE_KEY, payload);
      else localStorage.removeItem(this.SESSION_STORAGE_KEY);
    } catch (e) {}
  },

  getAuthSession() {
    try {
      const raw = sessionStorage.getItem(this.SESSION_STORAGE_KEY) || localStorage.getItem(this.SESSION_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^sb-.*-auth-token$/i.test(k)) {
          const sbRaw = localStorage.getItem(k);
          if (sbRaw) return JSON.parse(sbRaw);
        }
      }
    } catch (e) {}
    return null;
  },

  clearAuthStorage() {
    try {
      sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
      localStorage.removeItem(this.SESSION_STORAGE_KEY);
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^sb-.*-auth-token/i.test(k)) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  },

  getAccessToken() {
    const sess = this.getAuthSession();
    const tok = sess?.access_token || '';
    return this._isValidJwt(tok) ? tok : '';
  },

  getSupabaseUser() {
    const sess = this.getAuthSession();
    return sess?.user || null;
  },

  _buildHeaders(extra = {}, includeUserBearer = true) {
    const headers = {
      apikey: SUPABASE_CONFIG.KEY,
      'Content-Type': 'application/json',
      ...extra
    };
    if (includeUserBearer) {
      const jwt = this.getAccessToken();
      if (jwt) headers.Authorization = `Bearer ${jwt}`;
    }
    return headers;
  },

  async refreshSessionState() {
    try {
      const client = this.getClient();
      if (!client || !client.auth) return;
      const wasLoggedIn = (typeof AuthStore !== 'undefined' && AuthStore.isLoggedIn) ? AuthStore.isLoggedIn() : false;
      const wasAdmin = (typeof AuthStore !== 'undefined' && AuthStore.isAdmin) ? AuthStore.isAdmin() : false;
      const { data } = await client.auth.getSession();
      const session = data?.session || null;
      if (session && session.user) {
        this.saveAuthSession(session, session.user, true);
        if (typeof AuthStore !== 'undefined' && AuthStore.syncSupabaseUser) {
          AuthStore.syncSupabaseUser(session.user, session, true);
          if (typeof AuthStore.syncNavbarAndRoleUI === 'function') {
            AuthStore.syncNavbarAndRoleUI();
          }
          const nowLoggedIn = AuthStore.isLoggedIn();
          const nowAdmin = AuthStore.isAdmin();
          if (typeof window.renderRoleUI === 'function') {
            window.renderRoleUI();
          }
          if ((wasLoggedIn !== nowLoggedIn || wasAdmin !== nowAdmin) && typeof window.initPage === 'function') {
            window.initPage();
          }
        }
      }
    } catch (e) {}
  },

  async signUpWithEmail(email, password, metadata = {}) {
    try {
      const client = await this.ensureClient();
      if (client && client.auth) {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: metadata }
        });
        if (error) {
          const msg = String(error.message || 'Kayıt sırasında bir hata oluştu.');
          const lower = msg.toLowerCase();
          if (lower.includes('already registered') || lower.includes('already exists')) {
            return { ok: false, alreadyExists: true, error: 'Bu e-posta adresi ile daha önce kayıt olunmuş.' };
          }
          if (lower.includes('failed to fetch') || lower.includes('network')) {
            return { ok: false, networkError: true, error: msg };
          }
          return { ok: false, error: msg };
        }
        return { ok: true, user: data?.user || null, session: data?.session || null };
      }

      const resp = await fetch(`${SUPABASE_CONFIG.URL}/auth/v1/signup`, {
        method: 'POST',
        headers: this._buildHeaders({}, false),
        body: JSON.stringify({ email, password, data: metadata })
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.msg || json?.error_description || json?.message || 'Kayıt başarısız.';
        const lower = String(msg).toLowerCase();
        return {
          ok: false,
          alreadyExists: lower.includes('already registered') || lower.includes('already exists'),
          error: msg
        };
      }
      const user = json?.user || (json?.id ? json : null);
      const session = json?.access_token ? json : (json?.session || null);
      return { ok: true, user, session };
    } catch (err) {
      return { ok: false, networkError: true, error: err?.message || 'Ağ hatası' };
    }
  },

  async signInWithEmail(email, password) {
    try {
      const client = await this.ensureClient();
      if (client && client.auth) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          const msg = String(error.message || 'Giriş yapılamadı.');
          const lower = msg.toLowerCase();
          return {
            ok: false,
            emailNotConfirmed: lower.includes('email not confirmed'),
            invalidCredentials: lower.includes('invalid login credentials') || lower.includes('invalid credentials'),
            networkError: lower.includes('failed to fetch') || lower.includes('network'),
            error: msg
          };
        }
        return { ok: true, user: data?.user || null, session: data?.session || null };
      }

      const resp = await fetch(`${SUPABASE_CONFIG.URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: this._buildHeaders({}, false),
        body: JSON.stringify({ email, password })
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error_description || json?.msg || json?.message || 'E-posta veya şifre hatalı!';
        const lower = String(msg).toLowerCase();
        return {
          ok: false,
          emailNotConfirmed: lower.includes('email not confirmed'),
          invalidCredentials: lower.includes('invalid login credentials'),
          error: msg
        };
      }
      return { ok: true, user: json?.user || null, session: json };
    } catch (err) {
      return { ok: false, networkError: true, error: err?.message || 'Ağ hatası' };
    }
  },

  async resetPasswordForEmail(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { ok: false, error: 'Lütfen geçerli bir e-posta adresi girin.' };
    }
    try {
      const client = await this.ensureClient();
      if (client && client.auth) {
        const redirectTo = window.location.href.split('?')[0];
        const { error } = await client.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      }
      const resp = await fetch(`${SUPABASE_CONFIG.URL}/auth/v1/recover`, {
        method: 'POST',
        headers: this._buildHeaders({}, false),
        body: JSON.stringify({ email: cleanEmail })
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        return { ok: false, error: j?.msg || j?.message || 'Sıfırlama bağlantısı gönderilemedi.' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'Bağlantı hatası' };
    }
  },

  async _fetchTableProperties() {
    if (this._tableProps) return this._tableProps;
    try {
      const resp = await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/`, {
        method: 'GET',
        headers: this._buildHeaders({ Accept: 'application/openapi+json' }, true)
      });
      if (resp.ok) {
        const spec = await resp.json().catch(() => null);
        const props = spec?.definitions?.[SUPABASE_CONFIG.TABLE]?.properties
          || spec?.components?.schemas?.[SUPABASE_CONFIG.TABLE]?.properties
          || null;
        if (props && Object.keys(props).length > 0) {
          this._tableProps = props;
          return props;
        }
      }
    } catch (e) {}

    // OpenAPI devre dışıysa örnek satırdan sütun isimlerini okumayı dene
    try {
      const client = this.getClient();
      if (client) {
        const { data } = await client.from(SUPABASE_CONFIG.TABLE).select('*').limit(1);
        if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === 'object') {
          const derived = {};
          Object.keys(data[0]).forEach(k => { derived[k] = { type: typeof data[0][k] }; });
          this._tableProps = derived;
          return derived;
        }
      }
    } catch (e) {}

    return null;
  },

  _buildEtkinlikPayload(activityJson, propsMap, supaUser, isUpdate) {
    const currentUser = (typeof AuthStore !== 'undefined' && AuthStore.getCurrentUser) ? AuthStore.getCurrentUser() : null;
    const rawUid = supaUser?.id || currentUser?.supabaseUid || '';
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(rawUid));
    const jsonColumns = ['veri', 'icerik', 'data', 'etkinlik', 'json_veri', 'json', 'payload', 'content', 'detay', 'etkinlik_verisi'];

    if (propsMap && typeof propsMap === 'object') {
      const payload = {};
      const firstJsonCol = jsonColumns.find(col => Object.prototype.hasOwnProperty.call(propsMap, col));
      if (firstJsonCol) {
        const propSpec = propsMap[firstJsonCol] || {};
        const wantsText = propSpec.type === 'string' && propSpec.format !== 'json' && propSpec.format !== 'jsonb';
        payload[firstJsonCol] = wantsText ? JSON.stringify(activityJson) : activityJson;
      }

      const candidateValues = {
        baslik: activityJson.title || 'İsimsiz Etkinlik',
        title: activityJson.title || 'İsimsiz Etkinlik',
        ad: activityJson.title || 'İsimsiz Etkinlik',
        tur: activityJson.type || 'minideneme',
        type: activityJson.type || 'minideneme',
        aciklama: activityJson.description || '',
        description: activityJson.description || '',
        sinif: String(activityJson.grade || '5'),
        grade: String(activityJson.grade || '5'),
        tema: activityJson.theme || '',
        theme: activityJson.theme || '',
        kazanim: activityJson.outcome || '',
        outcome: activityJson.outcome || '',
        kod: activityJson.code || '',
        code: activityJson.code || '',
        eposta: supaUser?.email || currentUser?.email || '',
        email: supaUser?.email || currentUser?.email || '',
        kullanici_eposta: supaUser?.email || currentUser?.email || '',
        user_email: supaUser?.email || currentUser?.email || '',
        yazar: currentUser?.displayName || activityJson.ownerName || 'Öğretmen',
        author_name: currentUser?.displayName || activityJson.ownerName || 'Öğretmen',
        ogretmen: currentUser?.displayName || activityJson.ownerName || 'Öğretmen',
        updated_at: new Date().toISOString()
      };

      Object.keys(candidateValues).forEach(col => {
        if (Object.prototype.hasOwnProperty.call(propsMap, col)) {
          payload[col] = candidateValues[col];
        }
      });

      ['user_id', 'kullanici_id', 'owner_id', 'author_id'].forEach(col => {
        if (Object.prototype.hasOwnProperty.call(propsMap, col)) {
          const propSpec = propsMap[col] || {};
          if (isUuid) {
            payload[col] = rawUid;
          } else if (propSpec.format !== 'uuid' && currentUser?.id) {
            payload[col] = currentUser.id;
          }
        }
      });

      if (!isUpdate && Object.prototype.hasOwnProperty.call(propsMap, 'id')) {
        const idSpec = propsMap.id || {};
        const hasDefault = Object.prototype.hasOwnProperty.call(idSpec, 'default') || idSpec.readOnly === true;
        if (!hasDefault && idSpec.type === 'string' && idSpec.format !== 'uuid') {
          payload.id = String(activityJson.supabaseId || activityJson.id);
        }
      }

      if (Object.keys(payload).length > 0) return payload;
    }

    // Şema okunamadıysa uyumlu aday sütunları gönder; eksik sütunlar PGRST204 ile ayıklanır
    const fallbackPayload = {
      baslik: activityJson.title || 'İsimsiz Etkinlik',
      title: activityJson.title || 'İsimsiz Etkinlik',
      tur: activityJson.type || 'minideneme',
      type: activityJson.type || 'minideneme',
      veri: activityJson,
      icerik: activityJson,
      data: activityJson,
      etkinlik: activityJson,
      kod: activityJson.code || ''
    };
    if (isUuid) fallbackPayload.user_id = rawUid;
    return fallbackPayload;
  },

  async _execWriteQuery(payload, existingRemoteId, useUpdate) {
    const client = await this.ensureClient();
    if (client && client.from) {
      if (useUpdate && existingRemoteId) {
        const { data, error } = await client
          .from(SUPABASE_CONFIG.TABLE)
          .update(payload)
          .eq('id', existingRemoteId)
          .select();
        return { data, error };
      }
      const { data, error } = await client
        .from(SUPABASE_CONFIG.TABLE)
        .insert([payload])
        .select();
      return { data, error };
    }

    const endpoint = (useUpdate && existingRemoteId)
      ? `${SUPABASE_CONFIG.URL}/rest/v1/${SUPABASE_CONFIG.TABLE}?id=eq.${encodeURIComponent(existingRemoteId)}`
      : `${SUPABASE_CONFIG.URL}/rest/v1/${SUPABASE_CONFIG.TABLE}`;
    const resp = await fetch(endpoint, {
      method: (useUpdate && existingRemoteId) ? 'PATCH' : 'POST',
      headers: this._buildHeaders({ Prefer: 'return=representation' }, true),
      body: JSON.stringify(payload)
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      return {
        data: null,
        error: {
          code: json?.code || String(resp.status),
          message: json?.message || json?.hint || `HTTP ${resp.status}`
        }
      };
    }
    return { data: Array.isArray(json) ? json : (json ? [json] : []), error: null };
  },

  async _writeEtkinlikWithAdapt(initialPayload, existingRemoteId) {
    const workingPayload = { ...initialPayload };
    let useUpdate = !!existingRemoteId;

    for (let attempt = 0; attempt < 18; attempt++) {
      const { data, error } = await this._execWriteQuery(workingPayload, existingRemoteId, useUpdate);
      if (!error) {
        const row = Array.isArray(data) ? data[0] : data;
        if (useUpdate && !row) {
          useUpdate = false;
          continue;
        }
        return { ok: true, row: row || { ...workingPayload, id: existingRemoteId } };
      }

      const msg = String(error.message || '');
      const code = String(error.code || '');

      // PostgREST PGRST204: eksik sütunu çıkarıp tekrar dene
      const colMatch = msg.match(/Could not find the ['"]([^'"]+)['"] column/i);
      if (colMatch && colMatch[1] && Object.prototype.hasOwnProperty.call(workingPayload, colMatch[1])) {
        delete workingPayload[colMatch[1]];
        continue;
      }

      // Zorunlu NOT NULL id sütunu varsa id üretip ekle
      if ((code === '23502' || /null value in column ['"]?id['"]?/i.test(msg)) && !workingPayload.id) {
        workingPayload.id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' && /uuid/i.test(msg))
          ? crypto.randomUUID()
          : generateId();
        continue;
      }

      // uuid bekleyen id alanına düz metin gönderildiyse UUID'ye çevir
      if (/invalid input syntax for type uuid/i.test(msg) && workingPayload.id && typeof crypto !== 'undefined' && crypto.randomUUID) {
        workingPayload.id = crypto.randomUUID();
        continue;
      }

      // Aynı id çakıştıysa yeni id veya update'e dön
      if (code === '23505' && workingPayload.id && attempt === 0) {
        delete workingPayload.id;
        continue;
      }

      return { ok: false, error: msg || 'Supabase kayıt hatası', code };
    }
    return { ok: false, error: 'Tablo sütunları ile eşleşen veri gönderilemedi.', code: 'ADAPT_LIMIT' };
  },

  _extractEtkinlikJson(row, fallbackId = '') {
    if (!row || typeof row !== 'object') return null;
    const jsonFields = ['veri', 'icerik', 'data', 'etkinlik', 'json_veri', 'json', 'payload', 'content', 'detay', 'etkinlik_verisi'];
    let parsed = null;
    for (const f of jsonFields) {
      if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
        if (typeof row[f] === 'string') {
          try { parsed = JSON.parse(row[f]); } catch (e) {}
        } else if (typeof row[f] === 'object') {
          parsed = JSON.parse(JSON.stringify(row[f]));
        }
        if (parsed && typeof parsed === 'object') break;
      }
    }
    if (!parsed) {
      parsed = JSON.parse(JSON.stringify(row));
    }

    const remoteId = String(row.id ?? parsed.supabaseId ?? fallbackId ?? parsed.id ?? '');
    parsed.supabaseId = remoteId;
    if (!parsed.id) parsed.id = remoteId;
    parsed.title = parsed.title || row.baslik || row.title || row.ad || 'Paylaşılan Etkinlik';
    parsed.type = parsed.type || row.tur || row.type || 'minideneme';
    if (parsed.type === 'quiz') parsed.type = 'minideneme';
    parsed.description = parsed.description || row.aciklama || row.description || '';
    parsed.grade = String(parsed.grade || row.sinif || row.grade || '5');
    parsed.theme = parsed.theme || row.tema || row.theme || 'Genel Türkçe';
    parsed.code = parsed.code || row.kod || row.code || generateCode();
    parsed.isSeed = false;
    return typeof _upgradeActivityUrlsToHttps === 'function' ? _upgradeActivityUrlsToHttps(parsed) : parsed;
  },

  cacheEtkinlik(id, activityObj) {
    if (!id || !activityObj) return;
    try {
      const cache = DB.get(this.CACHE_KEY) || {};
      cache[String(id)] = activityObj;
      if (activityObj.id) cache[String(activityObj.id)] = activityObj;
      DB.set(this.CACHE_KEY, cache);
    } catch (e) {}
  },

  getCachedEtkinlik(id) {
    if (!id) return null;
    const cache = DB.get(this.CACHE_KEY) || {};
    return cache[String(id)] || null;
  },

  getPlayRelativePath(activity) {
    const map = {
      sezdirme:     'play-sezdirme.html',
      minideneme:   'play-quiz.html',
      quiz:         'play-quiz.html',
      presentation: 'play-presentation.html',
      blank:        'play-blank.html',
      wheel:        'play-wheel.html',
      matching:     'play-matching.html',
      flashcard:    'play-flashcard.html',
      parolla:      'play-parolla.html'
    };
    return map[activity?.type] || 'play-quiz.html';
  },

  buildShareUrls(remoteId, activity) {
    const loc = window.location;
    const cleanPath = loc.pathname.replace(/\\/g, '/');
    let rootPath = cleanPath;
    if (/\/pages\/[^/]*$/i.test(cleanPath)) {
      rootPath = cleanPath.replace(/\/pages\/[^/]*$/i, '/');
    } else {
      rootPath = cleanPath.replace(/\/[^/]*$/, '/');
    }
    const originPrefix = (loc.origin && loc.origin !== 'null') ? loc.origin : (loc.protocol + '//' + (loc.host || ''));
    const encodedId = encodeURIComponent(String(remoteId));
    const rootShareUrl = loc.protocol === 'file:'
      ? `${originPrefix}${rootPath}index.html?etkinlik=${encodedId}`
      : `${originPrefix}${rootPath}?etkinlik=${encodedId}`;
    const playRel = this.getPlayRelativePath(activity);
    const playerShareUrl = `${originPrefix}${rootPath}pages/${playRel}?etkinlik=${encodedId}`;
    return {
      primary: rootShareUrl,
      player: playerShareUrl,
      query: `?etkinlik=${encodedId}`
    };
  },

  async saveToEtkinlikler(activity) {
    if (!activity) return { ok: false, error: 'Kaydedilecek etkinlik bulunamadı.' };
    const activityJson = JSON.parse(JSON.stringify(activity));
    delete activityJson.isSharedPreview;
    activityJson.isSeed = false;
    activityJson.updatedAt = new Date().toISOString();

    let supaUser = this.getSupabaseUser();
    try {
      const client = await this.ensureClient();
      if (client && client.auth) {
        const { data } = await client.auth.getSession();
        if (data?.session?.user) {
          this.saveAuthSession(data.session, data.session.user, true);
          supaUser = data.session.user;
        }
      }
    } catch (e) {}

    const propsMap = await this._fetchTableProperties();
    const payload = this._buildEtkinlikPayload(activityJson, propsMap, supaUser, !!activity.supabaseId);
    const writeRes = await this._writeEtkinlikWithAdapt(payload, activity.supabaseId || null);

    if (!writeRes.ok) {
      return { ok: false, error: writeRes.error, code: writeRes.code };
    }

    const remoteId = String(writeRes.row?.id ?? activity.supabaseId ?? activity.id);
    activity.supabaseId = remoteId;
    activityJson.supabaseId = remoteId;
    if (typeof ActivityStore !== 'undefined' && ActivityStore.save) {
      ActivityStore.save(activity);
    }
    this.cacheEtkinlik(remoteId, activityJson);

    return {
      ok: true,
      id: remoteId,
      row: writeRes.row,
      activityJson,
      shareUrls: this.buildShareUrls(remoteId, activityJson)
    };
  },

  async saveAndShareActivity(activity) {
    const res = await this.saveToEtkinlikler(activity);
    if (res.ok) {
      try {
        const path = window.location.pathname.replace(/\\/g, '/').toLowerCase();
        if (path.includes('editor-')) {
          window.history.replaceState({}, '', `?etkinlik=${encodeURIComponent(res.id)}`);
        }
        const previewBtn = document.getElementById('previewBtn');
        if (previewBtn && activity) {
          previewBtn.href = `${this.getPlayRelativePath(activity)}?etkinlik=${encodeURIComponent(res.id)}`;
        }
      } catch (e) {}

      if (navigator.clipboard && res.shareUrls?.primary) {
        navigator.clipboard.writeText(res.shareUrls.primary).catch(() => {});
      }
      showToast(`Etkinlik JSON olarak "etkinlikler" tablosuna kaydedildi! (?etkinlik=${res.id})`, 'success');
    } else {
      showToast('Supabase kaydı sırasında uyarı: ' + (res.error || 'Bilinmeyen hata'), 'error');
    }

    this.openShareResultModal(res, activity);
    return res;
  },

  async handleEditorSaveAndShare() {
    const btn = document.getElementById('saveAndShareBtn');
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Kaydediliyor...';
    }
    try {
      if (typeof window.saveActivity === 'function') {
        window.saveActivity();
      }
      const params = new URLSearchParams(window.location.search);
      const urlId = params.get('etkinlik') || params.get('id');
      const targetActivity = this._lastSavedActivity || (urlId ? ActivityStore.getById(urlId) : null);
      if (!targetActivity) {
        showToast('Kaydedilecek aktif etkinlik bulunamadı.', 'error');
        return;
      }
      await this.saveAndShareActivity(targetActivity);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText || '🚀 Kaydet ve Paylaş';
      }
    }
  },

  async fetchEtkinlikById(etkinlikId) {
    const cleanId = String(etkinlikId || '').trim();
    if (!cleanId) return null;

    try {
      const client = await this.ensureClient();
      let foundRow = null;

      if (client && client.from) {
        let res = await client
          .from(SUPABASE_CONFIG.TABLE)
          .select('*')
          .eq('id', cleanId)
          .limit(1);

        if ((!res.data || res.data.length === 0)) {
          res = await client
            .from(SUPABASE_CONFIG.TABLE)
            .select('*')
            .eq('kod', cleanId)
            .limit(1);
        }
        if (res.data && res.data.length > 0) {
          foundRow = res.data[0];
        }
      } else {
        const resp = await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/${SUPABASE_CONFIG.TABLE}?id=eq.${encodeURIComponent(cleanId)}&select=*&limit=1`, {
          method: 'GET',
          headers: this._buildHeaders({}, true)
        });
        if (resp.ok) {
          const rows = await resp.json().catch(() => []);
          if (Array.isArray(rows) && rows.length > 0) foundRow = rows[0];
        }
      }

      if (foundRow) {
        const unpacked = this._extractEtkinlikJson(foundRow, cleanId);
        if (unpacked) {
          this.cacheEtkinlik(cleanId, unpacked);
          return unpacked;
        }
      }
    } catch (e) {
      console.warn('Supabase etkinlik okuma hatası:', e);
    }

    return this.getCachedEtkinlik(cleanId);
  },

  isPendingEtkinlikLoad() {
    return !!this._pendingEtkinlikLoad;
  },

  initEtkinlikLoader() {
    if (typeof window === 'undefined') return;
    const rawParams = new URLSearchParams(window.location.search);
    const etkinlikId = rawParams.get('etkinlik');
    if (!etkinlikId) return;

    const path = window.location.pathname.replace(/\\/g, '/').toLowerCase();
    const isEditorPage = path.includes('editor-');
    const isPlayPage = path.includes('play-');
    const isJoinOrIndex = !isEditorPage && !isPlayPage;

    const localAct = (typeof ActivityStore !== 'undefined' && ActivityStore.getById)
      ? ActivityStore.getById(etkinlikId)
      : null;

    if (isJoinOrIndex) {
      if (localAct) {
        const prefix = AuthStore._isInPagesDir() ? '' : 'pages/';
        window.location.replace(`${prefix}${this.getPlayRelativePath(localAct)}?etkinlik=${encodeURIComponent(etkinlikId)}`);
        return;
      }
      this._pendingEtkinlikLoad = true;
      this.fetchEtkinlikById(etkinlikId).then(act => {
        this._pendingEtkinlikLoad = false;
        if (act) {
          const prefix = AuthStore._isInPagesDir() ? '' : 'pages/';
          window.location.replace(`${prefix}${this.getPlayRelativePath(act)}?etkinlik=${encodeURIComponent(etkinlikId)}`);
        } else {
          showToast('Paylaşılan ?etkinlik=ID kaydı bulunamadı.', 'error');
        }
      });
      return;
    }

    if (isPlayPage || (isEditorPage && !localAct)) {
      if (!localAct) {
        this._pendingEtkinlikLoad = true;
      }
      this.fetchEtkinlikById(etkinlikId).then(act => {
        const wasPending = this._pendingEtkinlikLoad;
        this._pendingEtkinlikLoad = false;
        if (act && wasPending && typeof window.init === 'function') {
          window.init();
        } else if (wasPending && !act && typeof window.init === 'function') {
          window.init();
        }
      });
    }
  },

  mountEditorSaveAndShareBtn() {
    if (typeof document === 'undefined') return;
    const staleBtn = document.getElementById('saveAndShareBtn');
    if (staleBtn) staleBtn.remove();
  },

  copyShareUrl(inputId) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const val = inp.value;
    if (navigator.clipboard && val) {
      navigator.clipboard.writeText(val).then(() => {
        showToast('Paylaşım bağlantısı panoya kopyalandı!', 'success');
      }).catch(() => {
        inp.select();
        document.execCommand('copy');
        showToast('Paylaşım bağlantısı kopyalandı!', 'success');
      });
    } else {
      inp.select();
      document.execCommand('copy');
      showToast('Paylaşım bağlantısı kopyalandı!', 'success');
    }
  },

  openShareResultModal(res, activity) {
    if (typeof document === 'undefined') return;
    let modal = document.getElementById('supabaseShareModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'supabaseShareModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:580px;">
          <div class="modal-header">
            <h2 class="modal-title" id="sbShareModalTitle">🚀 Etkinlik Paylaşım Bağlantısı</h2>
            <button type="button" class="modal-close" onclick="closeModal('supabaseShareModal')">✕</button>
          </div>
          <div id="sbShareModalBody"></div>
          <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
            <button type="button" class="btn btn-outline" onclick="closeModal('supabaseShareModal')">Kapat</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const titleEl = document.getElementById('sbShareModalTitle');
    const bodyEl = document.getElementById('sbShareModalBody');
    if (res && res.ok) {
      titleEl.textContent = '✅ Kaydedildi ve Paylaşıma Hazır!';
      const primaryUrl = res.shareUrls?.primary || `?etkinlik=${res.id}`;
      const playerUrl = res.shareUrls?.player || primaryUrl;
      bodyEl.innerHTML = `
        <div style="background:#ECFDF5; border:1px solid #6EE7B7; color:#065F46; border-radius:10px; padding:12px 14px; font-size:0.88rem; font-weight:700; margin-bottom:16px;">
          ☁️ Etkinliğiniz JSON formatında Supabase <code>etkinlikler</code> tablosuna kaydedildi (Kayıt ID: <code>${escHtml(res.id)}</code>).
        </div>
        <div class="form-group">
          <label class="form-label">🔗 Ana Paylaşım Bağlantısı (<code>?etkinlik=${escHtml(res.id)}</code>)</label>
          <div style="display:flex; gap:8px;">
            <input type="text" class="form-control" id="sbPrimaryShareInput" readonly value="${escHtml(primaryUrl)}" onclick="this.select()" style="font-family:monospace; font-size:0.85rem;" />
            <button type="button" class="btn btn-primary btn-sm" onclick="SupabaseService.copyShareUrl('sbPrimaryShareInput')">📋 Kopyala</button>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">🎮 Doğrudan Oynatıcı Bağlantısı</label>
          <div style="display:flex; gap:8px;">
            <input type="text" class="form-control" id="sbPlayerShareInput" readonly value="${escHtml(playerUrl)}" onclick="this.select()" style="font-family:monospace; font-size:0.85rem;" />
            <button type="button" class="btn btn-outline btn-sm" onclick="SupabaseService.copyShareUrl('sbPlayerShareInput')">📋</button>
            <a href="${escHtml(playerUrl)}" target="_blank" class="btn btn-outline btn-sm">▶️ Aç</a>
          </div>
        </div>
      `;
    } else {
      titleEl.textContent = '⚠️ Supabase Kaydı Tamamlanamadı';
      const errText = escHtml(res?.error || 'Bilinmeyen hata');
      const fallbackUrl = activity ? this.buildShareUrls(activity.id, activity).primary : '';
      bodyEl.innerHTML = `
        <div style="background:#FEF2F2; border:1px solid #FCA5A5; color:#991B1B; border-radius:10px; padding:12px 14px; font-size:0.88rem; font-weight:700; margin-bottom:14px;">
          ❌ Hata: ${errText}
        </div>
        <p style="font-size:0.86rem; color:var(--text-muted); margin-bottom:10px; line-height:1.5;">
          Supabase projenizde <strong>etkinlikler</strong> tablosu veya yazma (RLS) izni tanımlı değilse SQL Editor üzerinden şu tabloyu oluşturup tekrar deneyebilirsiniz:
        </p>
        <pre style="background:#0F172A; color:#E2E8F0; padding:12px; border-radius:10px; font-size:0.75rem; overflow-x:auto; margin-bottom:12px;">create table if not exists public.etkinlikler (
  id text primary key,
  baslik text,
  tur text,
  veri jsonb not null,
  user_id uuid references auth.users(id),
  created_at timestamptz default now()
);
alter table public.etkinlikler enable row level security;
create policy "Herkes okuyabilir" on public.etkinlikler for select using (true);
create policy "Giris yapanlar veya acik kayit" on public.etkinlikler for insert with check (true);
create policy "Guncelleme" on public.etkinlikler for update using (true);</pre>
        ${fallbackUrl ? `<div style="font-size:0.82rem; color:var(--text-muted);">Yerel bağlantı: <code>${escHtml(fallbackUrl)}</code></div>` : ''}
      `;
    }
    openModal('supabaseShareModal');
  }
};

// Dosya yüklenir yüklenmez veritabanını ve ?etkinlik=ID yükleyicisini hazırla
(function initDatabase() {
  ActivityStore.getAll();
  StudentStore.getAll();
  WordStore.getAll();
  SharedActivityStore.getAllRaw();
  SupabaseService.getClient();
  SupabaseService.initEtkinlikLoader();
})();

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  SoundEffects.updateToggleButtons();
  AuthStore.syncNavbarAndRoleUI();
  SupabaseService.refreshSessionState();
});
